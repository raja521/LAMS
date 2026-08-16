import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * The migration tool and the document engine are the two places where a mistake
 * is most expensive — one silently corrupts the District's records, the other
 * produces paperwork that goes to a board. These cover the migration side.
 *
 * No database or server is needed: the mapper and the reader are pure.
 */
const { mapRow, validateColumns, toDate, toNumber } = await import('../scripts/import/lib/mapper.js');
const { readSource } = await import('../scripts/import/lib/sourceReader.js');

const parcelTarget = {
  model: 'Parcel',
  key: 'Parcel',
  primary: true,
  legacyIdColumn: 'ParcelKey',
  skipWhenBlank: 'ParcelNumber',
  dedupeOn: 'parcelId',
  fields: {
    parcelId: { column: 'ParcelNumber', required: true, transform: 'uppercase' },
    name: { column: 'PropertyName', required: true, fallback: 'Parcel {{ParcelNumber}}' },
    county: { column: 'County', required: true, default: 'Unknown' },
    'area.value': { column: 'Acres', type: 'number', default: 0 },
    'area.unit': { const: 'acres' },
    status: {
      column: 'Status',
      type: 'enum',
      default: 'management',
      values: { active: 'management', sold: 'disposition', pending: 'acquisition' },
    },
    acquiredOn: { column: 'AcquiredDate', type: 'date' },
  },
};

describe('Reading the District’s export', () => {
  async function writeTemp(name, contents) {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'lams-migration-')), name);
    await fs.writeFile(file, contents, 'utf8');
    return file;
  }

  it('reads a well-formed CSV into rows keyed by the District’s own headings', async () => {
    const file = await writeTemp('export.csv', 'ParcelNumber,PropertyName,Acres\nP-1,North Ridge,142.5\nP-2,Cedar Creek,88\n');
    const { rows, malformed } = await readSource(file);

    assert.equal(rows.length, 2);
    assert.equal(malformed.length, 0);
    assert.deepEqual(rows[0], { ParcelNumber: 'P-1', PropertyName: 'North Ridge', Acres: '142.5' });
  });

  it('refuses a row with too few columns instead of shifting values into the wrong fields', async () => {
    // Without this check, "142.5" would silently land in PropertyName.
    const file = await writeTemp('short.csv', 'ParcelNumber,PropertyName,County,Acres\nP-1,North Ridge,142.5\n');
    const { rows, malformed } = await readSource(file);

    assert.equal(rows.length, 0, 'the malformed row is not imported');
    assert.equal(malformed.length, 1);
    assert.match(malformed[0].message, /would land in the wrong columns/i);
  });

  it('reports a row with too many columns rather than dropping the extras quietly', async () => {
    const file = await writeTemp('long.csv', 'ParcelNumber,PropertyName\nP-1,North Ridge,extra-value\n');
    const { rows, malformed } = await readSource(file);

    assert.equal(rows.length, 0);
    assert.match(malformed[0].message, /extra value/i);
  });

  it('strips the byte-order mark Excel adds, so the first column name survives', async () => {
    const file = await writeTemp('bom.csv', '﻿ParcelNumber,PropertyName\nP-1,North Ridge\n');
    const { rows } = await readSource(file);

    assert.deepEqual(Object.keys(rows[0]), ['ParcelNumber', 'PropertyName']);
  });

  it('refuses a file format it cannot read, naming what is supported', async () => {
    const file = await writeTemp('export.pdf', 'not a spreadsheet');
    await assert.rejects(() => readSource(file), /Supported exports are \.csv, \.tsv and \.xlsx/);
  });
});

