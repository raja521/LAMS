/**
 * Turns a row of the District's export into LAMS records, following the mapping
 * file rather than anything hard-coded.
 *
 * Every value that is changed on the way through — a date parsed, a status word
 * translated, a default supplied — is recorded, so the comparison report can
 * show staff exactly what happened to their data rather than only the result.
 */

export class MappingIssue {
  constructor({ severity, row, target, field, column, message, value }) {
    Object.assign(this, { severity, row, target, field, column, message, value });
  }
}

const TRANSFORMS = {
  trim: (value) => String(value).trim(),
  uppercase: (value) => String(value).trim().toUpperCase(),
  lowercase: (value) => String(value).trim().toLowerCase(),
  digits: (value) => String(value).replace(/\D/g, ''),
};

/** Fill {{Column}} placeholders from the source row. */
function template(text, row) {
  return String(text).replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, column) => String(row[column.trim()] ?? '').trim());
}

function blank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/* -------------------------------------------------------------------------- */
/* Value coercion                                                             */
/* -------------------------------------------------------------------------- */

function toNumber(raw) {
  if (blank(raw)) return { ok: false };
  // Tolerates "1,234.50", "$1,234.50" and "(500)" for negatives.
  const text = String(raw).trim();
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[()$,\s]/g, '');
  const parsed = Number(cleaned);
  if (Number.isNaN(parsed)) return { ok: false };
  return { ok: true, value: negative ? -parsed : parsed };
}

function toDate(raw) {
  if (blank(raw)) return { ok: false };
  const text = String(raw).trim();

  // Excel serial dates arrive as bare numbers.
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    return { ok: true, value: new Date(Date.UTC(1899, 11, 30) + serial * 86400000) };
  }

  // Prefer an unambiguous ISO reading; otherwise fall back to M/D/Y.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    return { ok: true, value: new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))) };
  }

  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (us) {
    const year = Number(us[3]) < 100 ? 2000 + Number(us[3]) : Number(us[3]);
    return { ok: true, value: new Date(Date.UTC(year, Number(us[1]) - 1, Number(us[2]))) };
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? { ok: false } : { ok: true, value: parsed };
}

/** Write a possibly-dotted path onto an object. */
function assign(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    node[key] ??= {};
    node = node[key];
  }
  node[keys.at(-1)] = value;
}

/* -------------------------------------------------------------------------- */
/* Mapping one row for one target                                             */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} row        one row of the District's export
 * @param {object} target     one entry from mapping.targets
 * @param {number} rowNumber  1-based, matching the spreadsheet
 * @returns {{record: object|null, issues: MappingIssue[], changes: object[], legacyId: string|null}}
 */
