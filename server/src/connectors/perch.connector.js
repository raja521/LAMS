/**
 * PERCH — the District's environmental-tracking system.
 *
 * Read-only by design. LAMS looks at this information and never changes it, so
 * this connector exposes no create, update or delete method at all — the
 * absence is the safeguard, rather than a flag that could be switched.
 */
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import Connector from './Connector.js';

class PerchConnector extends Connector {
  constructor() {
    super({
      id: 'perch',
      name: 'PERCH (environmental tracking)',
      purpose: 'Shows environmental records held against a property.',
      direction: 'read',
      notes: 'Read-only: the connector has no write path, so LAMS cannot alter PERCH records.',
      settings: () => config.connectors.perch,
      requiredSettings: [
        { key: 'baseUrl', env: 'PERCH_BASE_URL', description: 'PERCH base URL.' },
        { key: 'apiKey', env: 'PERCH_API_KEY', description: 'API key.' },
      ],
    });
  }

  headers() {
    return { accept: 'application/json', authorization: `Bearer ${this.config.apiKey}` };
  }

  url(pathname, params = {}) {
    const url = new URL(pathname.replace(/^\//, ''), `${this.config.baseUrl.replace(/\/$/, '')}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
    return url;
  }

  async checkConnection() {
    this.assertUsable();
    const response = await this.request(this.url(this.config.parcelQueryPath, { pageSize: 1 }), {
      headers: this.headers(),
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'PERCH rejected the API key (PERCH_API_KEY).' };
    }
    if (!response.ok) {
      return { ok: false, message: `PERCH returned ${response.status} ${response.statusText}.` };
    }

    return { ok: true, message: 'Connected. LAMS reads PERCH records and never writes to them.' };
  }

  /**
   * Environmental records for a parcel.
   * @returns {Promise<{parcelId: string, records: object[]}>}
   */
  async recordsForParcel(parcelId) {
    this.assertUsable();
    if (!parcelId) throw ApiError.badRequest('A parcel identifier is required to query PERCH.');

    const response = await this.request(this.url(this.config.parcelQueryPath, { parcelId }), {
      headers: this.headers(),
    });

    if (response.status === 404) return { parcelId, records: [] };
    if (!response.ok) {
      throw new ApiError(502, `PERCH returned ${response.status} ${response.statusText}.`);
    }

    const payload = await response.json();
    const records = payload.items ?? payload.sites ?? payload.records ?? [];

    this.lastRun = { at: new Date(), operation: 'recordsForParcel', count: records.length };

    return {
      parcelId,
      records: records.map((record) => ({
        externalId: String(record.id ?? record.siteId ?? ''),
        name: record.name ?? record.siteName ?? null,
        recordType: record.type ?? record.recordType ?? null,
        status: record.status ?? null,
        openedOn: record.openedOn ?? record.startDate ?? null,
        closedOn: record.closedOn ?? record.endDate ?? null,
        summary: record.summary ?? record.description ?? null,
      })),
    };
  }
}

export default new PerchConnector();
