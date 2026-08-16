/**
 * The comparison report.
 *
 * This is what District staff review before anything becomes official: what came
 * across, what was changed on the way through, what did not match, and a row-by-
 * row check of the source against what now exists.
 *
 * Written as a workbook because that is what the District works in.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const { buildWorkbook } = await import('../../../server/src/services/spreadsheetService.js');

export async function writeReconciliationReport({
  mode,
  settings,
  mapping,
  sourceRows,
  sheetName,
  results,
  issues,
  changes,
  models,
  targetDb,
}) {
  await fs.mkdir(settings.reportDir, { recursive: true });

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  /* ---- 1. Summary ---- */
  const summaryRows = [
    { item: 'Mode', value: mode === 'apply' ? 'APPLIED to the real database' : 'DRY RUN (practice area only)' },
    { item: 'Database written to', value: targetDb },
    { item: 'Source file', value: path.basename(settings.sourceFile) },
    { item: 'Sheet', value: sheetName },
    { item: 'Mapping', value: `${mapping.name} (v${mapping.version ?? '1'})` },
    { item: 'Batch label', value: settings.batch },
    { item: 'Rows in the export', value: sourceRows.length },
    { item: 'Values adjusted on the way through', value: changes.length },
    { item: 'Errors', value: errors.length },
    { item: 'Warnings', value: warnings.length },
    { item: 'Records that failed to save', value: results.failed.length },
  ];

  for (const [model, count] of Object.entries(results.created)) {
    summaryRows.push({ item: `${model} — created`, value: count });
    summaryRows.push({ item: `${model} — updated`, value: results.updated[model] ?? 0 });
  }

  /* ---- 2. Row-by-row check against what is now in the database ---- */
  const verification = [];
  for (const target of mapping.targets ?? []) {
    const Model = models[target.model];
    if (!Model) continue;
    const targetLabel = target.key ?? target.model;

    const documents = await Model.find({ 'legacy.batch': settings.batch }).lean();
    const byLegacyId = new Map(documents.filter((d) => d.legacy?.id).map((d) => [String(d.legacy.id), d]));

    sourceRows.forEach((row, index) => {
      const legacyId = target.legacyIdColumn ? String(row[target.legacyIdColumn] ?? '').trim() : '';
      const skip = target.skipWhenBlank && !String(row[target.skipWhenBlank] ?? '').trim();
      if (skip) return;

      const document = legacyId ? byLegacyId.get(legacyId) : null;
      const dedupeField = target.dedupeOn;

      verification.push({
        row: index + 2,
        model: targetLabel,
        legacyId: legacyId || '(none)',
        sourceKey: dedupeField ? String(row[keyColumnFor(target, dedupeField)] ?? '') : '',
        newId: document ? String(document._id) : '',
        newKey: document && dedupeField ? String(document[dedupeField] ?? '') : '',
        outcome: document ? 'carried across' : 'NOT FOUND — check the issues tab',
      });
    });
  }

  const notCarried = verification.filter((entry) => entry.outcome !== 'carried across');

  /* ---- 3. Build the workbook ---- */
  const sheets = [
    {
      name: 'Summary',
      title: 'LAMS data migration — comparison report',
      subtitle: `${mapping.legacySystem} → LAMS · generated ${new Date().toLocaleString()}`,
      columns: [
        { header: 'Item', key: 'item', width: 44 },
        { header: 'Value', key: 'value', width: 46 },
      ],
      rows: summaryRows,
    },
    {
      name: 'Row check',
      title: 'Every source row, and what it became',
      subtitle: `${verification.length} checks · ${notCarried.length} row(s) did not carry across`,
      columns: [
        { header: 'Source row', key: 'row', type: 'number', width: 12 },
        { header: 'Record type', key: 'model', width: 16 },
        { header: 'Original ID', key: 'legacyId', width: 18 },
        { header: 'Original key', key: 'sourceKey', width: 22 },
        { header: 'New LAMS ID', key: 'newId', width: 28 },
        { header: 'New key', key: 'newKey', width: 22 },
        { header: 'Outcome', key: 'outcome', width: 32 },
      ],
      rows: verification,
    },
    {
      name: 'Issues',
      title: 'Anything that needs a decision',
      subtitle: `${errors.length} error(s), ${warnings.length} warning(s)`,
      columns: [
        { header: 'Severity', key: 'severity', width: 12 },
        { header: 'Source row', key: 'row', type: 'number', width: 12 },
        { header: 'Record type', key: 'target', width: 16 },
        { header: 'Field', key: 'field', width: 22 },
        { header: 'Column', key: 'column', width: 22 },
        { header: 'Value', key: 'value', width: 24 },
        { header: 'What happened', key: 'message', width: 80 },
      ],
      rows: issues.map((issue) => ({
        severity: issue.severity,
        row: issue.row ?? '',
        target: issue.target ?? '',
        field: issue.field ?? '',
        column: issue.column ?? '',
        value: issue.value ?? '',
        message: issue.message,
      })),
    },
    {
      name: 'Changed values',
      title: 'Values that were adjusted on the way through',
      subtitle: 'Dates parsed, statuses translated, defaults supplied, text trimmed',
      columns: [
        { header: 'Source row', key: 'row', type: 'number', width: 12 },
        { header: 'Record type', key: 'target', width: 16 },
        { header: 'Field', key: 'field', width: 24 },
        { header: 'From (export)', key: 'from', width: 30 },
        { header: 'To (LAMS)', key: 'to', width: 30 },
        { header: 'Why', key: 'reason', width: 26 },
      ],
      rows: changes,
    },
  ];

  if (results.failed.length) {
    sheets.push({
      name: 'Failed to save',
      title: 'Records that could not be saved',
      columns: [
        { header: 'Source row', key: 'row', type: 'number', width: 12 },
        { header: 'Record type', key: 'model', width: 18 },
        { header: 'Original ID', key: 'legacyId', width: 18 },
        { header: 'Reason', key: 'message', width: 80 },
      ],
      rows: results.failed,
    });
  }

  const buffer = await buildWorkbook({ sheets });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `migration-${mode}-${settings.batch}-${stamp}.xlsx`;
  const filePath = path.join(settings.reportDir, filename);
  await fs.writeFile(filePath, buffer);

  return filePath;
}

/** Finds the export column that feeds the dedupe field, for side-by-side display. */
function keyColumnFor(target, dedupeField) {
  const rule = target.fields?.[dedupeField];
  return rule?.column ?? dedupeField;
}
