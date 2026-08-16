#!/usr/bin/env node
/**
 * One-time data migration tool.
 *
 * Deliberately separate from the everyday application: it is run by hand, from
 * the command line, by whoever is doing the changeover.
 *
 *   npm run import:dry-run    read the export, write into the practice area,
 *                             produce the comparison report. The real database
 *                             is never touched.
 *   npm run import:apply      the same thing against the real database, only
 *                             after a dry run has been reviewed and approved.
 *
 * Every record keeps the identifier it had in the old system, so anything can be
 * traced back to where it came from.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const { default: config, ROOT_DIR } = await import('../../server/src/config/env.js');
const { connectDatabase, disconnectDatabase } = await import('../../server/src/config/db.js');
const mongoose = (await import('mongoose')).default;
const models = await import('../../server/src/models/index.js');

const { readSource } = await import('./lib/sourceReader.js');
const { mapRow, validateColumns } = await import('./lib/mapper.js');
const { writeReconciliationReport } = await import('./lib/reconcile.js');

/* -------------------------------------------------------------------------- */
/* Settings — the tool refuses to guess                                       */
/* -------------------------------------------------------------------------- */

const REQUIRED = [
  ['MIGRATION_SOURCE_FILE', "the District's export file (.csv or .xlsx)"],
  ['MIGRATION_MAPPING_FILE', 'the field mapping to use'],
  ['MIGRATION_STAGING_DB_NAME', 'the practice database a dry run writes to'],
  ['MIGRATION_REPORT_DIR', 'where the comparison report is written'],
  ['MIGRATION_BATCH_LABEL', 'a label stamped on every imported record'],
];

const missing = REQUIRED.filter(([name]) => !process.env[name]?.trim());
if (missing.length) {
  console.error(
    `\nThe migration tool cannot run: ${missing.length} setting(s) are not configured.\n\n` +
      missing.map(([name, purpose]) => `  • ${name} — ${purpose}`).join('\n') +
      '\n\nSet them in .env (see .env.example) and run again. No default is assumed by design.\n'
  );
  process.exit(1);
}

const MODE = process.argv.includes('--apply') ? 'apply' : 'dry-run';
const settings = {
  sourceFile: path.resolve(ROOT_DIR, process.env.MIGRATION_SOURCE_FILE.trim()),
  mappingFile: path.resolve(ROOT_DIR, process.env.MIGRATION_MAPPING_FILE.trim()),
  stagingDb: process.env.MIGRATION_STAGING_DB_NAME.trim(),
  reportDir: path.resolve(ROOT_DIR, process.env.MIGRATION_REPORT_DIR.trim()),
  batch: process.env.MIGRATION_BATCH_LABEL.trim(),
};

/* -------------------------------------------------------------------------- */

function banner(text) {
  console.log(`\n${'─'.repeat(72)}\n${text}\n${'─'.repeat(72)}`);
}

