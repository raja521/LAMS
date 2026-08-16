import { Router } from 'express';
import config from '../config/env.js';
import { Parcel, Program, ReportRun } from '../models/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { ACTIONS } from '../config/permissions.js';
import { availableDatasets, listReports, runReport } from '../services/reportService.js';
import { buildWorkbook, XLSX_MIME } from '../services/spreadsheetService.js';
import { recordActivity } from '../services/activityService.js';
import { runScheduledReports } from '../services/schedulerService.js';

const router = Router();

router.use(authenticate);

/** Which reports exist, and the values the filter controls should offer. */
router.get(
  '/',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (_req, res) => {
    const [reports, regions, counties, programs] = await Promise.all([
      listReports(),
      Parcel.distinct('region'),
      Parcel.distinct('county'),
      Program.find({}).select('name code').sort({ name: 1 }),
    ]);

    res.json({
      items: reports,
      datasets: availableDatasets(),
      filterOptions: {
        regions: regions.filter(Boolean).sort(),
        counties: counties.filter(Boolean).sort(),
        programs,
      },
      maxRows: config.reporting.maxRows,
    });
  })
);

/** Parcels for the "filter by property" control. */
router.get(
  '/parcels',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (_req, res) => {
    const items = await Parcel.find({}).select('parcelId name county region status').sort({ parcelId: 1 }).limit(500);
    res.json({ items, total: items.length });
  })
);

/** Past runs, so last month's figures can be found again. */
router.get(
  '/runs',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const filter = req.query.reportId ? { reportId: req.query.reportId } : {};
    const items = await ReportRun.find(filter)
      .populate('generatedBy', 'firstName lastName email')
      .sort({ generatedAt: -1 })
      .limit(Math.min(Number(req.query.limit ?? 50), 200));
    res.json({ items, total: items.length });
  })
);

function filtersFrom(query) {
  const { parcel, region, county, program, status, module, dateFrom, dateTo } = query ?? {};
  return Object.fromEntries(
    Object.entries({ parcel, region, county, program, status, module, dateFrom, dateTo }).filter(
      ([, value]) => value !== undefined && value !== ''
    )
  );
}

/** Run a report on demand and get the rows back as JSON. */
router.get(
  '/:reportId',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const filters = filtersFrom(req.query);
    const result = await runReport(req.params.reportId, filters);
    res.json(result);
  })
);

/**
 * The one-click Excel export, available on every report.
 *
 * The download is streamed from the API under the same permission check as the
 * report itself rather than being written to a public location.
 */
router.get(
  '/:reportId/export',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const filters = filtersFrom(req.query);
    const result = await runReport(req.params.reportId, filters);

    const describedFilters = Object.entries(filters)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ');

    const sheets = [
      {
        name: result.report.name,
        title: result.report.name,
        subtitle: [
          `${config.documents.org.name} — generated ${new Date().toLocaleString(config.documents.locale)}`,
          describedFilters ? `Filters — ${describedFilters}` : 'No filters applied',
          result.truncated ? `NOTE: limited to the first ${config.reporting.maxRows} rows.` : null,
        ]
          .filter(Boolean)
          .join('   |   '),
        columns: result.report.columns,
        rows: result.rows,
      },
    ];

    if (result.totals) {
      sheets.push({
        name: 'Totals',
        title: `${result.report.name} — totals`,
        columns: [
          { header: 'Measure', key: 'measure', width: 28 },
          { header: 'Total', key: 'total', type: 'number', width: 18 },
        ],
        rows: Object.entries(result.totals).map(([measure, total]) => ({ measure, total })),
      });
    }

    const buffer = await buildWorkbook({ sheets });
    const filename = `${result.report.id}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    await ReportRun.create({
      reportId: result.report.id,
      reportName: result.report.name,
      trigger: 'manual',
      format: 'xlsx',
      filters,
      rowCount: result.rowCount,
      truncated: result.truncated,
      status: 'success',
      generatedBy: req.user._id,
    });

    await recordActivity({
      req,
      action: 'export',
      entityType: 'Report',
      entityLabel: result.report.name,
      summary: `Exported "${result.report.name}" to Excel (${result.rowCount} rows).`,
    });

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  })
);

/** Trigger the scheduled bundle by hand — used for testing the schedule. */
router.post(
  '/scheduled/run',
  requirePermission(ACTIONS.CREATE),
  asyncHandler(async (req, res) => {
    const result = await runScheduledReports({ trigger: 'manual', user: req.user });
    res.status(201).json(result);
  })
);

export default router;