describe('Mapping old fields onto new ones', () => {
  it('carries the original identifier across so a record can be traced back', () => {
    const { legacyId } = mapRow(
      { ParcelKey: 'LT-1001', ParcelNumber: 'p-1', PropertyName: 'North Ridge', County: 'Hennepin' },
      parcelTarget,
      2
    );
    assert.equal(legacyId, 'LT-1001');
  });

  it('applies the transforms the mapping asks for, and records the change', () => {
    const { record, changes } = mapRow(
      { ParcelKey: 'LT-1', ParcelNumber: 'p-0001', PropertyName: 'North Ridge', County: 'Hennepin' },
      parcelTarget,
      2
    );

    assert.equal(record.parcelId, 'P-0001');
    assert.ok(changes.some((change) => change.field === 'parcelId' && change.from === 'p-0001' && change.to === 'P-0001'));
  });

  it('translates the old system’s status words into the new ones', () => {
    const sold = mapRow({ ParcelNumber: 'P-1', PropertyName: 'X', County: 'Y', Status: 'Sold' }, parcelTarget, 2);
    assert.equal(sold.record.status, 'disposition');

    const pending = mapRow({ ParcelNumber: 'P-2', PropertyName: 'X', County: 'Y', Status: 'pending' }, parcelTarget, 3);
    assert.equal(pending.record.status, 'acquisition');
  });

  it('flags an unrecognised status rather than guessing silently', () => {
    const { record, issues } = mapRow(
      { ParcelNumber: 'P-1', PropertyName: 'X', County: 'Y', Status: 'mothballed' },
      parcelTarget,
      7
    );

    assert.equal(record.status, 'management', 'the documented default is used');
    const issue = issues.find((entry) => entry.field === 'status');
    assert.equal(issue.severity, 'warning');
    assert.match(issue.message, /not a recognised value/i);
    assert.match(issue.message, /Add it to the mapping file/i);
  });

  it('reports a number it cannot read instead of importing a wrong figure', () => {
    const { record, issues } = mapRow(
      { ParcelNumber: 'P-1', PropertyName: 'X', County: 'Y', Acres: 'not-a-number' },
      parcelTarget,
      9
    );

    const issue = issues.find((entry) => entry.field === 'area.value');
    assert.equal(issue.severity, 'error');
    assert.equal(record.area.value, 0, 'the default is applied so the record still saves');
  });

  it('understands the date formats an export actually contains', () => {
    assert.equal(toDate('3/14/2019').value.toISOString().slice(0, 10), '2019-03-14');
    assert.equal(toDate('2020-07-02').value.toISOString().slice(0, 10), '2020-07-02');
    // Excel writes dates as a serial number when a column is not text-formatted.
    assert.equal(toDate('44197').value.toISOString().slice(0, 10), '2021-01-01');
    assert.equal(toDate('rubbish').ok, false);
  });

  it('understands the number formats an export actually contains', () => {
    assert.equal(toNumber('48,000.00').value, 48000);
    assert.equal(toNumber('$12,500').value, 12500);
    assert.equal(toNumber('(500)').value, -500, 'accounting negatives');
    assert.equal(toNumber('abc').ok, false);
  });

  it('falls back rather than failing when an optional name is missing', () => {
    const { record, changes } = mapRow({ ParcelNumber: 'P-9', County: 'Y' }, parcelTarget, 2);

    assert.equal(record.name, 'Parcel P-9');
    assert.ok(changes.some((change) => change.reason === 'fallback'));
  });

  it('skips a target the row has nothing to say about, rather than inventing a record', () => {
    const { skipped, record } = mapRow({ ParcelNumber: '', PropertyName: 'No parcel number' }, parcelTarget, 2);

    assert.equal(skipped, true);
    assert.equal(record, null);
  });

  it('refuses to run when the export is missing a column the mapping depends on', () => {
    const mapping = {
      targets: [parcelTarget],
      validations: [
        { rule: 'requiredColumns', columns: ['ParcelNumber', 'County'], message: 'The export must have these.' },
      ],
    };

    const { issues } = validateColumns(['ParcelNumber', 'PropertyName'], mapping);
    const blocking = issues.filter((issue) => issue.severity === 'error');

    assert.equal(blocking.length, 1);
    assert.match(blocking[0].message, /Missing column\(s\): County/);
  });

  it('warns about mapped columns the export does not contain', () => {
    const { issues, unknownColumns } = validateColumns(['ParcelNumber', 'PropertyName', 'County'], {
      targets: [parcelTarget],
    });

    assert.ok(unknownColumns.includes('Acres'));
    assert.ok(issues.some((issue) => issue.severity === 'warning' && /Acres/.test(issue.message)));
  });
});
