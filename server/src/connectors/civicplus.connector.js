/**
 * CivicPlus — the District's online application-intake system.
 *
 * New land-purchase applications flow in automatically rather than being typed
 * in by hand. Submissions are pulled on a schedule; each one is turned into a
 * LAMS application through the same createApplication() path used everywhere
 * else, so file numbering, permissions and the activity log all behave
 * identically no matter where an application came from.
 *
 * Which CivicPlus form field maps to which LAMS field is read from a JSON file
 * (CIVICPLUS_FIELD_MAP_FILE), so a change to the District's form is a config
 * edit rather than a code change.
 */
import fs from 'node:fs/promises';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import Connector from './Connector.js';
import { LandApplication } from '../models/index.js';
import { createApplication } from '../services/intakeService.js';

class CivicPlusConnector extends Connector {
  constructor() {
    super({
      id: 'civicplus',
      name: 'CivicPlus (application intake)',
      purpose: 'Pulls new land-purchase applications from the District’s online form.',
      direction: 'read',
      notes: 'Polls on a schedule; the same submission is never imported twice.',
      settings: () => config.connectors.civicplus,
      requiredSettings: [
        { key: 'baseUrl', env: 'CIVICPLUS_BASE_URL', description: 'API base URL.' },
        { key: 'apiKey', env: 'CIVICPLUS_API_KEY', description: 'API key.' },
        { key: 'formId', env: 'CIVICPLUS_FORM_ID', description: 'Form identifier.' },
        { key: 'pollSchedule', env: 'CIVICPLUS_POLL_SCHEDULE', description: 'Polling cron expression.' },
      ],
    });
    this.fieldMap = null;
  }

  async loadFieldMap() {
    if (this.fieldMap && config.isProduction) return this.fieldMap;
    try {
      this.fieldMap = JSON.parse(await fs.readFile(this.config.fieldMapFile, 'utf8'));
    } catch (error) {
      logger.warn(`CivicPlus field map could not be read (${this.config.fieldMapFile}): ${error.message}`);
      this.fieldMap = null;
    }
    return this.fieldMap;
  }

  url(pathname, params = {}) {
    const url = new URL(pathname.replace(/^\//, ''), `${this.config.baseUrl.replace(/\/$/, '')}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, value);
    }
    return url;
  }

  headers() {
    return { accept: 'application/json', authorization: `Bearer ${this.config.apiKey}` };
  }

  async checkConnection() {
    this.assertUsable();
    const map = await this.loadFieldMap();

    const response = await this.request(this.url(`forms/${this.config.formId}`), { headers: this.headers() });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'CivicPlus rejected the API key (CIVICPLUS_API_KEY).' };
    }
    if (response.status === 404) {
      return { ok: false, message: `CivicPlus has no form with id "${this.config.formId}".` };
    }
    if (!response.ok) {
      return { ok: false, message: `CivicPlus returned ${response.status} ${response.statusText}.` };
    }

    const payload = await response.json().catch(() => ({}));
    return {
      ok: true,
      message: `Connected to form "${payload.name ?? this.config.formId}".${
        map ? '' : ' Warning: the field map file could not be read, so submissions cannot be translated.'
      }`,
      details: { formName: payload.name, fieldMapLoaded: Boolean(map), pollSchedule: this.config.pollSchedule },
    };
  }

  /**
   * Pull submissions newer than the most recent one already imported.
   * @returns {Promise<{fetched: number, imported: number, skipped: number, applications: object[]}>}
   */
  async pollSubmissions({ user, req } = {}) {
    this.assertUsable();
    const startedAt = new Date();
    const map = await this.loadFieldMap();
    if (!map) {
      throw new Error(
        `The CivicPlus field map could not be read from ${this.config.fieldMapFile}. Submissions cannot be translated without it.`
      );
    }

    // Resume from the newest submission already held, so nothing is re-imported.
    const newest = await LandApplication.findOne({ source: 'online_form' }).sort({ submittedAt: -1 }).select('submittedAt');
    const since = newest?.submittedAt;

    const response = await this.request(
      this.url(`forms/${this.config.formId}/submissions`, {
        since: since ? since.toISOString() : undefined,
        pageSize: 100,
      }),
      { headers: this.headers() }
    );

    if (!response.ok) {
      throw new Error(`CivicPlus returned ${response.status} ${response.statusText} when listing submissions.`);
    }

    const payload = await response.json();
    const submissions = payload.items ?? payload.submissions ?? [];

    const result = { fetched: submissions.length, imported: 0, skipped: 0, applications: [] };

    for (const submission of submissions) {
      const externalReference = String(submission.id ?? submission.submissionId ?? '');
      if (!externalReference) {
        result.skipped += 1;
        continue;
      }

      // Idempotent: the same submission is never turned into two applications.
      const existing = await LandApplication.findOne({ externalReference });
      if (existing) {
        result.skipped += 1;
        continue;
      }

      const application = await createApplication(this.translate(submission, map), {
        source: 'online_form',
        user,
        req,
      });
      result.imported += 1;
      result.applications.push({ id: application._id, fileNumber: application.fileNumber });
    }

    this.lastRun = { at: startedAt, operation: 'poll', count: result.imported };
    logger.info(`CivicPlus poll: ${result.imported} new application(s) of ${result.fetched} fetched`);

    return { ...result, startedAt, finishedAt: new Date() };
  }

  /** Turn one CivicPlus submission into the shape createApplication() expects. */
  translate(submission, map) {
    const answers = submission.data ?? submission.answers ?? submission.fields ?? submission;
    const read = (fieldName) => {
      if (!fieldName) return undefined;
      const value = fieldName.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), answers);
      return value === '' ? undefined : value;
    };

    const parcelIds = read(map.property?.parcelIdentifiers);

    return {
      externalReference: String(submission.id ?? submission.submissionId),
      submittedAt: submission.submittedAt ?? submission.createdAt ?? new Date(),
      applicant: {
        name: read(map.applicant?.name),
        email: read(map.applicant?.email),
        phone: read(map.applicant?.phone),
        mailingAddress: read(map.applicant?.mailingAddress),
      },
      property: {
        description: read(map.property?.description),
        address: read(map.property?.address),
        county: read(map.property?.county),
        region: read(map.property?.region),
        acres: numberOrUndefined(read(map.property?.acres)),
        askingPrice: numberOrUndefined(read(map.property?.askingPrice)),
        parcelIdentifiers: Array.isArray(parcelIds)
          ? parcelIds
          : String(parcelIds ?? '')
              .split(/[,;]/)
              .map((s) => s.trim())
              .filter(Boolean),
        geometry: { source: config.connectors.arcgis.enabled ? 'arcgis' : 'none', ref: firstOf(parcelIds) },
      },
      notes: read(map.notes),
    };
  }
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(parsed) ? undefined : parsed;
}

function firstOf(value) {
  if (Array.isArray(value)) return value[0];
  if (typeof value === 'string') return value.split(/[,;]/)[0]?.trim();
  return undefined;
}

export default new CivicPlusConnector();
