/**
 * Excel export.
 *
 * The District works in spreadsheets, so every report and dashboard view offers
 * a one-click .xlsx. This writes Office Open XML directly (a zip of XML parts),
 * which keeps the dependency surface to a zip writer and gives full control over
 * formatting — real workbooks, not CSV with an .xlsx name on it.
 */
import JSZip from 'jszip';
import config from '../config/env.js';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* -------------------------------------------------------------------------- */
/* Cell helpers                                                               */
/* -------------------------------------------------------------------------- */

/** 0 → A, 25 → Z, 26 → AA */
export function columnLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip the control characters Excel refuses to open a file with.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Excel counts days from 1899-12-30. */
function toExcelSerial(date) {
  return (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
}

/* Style indexes defined in buildStyles() below. */
const STYLE = { DEFAULT: 0, HEADER: 1, DATE: 2, CURRENCY: 3, NUMBER: 4, TITLE: 5 };

function cellXml(reference, value, type) {
  if (value === null || value === undefined || value === '') {
    return `<c r="${reference}"/>`;
  }

  switch (type) {
    case 'number':
      return `<c r="${reference}" s="${STYLE.NUMBER}"><v>${Number(value)}</v></c>`;
    case 'currency':
      return `<c r="${reference}" s="${STYLE.CURRENCY}"><v>${Number(value)}</v></c>`;
    case 'date': {
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return inlineString(reference, value, STYLE.DEFAULT);
      return `<c r="${reference}" s="${STYLE.DATE}"><v>${toExcelSerial(date)}</v></c>`;
    }
    case 'boolean':
      return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
    case 'header':
      return inlineString(reference, value, STYLE.HEADER);
    case 'title':
      return inlineString(reference, value, STYLE.TITLE);
    default:
      return inlineString(reference, value, STYLE.DEFAULT);
  }
}

function inlineString(reference, value, style) {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/* -------------------------------------------------------------------------- */
/* Sheet construction                                                         */
/* -------------------------------------------------------------------------- */

/**
 * @param {{name: string, columns: Array<{header: string, key: string, type?: string, width?: number}>,
 *          rows: object[], title?: string, subtitle?: string}} sheet
 */
function buildSheet(sheet) {
  const columns = sheet.columns ?? [];
  const rows = sheet.rows ?? [];
  const lines = [];
  let rowNumber = 0;

  const pushRow = (cells) => {
    rowNumber += 1;
    lines.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
  };

  // An optional title block above the table, so a printed report identifies itself.
  if (sheet.title) {
    pushRow([cellXml(`A${rowNumber + 1}`, sheet.title, 'title')]);
  }
  if (sheet.subtitle) {
    pushRow([cellXml(`A${rowNumber + 1}`, sheet.subtitle, 'text')]);
  }
  if (sheet.title || sheet.subtitle) {
    pushRow([]);
  }

  const headerRowNumber = rowNumber + 1;
  pushRow(columns.map((column, index) => cellXml(`${columnLetter(index)}${headerRowNumber}`, column.header, 'header')));

  for (const row of rows) {
    const currentRow = rowNumber + 1;
    pushRow(
      columns.map((column, index) =>
        cellXml(`${columnLetter(index)}${currentRow}`, resolve(row, column.key), column.type)
      )
    );
  }

  const colsXml = columns.length
    ? `<cols>${columns
        .map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? 18}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  // Freeze everything above and including the header row.
  const paneXml = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRowNumber}" topLeftCell="A${
    headerRowNumber + 1
  }" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`;

  const dimension = `A1:${columnLetter(Math.max(columns.length - 1, 0))}${Math.max(rowNumber, 1)}`;
  const autoFilter = columns.length
    ? `<autoFilter ref="A${headerRowNumber}:${columnLetter(columns.length - 1)}${Math.max(rowNumber, headerRowNumber)}"/>`
    : '';

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="${dimension}"/>${paneXml}${colsXml}` +
    `<sheetData>${lines.join('')}</sheetData>${autoFilter}` +
    `</worksheet>`
  );
}

/** Supports dotted keys so a row can be a nested document. */
function resolve(row, key) {
  if (!key) return '';
  return key.split('.').reduce((acc, part) => (acc == null ? undefined : acc[part]), row);
}

function buildStyles() {
  const currencyFormat = `&quot;${config.documents.currency === 'USD' ? '$' : ''}&quot;#,##0.00`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="2">` +
    `<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>` +
    `<numFmt numFmtId="165" formatCode="${currencyFormat}"/>` +
    `</numFmts>` +
    `<fonts count="3">` +
    `<font><sz val="11"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
    `<font><b/><sz val="14"/><name val="Calibri"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF1B4965"/><bgColor indexed="64"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="6">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`
  );
}

/* -------------------------------------------------------------------------- */
/* Public interface                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Build a real .xlsx workbook.
 *
 * @param {{sheets: Array<{name, columns, rows, title?, subtitle?}>, creator?: string}} workbook
 * @returns {Promise<Buffer>}
 */
export async function buildWorkbook({ sheets = [], creator } = {}) {
  const safeSheets = sheets.length ? sheets : [{ name: 'Sheet1', columns: [], rows: [] }];
  const zip = new JSZip();

  const sheetNames = safeSheets.map((sheet, index) => sanitiseSheetName(sheet.name, index));

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      safeSheets
        .map(
          (_sheet, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        )
        .join('') +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `</Relationships>`
  );

  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
      `xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ` +
      `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:creator>${escapeXml(creator ?? config.documents.org.name)}</dc:creator>` +
      `<cp:lastModifiedBy>${escapeXml(creator ?? config.documents.org.name)}</cp:lastModifiedBy>` +
      `</cp:coreProperties>`
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>` +
      sheetNames
        .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join('') +
      `</sheets></workbook>`
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      safeSheets
        .map(
          (_sheet, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${
              index + 1
            }.xml"/>`
        )
        .join('') +
      `<Relationship Id="rId${safeSheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  );

  zip.file('xl/styles.xml', buildStyles());

  safeSheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, buildSheet(sheet));
  });

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Excel rejects these characters in a tab name, and caps the length at 31. */
function sanitiseSheetName(name, index) {
  const cleaned = String(name ?? `Sheet${index + 1}`)
    .replace(/[\\/?*[\]:]/g, ' ')
    .trim()
    .slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

export default { buildWorkbook, columnLetter, XLSX_MIME };
