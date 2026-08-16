/**
 * Reads the District's export.
 *
 * Handles both of the formats an export is likely to arrive in — a CSV or an
 * Excel workbook — and returns plain rows keyed by the column headings, so the
 * mapping file can refer to the District's own column names.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import JSZip from 'jszip';

/* -------------------------------------------------------------------------- */
/* CSV                                                                        */
/* -------------------------------------------------------------------------- */

async function readCsv(filePath, { delimiter } = {}) {
  const contents = await fs.readFile(filePath, 'utf8');
  // Strip a UTF-8 BOM, which Excel adds and which otherwise corrupts the first
  // column name.
  const clean = contents.replace(/^﻿/, '');

  const chosenDelimiter = delimiter ?? guessDelimiter(clean);

  /*
   * Raw parse first, so a row with the wrong number of fields can be reported
   * rather than silently shifting every later value into the wrong column —
   * the kind of mistake that is very hard to spot once it is in the database.
   */
  const raw = parse(clean, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    delimiter: chosenDelimiter,
  });

  if (raw.length === 0) return { rows: [], sheetName: path.basename(filePath), malformed: [] };

  const headers = raw[0].map((header) => String(header).trim());
  const malformed = [];
  const rows = [];

  raw.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2;

    if (cells.length !== headers.length) {
      malformed.push({
        row: rowNumber,
        expected: headers.length,
        found: cells.length,
        message:
          cells.length < headers.length
            ? `Row ${rowNumber} has ${cells.length} values but the header has ${headers.length}. Values after the missing one would land in the wrong columns.`
            : `Row ${rowNumber} has ${cells.length} values but the header has only ${headers.length}. The extra value(s) would be dropped.`,
      });
      return;
    }

    const row = {};
    headers.forEach((header, columnIndex) => {
      if (header) row[header] = cells[columnIndex] ?? '';
    });
    rows.push(row);
  });

  return { rows, sheetName: path.basename(filePath), malformed };
}

function guessDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const counts = [
    [',', (firstLine.match(/,/g) ?? []).length],
    [';', (firstLine.match(/;/g) ?? []).length],
    ['\t', (firstLine.match(/\t/g) ?? []).length],
    ['|', (firstLine.match(/\|/g) ?? []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

/* -------------------------------------------------------------------------- */
/* XLSX                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Minimal SpreadsheetML reader: enough to pull a rectangular sheet of values
 * out of a workbook, which is all a data export ever is.
 */
async function readXlsx(filePath, { sheet } = {}) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));

  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  if (!workbookXml) throw new Error('That file is not a readable Excel workbook (no xl/workbook.xml).');

  const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => decodeXml(m[1]));
  const index = sheet ? sheetNames.findIndex((name) => name === sheet) : 0;
  if (index === -1) {
    throw new Error(`The workbook has no sheet named "${sheet}". Available: ${sheetNames.join(', ')}.`);
  }

  const sharedStrings = await readSharedStrings(zip);
  const sheetXml = await zip.file(`xl/worksheets/sheet${index + 1}.xml`)?.async('string');
  if (!sheetXml) throw new Error(`Could not read sheet ${index + 1} from the workbook.`);

  const grid = parseSheet(sheetXml, sharedStrings);
  if (grid.length === 0) return { rows: [], sheetName: sheetNames[index] };

  const headers = (grid[0] ?? []).map((value, columnIndex) => String(value ?? `column${columnIndex + 1}`).trim());
  const rows = grid.slice(1).map((cells) => {
    const row = {};
    headers.forEach((header, columnIndex) => {
      if (header) row[header] = cells[columnIndex] ?? '';
    });
    return row;
  });

  // Drop rows that are entirely blank, which trailing formatting often leaves.
  return {
    rows: rows.filter((row) => Object.values(row).some((value) => String(value ?? '').trim() !== '')),
    sheetName: sheetNames[index],
  };
}

async function readSharedStrings(zip) {
  const xml = await zip.file('xl/sharedStrings.xml')?.async('string');
  if (!xml) return [];

  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => {
    // A shared string can be split across several <t> runs.
    const parts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]));
    return parts.join('');
  });
}

function parseSheet(xml, sharedStrings) {
  const grid = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];

    for (const cellMatch of rowMatch[2].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];

      const reference = /r="([A-Z]+)\d+"/.exec(attributes)?.[1] ?? '';
      const columnIndex = columnIndexOf(reference);
      const type = /t="([^"]+)"/.exec(attributes)?.[1];

      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join('');
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (raw !== undefined) {
          value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : decodeXml(raw);
        }
      }

      cells[columnIndex] = value;
    }

    grid.push(cells);
  }

  return grid;
}

/** "AB" → 27 */
function columnIndexOf(letters) {
  let index = 0;
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64);
  return Math.max(index - 1, 0);
}

function decodeXml(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/* -------------------------------------------------------------------------- */

/**
 * @returns {Promise<{rows: object[], sheetName: string, format: string}>}
 */
export async function readSource(filePath, options = {}) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.csv' || extension === '.txt' || extension === '.tsv') {
    const result = await readCsv(filePath, options);
    return { ...result, format: 'csv' };
  }
  if (extension === '.xlsx') {
    const result = await readXlsx(filePath, options);
    return { ...result, format: 'xlsx' };
  }

  throw new Error(
    `Cannot read "${path.basename(filePath)}". Supported exports are .csv, .tsv and .xlsx — convert the file and try again.`
  );
}

export { readCsv, readXlsx };