async function run() {
  banner(`LAMS data migration — ${MODE === 'apply' ? 'APPLYING TO THE REAL DATABASE' : 'DRY RUN (practice area)'}`);

  const targetDb = MODE === 'apply' ? config.db.name : settings.stagingDb;
  console.log(`  Source   ${settings.sourceFile}`);
  console.log(`  Mapping  ${settings.mappingFile}`);
  console.log(`  Database ${targetDb}${MODE === 'apply' ? '  ← real data' : '  ← practice area, the real database is untouched'}`);
  console.log(`  Batch    ${settings.batch}`);

  const mapping = JSON.parse(await fs.readFile(settings.mappingFile, 'utf8'));
  const { rows, sheetName, format, malformed = [] } = await readSource(settings.sourceFile);
  console.log(`\n  Read ${rows.length} row(s) from ${sheetName} (${format}).`);

  if (malformed.length) {
    console.error(`\n  ${malformed.length} row(s) have the wrong number of columns and were NOT read:`);
    for (const entry of malformed.slice(0, 10)) console.error(`    ✗ ${entry.message}`);
    console.error('  Correct the export — reading them would put values in the wrong fields.\n');
  }

  if (rows.length === 0) {
    console.error('  The export has no readable rows. Nothing to do.');
    process.exit(1);
  }

  /* ---- Check the columns before touching anything ---- */
  const headers = Object.keys(rows[0]);
  const columnCheck = validateColumns(headers, mapping);
  const blockingIssues = columnCheck.issues.filter((issue) => issue.severity === 'error');

  for (const issue of columnCheck.issues) {
    console.log(`  ${issue.severity === 'error' ? '✗' : '!'} ${issue.message}`);
  }
  if (blockingIssues.length) {
    console.error('\n  The export does not match the mapping. Nothing was imported.\n');
    process.exit(1);
  }

  /* ---- Map every row ---- */
  const allIssues = [
    ...columnCheck.issues,
    ...malformed.map((entry) => ({ severity: 'error', row: entry.row, message: entry.message })),
  ];
  const allChanges = [];
  const plan = new Map(); // model -> [{record, legacyId, pending, rowNumber}]

  const keyOf = (target) => target.key ?? target.model;
  for (const target of mapping.targets ?? []) {
    plan.set(keyOf(target), []);
  }

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for zero-based, +1 for the header row
    for (const target of mapping.targets ?? []) {
      const result = mapRow(row, target, rowNumber);
      allIssues.push(...result.issues);
      allChanges.push(...result.changes);
      if (result.skipped && target.primary) {
        allIssues.push({
          severity: 'error',
          row: rowNumber,
          target: target.model,
          column: target.skipWhenBlank,
          message: `"${target.skipWhenBlank}" is empty, so this row produced no ${target.model}. The row will not carry across.`,
        });
      }
      if (!result.skipped && result.record) {
        plan.get(keyOf(target)).push({ ...result, rowNumber, target });
      }
    }
  });

  const errorCount = allIssues.filter((issue) => issue.severity === 'error').length;
  const warningCount = allIssues.length - errorCount;
  console.log(
    `\n  Mapped ${rows.length} row(s): ${allChanges.length} value(s) adjusted, ${errorCount} error(s), ${warningCount} warning(s).`
  );

  // Applying over rows that did not map cleanly would put known-bad data into
  // the real database. A dry run always continues, so the report can show why.
  if (MODE === 'apply' && errorCount > 0 && !process.argv.includes('--force')) {
    console.error(
      `\n  Refusing to apply: ${errorCount} row(s) did not map cleanly.\n` +
        '  Run the dry run, review the Issues tab of the comparison report, and either\n' +
        '  correct the export or re-run with --force to accept them as they are.\n'
    );
    await disconnectDatabase().catch(() => {});
    process.exit(3);
  }

  /* ---- Write into the chosen database ---- */
  await connectDatabase(config.db.uri, targetDb);

  if (MODE === 'dry-run') {
    // The practice area is rebuilt from scratch each time, so a dry run always
    // reflects this export and nothing left over from a previous attempt.
    console.log(`\n  Clearing the practice area (${targetDb}) so this run stands alone…`);
    for (const target of mapping.targets ?? []) {
      await models[target.model].deleteMany({ 'legacy.batch': settings.batch });
    }
  }

  const results = { created: {}, updated: {}, skipped: {}, failed: [] };
  const idMap = new Map(); // "Model:by:value" -> ObjectId

  for (const target of mapping.targets ?? []) {
    const Model = models[target.model];
    if (!Model) {
      console.error(`  ✗ The mapping names a model "${target.model}" that does not exist.`);
      continue;
    }

    const key = keyOf(target);
    const entries = plan.get(key) ?? [];
    results.created[key] = 0;
    results.updated[key] = 0;
    results.skipped[key] = 0;

    for (const entry of entries) {
      // Resolve references to records created earlier in this run.
      for (const reference of entry.pending ?? []) {
        const key = `${reference.model}:${reference.by}:${reference.value}`;
        const id = idMap.get(key);
        if (!id) {
          allIssues.push({
            severity: 'warning',
            row: entry.rowNumber,
            target: target.model,
            field: reference.field,
            message: `Could not link ${reference.field}: no ${reference.model} with ${reference.by} = "${reference.value}" was created.`,
          });
          continue;
        }
        entry.record[reference.field] = reference.many ? [id] : id;
      }

      // The original id travels with every record.
      entry.record.legacy = {
        system: mapping.legacySystem,
        id: entry.legacyId,
        source: sheetName,
        batch: settings.batch,
        importedAt: new Date(),
        raw: rows[entry.rowNumber - 2],
      };

      const dedupeField = target.dedupeOn;
      const dedupeValue = dedupeField ? entry.record[dedupeField] : null;

      try {
        let document = null;

        // Prefer matching on the legacy id, so re-running never duplicates.
        if (entry.legacyId) {
          document = await Model.findOne({ 'legacy.system': mapping.legacySystem, 'legacy.id': entry.legacyId });
        }
        if (!document && dedupeField && dedupeValue) {
          document = await Model.findOne({ [dedupeField]: dedupeValue });
        }

        if (document) {
          Object.assign(document, entry.record);
          await document.save();
          results.updated[key] += 1;
        } else {
          document = await Model.create(entry.record);
          results.created[key] += 1;
        }

        if (dedupeField && dedupeValue) idMap.set(`${target.model}:${dedupeField}:${dedupeValue}`, document._id);
      } catch (error) {
        results.failed.push({
          row: entry.rowNumber,
          model: target.model,
          legacyId: entry.legacyId,
          message: error.message,
        });
        allIssues.push({
          severity: 'error',
          row: entry.rowNumber,
          target: target.model,
          message: `Could not be saved: ${error.message}`,
        });
      }
    }

    console.log(
      `  ${key.padEnd(16)} created ${String(results.created[key]).padStart(4)}   updated ${String(
        results.updated[key]
      ).padStart(4)}   of ${entries.length} candidate row(s)`
    );
  }

  /* ---- Comparison report ---- */
  const reportPath = await writeReconciliationReport({
    mode: MODE,
    settings,
    mapping,
    sourceRows: rows,
    sheetName,
    results,
    issues: allIssues,
    changes: allChanges,
    models,
    targetDb,
  });

  banner('Result');
  const totalCreated = Object.values(results.created).reduce((a, b) => a + b, 0);
  const totalUpdated = Object.values(results.updated).reduce((a, b) => a + b, 0);
  console.log(`  ${totalCreated} record(s) created, ${totalUpdated} updated, ${results.failed.length} failed.`);
  console.log(`  ${allIssues.filter((i) => i.severity === 'error').length} error(s), ${allIssues.filter((i) => i.severity === 'warning').length} warning(s).`);
  console.log(`\n  Comparison report: ${reportPath}`);

  if (MODE === 'dry-run') {
    console.log(
      '\n  This was a DRY RUN — the real database was not touched.\n' +
        '  Have District staff review the comparison report, then run:\n' +
        '      npm run import:apply\n'
    );
  } else {
    console.log('\n  Applied to the real database. Every record carries its original id under `legacy.id`.\n');
  }

  await disconnectDatabase();
  process.exit(results.failed.length > 0 ? 2 : 0);
}

run().catch(async (error) => {
  console.error(`\nMigration failed: ${error.message}\n${error.stack ?? ''}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});

export { settings, MODE };
