import { Router } from 'express';
import config from '../config/env.js';
import { ExternalReference, IntegrationRun, Parcel } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requireAdmin, requirePermission } from '../middleware/auth.js';
import { ACTIONS } from '../config/permissions.js';
import { accufund, civicplus, describeAll, getConnector, papervision, perch, testAll } from '../connectors/index.js';
import { scheduledJobs, tracked } from '../services/schedulerService.js';
import { writeParcelLabel } from '../services/gisService.js';

const router = Router();

router.use(authenticate);

/* -------------------------------------------------------------------------- */
/* Status — the admin screen                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What is connected and what is not. Deliberately blunt: a connector that is
 * off, half-configured or unreachable says exactly that, so nobody assumes the
 * data behind it is present and current.
 */
router.get(
  '/',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const connectors = describeAll();
    const recentRuns = await IntegrationRun.find({}).sort({ startedAt: -1 }).limit(25).lean();

    const byConnector = {};
    for (const run of recentRuns) {
      byConnector[run.connector] ??= [];
      if (byConnector[run.connector].length < 5) byConnector[run.connector].push(run);
    }

    res.json({
      connectors: connectors.map((connector) => ({ ...connector, recentRuns: byConnector[connector.id] ?? [] })),
      schedules: scheduledJobs(),
      summary: {
        total: connectors.length,
        enabled: connectors.filter((c) => c.enabled).length,
        notConfigured: connectors.filter((c) => c.state === 'not_configured').length,
        unavailable: connectors.filter((c) => c.state === 'unavailable').length,
      },
    });
  })
);

/** Run every live check. */
router.post(
  '/test',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ connectors: await testAll(), testedAt: new Date().toISOString() });
  })
);

/** Run one connector's live check. */
router.post(
  '/:id/test',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const connector = getConnector(req.params.id);
    if (!connector) throw ApiError.notFound(`There is no connector called "${req.params.id}".`);
    res.json({ ...connector.describe(), ...(await connector.test()) });
  })
);

router.get(
  '/runs',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const filter = req.query.connector ? { connector: req.query.connector } : {};
    const items = await IntegrationRun.find(filter)
      .populate('triggeredBy', 'firstName lastName email')
      .sort({ startedAt: -1 })
      .limit(Math.min(Number(req.query.limit ?? 50), 200));
    res.json({ items, total: items.length });
  })
);

/* -------------------------------------------------------------------------- */
/* Manual triggers                                                            */
/* -------------------------------------------------------------------------- */

/** Run the AccuFund export now rather than waiting for the schedule. */
router.post(
  '/accufund/export',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { run, result, error } = await tracked(
      { connector: 'accufund', operation: 'export', trigger: 'manual', user: req.user },
      () => accufund.runExport({ since: req.body?.since ? new Date(req.body.since) : undefined })
    );
    if (error) throw error;
    res.status(201).json({ run, result });
  })
);

router.post(
  '/accufund/import',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { run, result, error } = await tracked(
      { connector: 'accufund', operation: 'import', trigger: 'manual', user: req.user },
      () => accufund.runImport()
    );
    if (error) throw error;
    res.status(201).json({ run, result });
  })
);

/** Pull new applications from CivicPlus now. */
router.post(
  '/civicplus/poll',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { run, result, error } = await tracked(
      { connector: 'civicplus', operation: 'poll', trigger: 'manual', user: req.user },
      () => civicplus.pollSubmissions({ user: req.user, req })
    );
    if (error) throw error;
    res.status(201).json({ run, result });
  })
);

/* -------------------------------------------------------------------------- */
/* PaperVision — links, never copies                                          */
/* -------------------------------------------------------------------------- */

router.get(
  '/papervision/search',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const results = await papervision.search(String(req.query.q ?? ''), { limit: Number(req.query.limit ?? 25) });
    res.json({ items: results, total: results.length });
  })
);

router.post(
  '/papervision/link',
  requirePermission(ACTIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const { entityType, entityId, documentId, title, documentType } = req.body ?? {};
    const reference = await papervision.attach({ entityType, entityId, documentId, title, documentType, user: req.user });
    res.status(201).json(reference);
  })
);

/** Every external link held against a record, whichever system it points at. */
router.get(
  '/links/:entityType/:entityId',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const items = await ExternalReference.find({
      entityType: req.params.entityType,
      entityId: req.params.entityId,
    }).sort({ createdAt: -1 });
    res.json({ items, total: items.length });
  })
);

/* -------------------------------------------------------------------------- */
/* PERCH — read-only                                                          */
/* -------------------------------------------------------------------------- */

router.get(
  '/perch/parcels/:parcelId',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const parcel = await Parcel.findById(req.params.parcelId).select('parcelId geometry');
    if (!parcel) throw ApiError.notFound('That parcel does not exist.');

    const lookupId = parcel.geometry?.ref || parcel.parcelId;
    res.json(await perch.recordsForParcel(lookupId));
  })
);

/* -------------------------------------------------------------------------- */
/* ArcGIS — label write-back only                                             */
/* -------------------------------------------------------------------------- */

/**
 * Push LAMS labels onto the District's features. Geometry is never included —
 * the connector strips it — so this cannot change a property boundary.
 */
router.post(
  '/arcgis/parcels/:parcelId/label',
  requirePermission(ACTIONS.UPDATE),
  asyncHandler(async (req, res) => {
    const parcel = await Parcel.findById(req.params.parcelId);
    if (!parcel) throw ApiError.notFound('That parcel does not exist.');

    const result = await writeParcelLabel(parcel);
    res.json({ ...result, parcelId: parcel.parcelId, note: 'Labels only — the property boundary was not touched.' });
  })
);

/** Non-secret view of how the integrations are configured, for support. */
router.get(
  '/configuration',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({
      arcgis: {
        enabled: config.connectors.arcgis.enabled,
        parcelIdField: config.connectors.arcgis.parcelIdField,
        labelWriteBackAllowed: config.connectors.arcgis.allowAttributeWrite,
        writableFields: config.connectors.arcgis.writableFields,
        serviceConfigured: Boolean(config.connectors.arcgis.featureServiceUrl),
      },
      accufund: {
        enabled: config.connectors.accufund.enabled,
        exportSchedule: config.connectors.accufund.exportSchedule,
        importSchedule: config.connectors.accufund.importSchedule,
        directoriesConfigured: Boolean(config.connectors.accufund.exportDir && config.connectors.accufund.importDir),
      },
      civicplus: {
        enabled: config.connectors.civicplus.enabled,
        pollSchedule: config.connectors.civicplus.pollSchedule,
        formConfigured: Boolean(config.connectors.civicplus.formId),
      },
      papervision: {
        enabled: config.connectors.papervision.enabled,
        linkTemplateConfigured: Boolean(config.connectors.papervision.documentUrlTemplate),
      },
      perch: { enabled: config.connectors.perch.enabled, readOnly: true },
      legacy: { enabled: config.connectors.legacy.enabled, systemName: config.connectors.legacy.systemName },
      scheduler: scheduledJobs(),
    });
  })
);

export default router;
