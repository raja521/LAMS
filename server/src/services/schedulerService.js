/**
 * Background schedules: the monthly report bundle, the AccuFund file transfers
 * and the CivicPlus poll.
 *
 * Every schedule is off unless SCHEDULER_ENABLED is true and the connector it
 * belongs to is switched on, so a second app instance can be started with
 * SCHEDULER_ENABLED=false and the jobs still run exactly once.
 *
 * Each run is written to integrationruns, so a transfer that did not happen is
 * visible rather than silently leaving yesterday's numbers in place.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { IntegrationRun, ReportRun } from '../models/index.js';
import { accufund, civicplus } from '../connectors/index.js';
import { listReports, runReport } from './reportService.js';
import { buildWorkbook } from './spreadsheetService.js';

const jobs = [];

/* -------------------------------------------------------------------------- */
/* Run bookkeeping                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Wrap a job so its start, finish and failure are always recorded — including
 * when it throws.
 */
async function tracked({ connector, operation, trigger = 'schedule', user }, work) {
  const startedAt = new Date();
  const run = await IntegrationRun.create({ connector, operation, trigger, status: 'running', startedAt, triggeredBy: user?._id });

  try {
    const result = (await work()) ?? {};
    const finishedAt = new Date();
    const issues = result.unmatched ?? result.errors ?? [];

    run.status = issues.length ? 'partial' : 'success';
    run.finishedAt = finishedAt;
    run.durationMs = finishedAt - startedAt;
    run.counts = stripHeavy(result);
    run.issues = issues.slice(0, 100);
    run.message = result.message ?? null;
    await run.save();

    logger.info(`[schedule] ${connector}.${operation} ${run.status} in ${run.durationMs}ms`);
    return { run, result };
  } catch (error) {
    const finishedAt = new Date();
    run.status = 'failed';
    run.finishedAt = finishedAt;
    run.durationMs = finishedAt - startedAt;
    run.message = error.message;
    await run.save();

    logger.error(`[schedule] ${connector}.${operation} failed: ${error.message}`);
    return { run, error };
  }
}

/** Keep the counts field small — rows and buffers do not belong in the log. */
function stripHeavy(result) {
  const { applications, rows, unmatched, errors, ...rest } = result;
  return {
    ...rest,
    ...(Array.isArray(applications) ? { applications: applications.length } : {}),
    ...(typeof rows === 'number' ? { rows } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* The scheduled work                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Produce every report as a workbook and write it to the report directory.
 * Runs monthly by default; also callable on demand from the reports screen.
 */
export async function runScheduledReports({ trigger = 'schedule', user } = {}) {
  const startedAt = new Date();
  const reports = await listReports();

  // The period is the calendar month that just ended.
  const periodEnd = new Date(startedAt.getFullYear(), startedAt.getMonth(), 1);
  const periodStart = new Date(periodEnd.getFullYear(), periodEnd.getMonth() - 1, 1);
  const filters = { dateFrom: periodStart.toISOString().slice(0, 10), dateTo: periodEnd.toISOString().slice(0, 10) };

  await fs.mkdir(config.reporting.outputDir, { recursive: true });

  const produced = [];
  const sheets = [];

  for (const report of reports) {
    try {
      const result = await runReport(report.id, filters);
      sheets.push({
        name: result.report.name,
        title: result.report.name,
        subtitle: `${filters.dateFrom} to ${filters.dateTo} · ${result.rowCount} row(s)`,
        columns: result.report.columns,
        rows: result.rows,
      });

      await ReportRun.create({
        reportId: report.id,
        reportName: report.name,
        trigger,
        format: 'xlsx',
        filters,
        rowCount: result.rowCount,
        truncated: result.truncated,
        status: 'success',
        periodStart,
        periodEnd,
        generatedBy: user?._id,
      });

      produced.push({ id: report.id, rows: result.rowCount });
    } catch (error) {
      logger.error(`Scheduled report "${report.id}" failed: ${error.message}`);
      await ReportRun.create({
        reportId: report.id,
        reportName: report.name,
        trigger,
        filters,
        status: 'failed',
        message: error.message,
        periodStart,
        periodEnd,
        generatedBy: user?._id,
      });
    }
  }

  // One workbook with every report as its own tab — what the District asked to
  // be able to open in a spreadsheet each month.
  const buffer = await buildWorkbook({ sheets });
  const filename = `LAMS-monthly-${periodStart.toISOString().slice(0, 7)}.xlsx`;
  const filePath = path.join(config.reporting.outputDir, filename);
  await fs.writeFile(filePath, buffer);

  await pruneOldReports();

  return {
    filename,
    path: filePath,
    reports: produced.length,
    rows: produced.reduce((sum, entry) => sum + entry.rows, 0),
    periodStart,
    periodEnd,
    startedAt,
    finishedAt: new Date(),
  };
}

/** Delete report files older than REPORT_RETENTION_DAYS. */
async function pruneOldReports() {
  const cutoff = Date.now() - config.reporting.retentionDays * 86400000;
  const entries = await fs.readdir(config.reporting.outputDir).catch(() => []);

  for (const entry of entries) {
    const filePath = path.join(config.reporting.outputDir, entry);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.mtimeMs < cutoff) {
      await fs.unlink(filePath).catch(() => {});
      logger.info(`Pruned report older than ${config.reporting.retentionDays} days: ${entry}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Registration                                                               */
/* -------------------------------------------------------------------------- */

function register(name, expression, handler) {
  if (!cron.validate(expression)) {
    logger.error(`Schedule for ${name} is not a valid cron expression: "${expression}". This job will not run.`);
    return;
  }
  const job = cron.schedule(expression, handler, { timezone: config.scheduler.timezone });
  jobs.push({ name, expression, job });
  logger.info(`[schedule] ${name} registered: "${expression}" (${config.scheduler.timezone})`);
}

/** Called once at boot. Registers only what is switched on. */
export function startScheduler() {
  if (!config.scheduler.enabled) {
    logger.info('[schedule] SCHEDULER_ENABLED=false — no background jobs registered on this instance.');
    return [];
  }

  register('reports.monthly', config.reporting.monthlySchedule, () =>
    tracked({ connector: 'reports', operation: 'monthly' }, () => runScheduledReports({ trigger: 'schedule' }))
  );

  if (accufund.enabled && accufund.missingSettings().length === 0) {
    register('accufund.export', accufund.config.exportSchedule, () =>
      tracked({ connector: 'accufund', operation: 'export' }, () => accufund.runExport())
    );
    register('accufund.import', accufund.config.importSchedule, () =>
      tracked({ connector: 'accufund', operation: 'import' }, () => accufund.runImport())
    );
  } else if (accufund.enabled) {
    logger.warn('[schedule] AccuFund is switched on but not configured — its transfers are NOT scheduled.');
  }

  if (civicplus.enabled && civicplus.missingSettings().length === 0) {
    register('civicplus.poll', civicplus.config.pollSchedule, () =>
      tracked({ connector: 'civicplus', operation: 'poll' }, () => civicplus.pollSubmissions())
    );
  } else if (civicplus.enabled) {
    logger.warn('[schedule] CivicPlus is switched on but not configured — intake polling is NOT scheduled.');
  }

  return jobs.map(({ name, expression }) => ({ name, expression }));
}

export function stopScheduler() {
  for (const { job } of jobs) job.stop();
  jobs.length = 0;
}

/** What is registered right now, for the admin screen. */
export function scheduledJobs() {
  return {
    enabled: config.scheduler.enabled,
    timezone: config.scheduler.timezone,
    jobs: jobs.map(({ name, expression }) => ({ name, expression })),
  };
}

export { tracked };