export function mapRow(row, target, rowNumber) {
  const issues = [];
  const changes = [];

  // A row that has nothing to say about this target is skipped, not failed —
  // one export row often produces a parcel but no contract.
  if (target.skipWhenBlank && blank(row[target.skipWhenBlank])) {
    return { record: null, issues, changes, legacyId: null, skipped: true };
  }

  const record = {};
  const pending = [];

  for (const [field, rule] of Object.entries(target.fields ?? {})) {
    if (rule.const !== undefined) {
      assign(record, field, rule.const);
      continue;
    }

    // References to other records are resolved after everything is created.
    if (rule.lookup || rule.lookupMany) {
      const spec = rule.lookup ?? rule.lookupMany;
      const rawValue = row[spec.column];
      if (!blank(rawValue)) {
        pending.push({
          field,
          many: Boolean(rule.lookupMany),
          model: spec.model,
          by: spec.by,
          value: spec.transform ? TRANSFORMS[spec.transform](rawValue) : String(rawValue).trim(),
        });
      }
      continue;
    }

    const rawValue = row[rule.column];

    if (blank(rawValue)) {
      if (rule.fallback !== undefined) {
        const value = template(rule.fallback, row);
        assign(record, field, value);
        changes.push({ row: rowNumber, target: target.model, field, from: '', to: value, reason: 'fallback' });
        continue;
      }
      if (rule.default !== undefined) {
        assign(record, field, rule.default);
        changes.push({ row: rowNumber, target: target.model, field, from: '', to: rule.default, reason: 'default applied' });
        continue;
      }
      if (rule.required) {
        issues.push(
          new MappingIssue({
            severity: 'error',
            row: rowNumber,
            target: target.model,
            field,
            column: rule.column,
            message: `"${rule.column}" is empty but ${field} is required.`,
          })
        );
      }
      continue;
    }

    switch (rule.type) {
      case 'number': {
        const result = toNumber(rawValue);
        if (!result.ok) {
          issues.push(
            new MappingIssue({
              severity: 'error',
              row: rowNumber,
              target: target.model,
              field,
              column: rule.column,
              value: rawValue,
              message: `"${rawValue}" is not a number.`,
            })
          );
          if (rule.default !== undefined) assign(record, field, rule.default);
        } else {
          assign(record, field, result.value);
          if (String(result.value) !== String(rawValue).trim()) {
            changes.push({ row: rowNumber, target: target.model, field, from: rawValue, to: result.value, reason: 'parsed as a number' });
          }
        }
        break;
      }

      case 'date': {
        const result = toDate(rawValue);
        if (!result.ok) {
          issues.push(
            new MappingIssue({
              severity: 'warning',
              row: rowNumber,
              target: target.model,
              field,
              column: rule.column,
              value: rawValue,
              message: `"${rawValue}" could not be read as a date, so it was left empty.`,
            })
          );
        } else {
          assign(record, field, result.value);
          changes.push({
            row: rowNumber,
            target: target.model,
            field,
            from: rawValue,
            to: result.value.toISOString().slice(0, 10),
            reason: 'parsed as a date',
          });
        }
        break;
      }

      case 'enum': {
        const key = String(rawValue).trim().toLowerCase();
        const mapped = rule.values?.[key];
        if (mapped === undefined) {
          issues.push(
            new MappingIssue({
              severity: 'warning',
              row: rowNumber,
              target: target.model,
              field,
              column: rule.column,
              value: rawValue,
              message: `"${rawValue}" is not a recognised value; "${rule.default}" was used instead. Add it to the mapping file if it should mean something else.`,
            })
          );
          if (rule.default !== undefined) assign(record, field, rule.default);
        } else {
          assign(record, field, mapped);
          if (mapped !== String(rawValue).trim()) {
            changes.push({ row: rowNumber, target: target.model, field, from: rawValue, to: mapped, reason: 'translated' });
          }
        }
        break;
      }

      default: {
        const value = rule.transform ? TRANSFORMS[rule.transform](rawValue) : String(rawValue).trim();
        assign(record, field, value);
        if (value !== String(rawValue)) {
          changes.push({ row: rowNumber, target: target.model, field, from: rawValue, to: value, reason: rule.transform ?? 'trimmed' });
        }
      }
    }
  }

  const legacyId = target.legacyIdColumn ? String(row[target.legacyIdColumn] ?? '').trim() || null : null;

  if (target.legacyIdColumn && !legacyId) {
    issues.push(
      new MappingIssue({
        severity: 'warning',
        row: rowNumber,
        target: target.model,
        column: target.legacyIdColumn,
        message: `No value in "${target.legacyIdColumn}", so this record cannot be traced back to the old system by id.`,
      })
    );
  }

  return { record, issues, changes, legacyId, pending, skipped: false };
}

/** Checks the export has the columns the mapping depends on, before anything runs. */
export function validateColumns(headers, mapping) {
  const present = new Set(headers.map((header) => String(header).trim()));
  const issues = [];

  for (const validation of mapping.validations ?? []) {
    if (validation.rule !== 'requiredColumns') continue;
    const missing = validation.columns.filter((column) => !present.has(column));
    if (missing.length) {
      issues.push(
        new MappingIssue({
          severity: 'error',
          message: `${validation.message} Missing column(s): ${missing.join(', ')}.`,
        })
      );
    }
  }

  // Columns the mapping refers to that the export does not have — usually the
  // sign that the District's headings differ from what the mapping expects.
  const referenced = new Set();
  for (const target of mapping.targets ?? []) {
    if (target.legacyIdColumn) referenced.add(target.legacyIdColumn);
    if (target.skipWhenBlank) referenced.add(target.skipWhenBlank);
    for (const rule of Object.values(target.fields ?? {})) {
      if (rule.column) referenced.add(rule.column);
      const spec = rule.lookup ?? rule.lookupMany;
      if (spec?.column) referenced.add(spec.column);
    }
  }

  const unknown = [...referenced].filter((column) => !present.has(column));
  for (const column of unknown) {
    issues.push(
      new MappingIssue({
        severity: 'warning',
        column,
        message: `The mapping refers to a column "${column}" that is not in the export. Anything mapped from it will be empty.`,
      })
    );
  }

  return { issues, unknownColumns: unknown, presentColumns: [...present] };
}

export { TRANSFORMS, toDate, toNumber };
