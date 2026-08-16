/**
 * The shared document generation engine.
 *
 * One implementation, used by all three modules. A template is a JSON file
 * describing blocks (headings, paragraphs, key/value pairs, tables, signature
 * lines); this renders those blocks into a real, editable .docx — a genuine Word
 * file, not an image or a PDF — stores it, and records it in generateddocuments.
 *
 * Changing how a memo reads means editing JSON under TEMPLATE_DIR. No code change.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { GeneratedDocument } from '../models/index.js';
import { loadTemplate, TEMPLATE_KINDS } from './templateService.js';
import { nextNumber, SEQUENCES } from './numberingService.js';
import storage, { documentKey } from './storageService.js';
import { recordActivity } from './activityService.js';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/* -------------------------------------------------------------------------- */
/* Placeholder resolution                                                     */
/* -------------------------------------------------------------------------- */

function valueAt(context, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), context);
}

const FORMATTERS = {
  date: (v) =>
    v == null ? '' : new Date(v).toLocaleDateString(config.documents.locale, { dateStyle: 'long' }),
  datetime: (v) =>
    v == null ? '' : new Date(v).toLocaleString(config.documents.locale, { dateStyle: 'long', timeStyle: 'short' }),
  currency: (v) =>
    v == null || v === ''
      ? ''
      : new Intl.NumberFormat(config.documents.locale, {
          style: 'currency',
          currency: config.documents.currency,
        }).format(Number(v)),
  number: (v) => (v == null || v === '' ? '' : new Intl.NumberFormat(config.documents.locale).format(Number(v))),
  upper: (v) => String(v ?? '').toUpperCase(),
  percent: (v) => (v == null || v === '' ? '' : `${Number(v).toFixed(1)}%`),
  yesno: (v) => (v ? 'Yes' : 'No'),
};

/** Replace every {{path}} or {{path | formatter}} in a string. */
export function interpolate(text, context) {
  if (typeof text !== 'string') return text ?? '';
  return text.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([a-z]+)\s*)?\}\}/gi, (_match, path, formatter) => {
    const value = valueAt(context, path.trim());
    if (formatter) {
      const fn = FORMATTERS[formatter.toLowerCase()];
      if (!fn) return String(value ?? '');
      return fn(value);
    }
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  });
}

/* -------------------------------------------------------------------------- */
/* Block renderers                                                            */
/* -------------------------------------------------------------------------- */

const ALIGN = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
};

function textParagraph(block, context) {
  const runs = block.runs
    ? block.runs.map(
        (run) =>
          new TextRun({
            text: interpolate(run.text, context),
            bold: run.bold,
            italics: run.italic,
            underline: run.underline ? {} : undefined,
            size: run.size ? run.size * 2 : undefined,
            break: run.break,
          })
      )
    : [new TextRun({ text: interpolate(block.text, context), bold: block.bold, italics: block.italic })];

  return new Paragraph({
    children: runs,
    alignment: ALIGN[block.align] ?? undefined,
    spacing: { after: (block.spaceAfter ?? 6) * 20, before: (block.spaceBefore ?? 0) * 20 },
  });
}

function headingParagraph(block, context) {
  return new Paragraph({
    text: interpolate(block.text, context),
    heading: HEADING[block.level ?? 1] ?? HeadingLevel.HEADING_1,
    alignment: ALIGN[block.align] ?? undefined,
    spacing: { after: (block.spaceAfter ?? 8) * 20, before: (block.spaceBefore ?? 12) * 20 },
  });
}

function keyValueBlock(block, context) {
  const rows = (block.items ?? [])
    .filter((item) => !item.when || Boolean(valueAt(context, item.when)))
    .map(
      (item) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: block.labelWidth ?? 30, type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({ children: [new TextRun({ text: interpolate(item.label, context), bold: true })] }),
              ],
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
            }),
            new TableCell({
              width: { size: 100 - (block.labelWidth ?? 30), type: WidthType.PERCENTAGE },
              children: [new Paragraph(interpolate(item.value, context) || '—')],
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
            }),
          ],
        })
    );

  if (rows.length === 0) return [new Paragraph('')];

  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: block.borders === false ? noBorders() : undefined,
      rows,
    }),
    new Paragraph({ text: '', spacing: { after: 120 } }),
  ];
}

function tableBlock(block, context) {
  const source = block.source ? valueAt(context, block.source) : block.rows;
  const items = Array.isArray(source) ? source : [];

  if (items.length === 0) {
    return [new Paragraph({ children: [new TextRun({ text: block.emptyText ?? 'None recorded.', italics: true })] })];
  }

  const header = new TableRow({
    tableHeader: true,
    children: block.columns.map(
      (column) =>
        new TableCell({
          width: column.width ? { size: column.width, type: WidthType.PERCENTAGE } : undefined,
          shading: { fill: block.headerFill ?? 'E8EDF1' },
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({ children: [new TextRun({ text: column.header, bold: true })] })],
        })
    ),
  });

  const body = items.map(
    (item, index) =>
      new TableRow({
        children: block.columns.map((column) => {
          // Each row is rendered against the row itself plus the outer context,
          // so a cell can reference both {{name}} and {{org.name}}.
          const rowContext = { ...context, ...item, $index: index + 1 };
          const raw = column.field ? interpolate(`{{${column.field}}}`, rowContext) : interpolate(column.text, rowContext);
          return new TableCell({
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [
              new Paragraph({
                alignment: ALIGN[column.align] ?? undefined,
                children: [new TextRun({ text: raw || '—' })],
              }),
            ],
          });
        }),
      })
  );

  return [
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [header, ...body] }),
    new Paragraph({ text: '', spacing: { after: 120 } }),
  ];
}

function listBlock(block, context) {
  const source = block.source ? valueAt(context, block.source) : block.items;
  const items = Array.isArray(source) ? source : [];

  if (items.length === 0) {
    return [new Paragraph({ children: [new TextRun({ text: block.emptyText ?? 'None.', italics: true })] })];
  }

  return items.map((item) => {
    const rowContext = typeof item === 'object' ? { ...context, ...item } : { ...context, value: item };
    return new Paragraph({
      text: interpolate(block.itemText ?? '{{value}}', rowContext),
      bullet: { level: 0 },
      spacing: { after: 40 },
    });
  });
}

function signatureBlock(block, context) {
  const children = [];
  for (const line of block.lines ?? []) {
    children.push(new Paragraph({ text: '', spacing: { before: 360 } }));
    children.push(
      new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } },
        spacing: { after: 20 },
        children: [new TextRun({ text: '' })],
      })
    );
    children.push(
      new Paragraph({ children: [new TextRun({ text: interpolate(line.label, context), bold: true })] })
    );
    if (line.subLabel) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: interpolate(line.subLabel, context), size: 18 })] })
      );
    }
  }
  return children;
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
}

function renderBlock(block, context) {
  if (block.when && !valueAt(context, block.when)) return [];
  if (block.unless && valueAt(context, block.unless)) return [];

  switch (block.type) {
    case 'heading':
      return [headingParagraph(block, context)];
    case 'paragraph':
      return [textParagraph(block, context)];
    case 'keyValue':
      return keyValueBlock(block, context);
    case 'table':
      return tableBlock(block, context);
    case 'list':
      return listBlock(block, context);
    case 'signature':
      return signatureBlock(block, context);
    case 'spacer':
      return Array.from({ length: block.lines ?? 1 }, () => new Paragraph(''));
    case 'divider':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA', space: 6 } },
          spacing: { after: 160 },
          children: [new TextRun('')],
        }),
      ];
    case 'pageBreak':
      return [new Paragraph({ pageBreakBefore: true })];
    default:
      throw ApiError.badRequest(
        `Unknown template block type "${block.type}". Supported: heading, paragraph, keyValue, table, list, signature, spacer, divider, pageBreak.`
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                  */
/* -------------------------------------------------------------------------- */

/** Turn a loaded template plus a context into a .docx buffer. */
export async function renderTemplateToBuffer(template, context) {
  const children = [];
  for (const block of template.blocks ?? []) {
    children.push(...renderBlock(block, context));
  }

  const document = new Document({
    creator: config.documents.org.name,
    title: interpolate(template.name, context),
    description: interpolate(template.description ?? '', context),
    styles: {
      default: {
        document: { run: { font: template.font ?? 'Calibri', size: (template.fontSize ?? 11) * 2 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: (template.margins?.top ?? 1) * 1440,
              bottom: (template.margins?.bottom ?? 1) * 1440,
              left: (template.margins?.left ?? 1) * 1440,
              right: (template.margins?.right ?? 1) * 1440,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: config.documents.org.name, bold: true, size: 24 })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: config.documents.org.division, size: 18 })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '888888', space: 6 } },
                children: [new TextRun({ text: config.documents.org.address, size: 16, color: '555555' })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: `${config.documents.footerText}  |  Page `, size: 14, color: '777777' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '777777' }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(document);
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Generate a document from a template, store the file and record it.
 *
 * @returns {Promise<{document: object, buffer: Buffer}>}
 */
export async function generateDocument({
  templateId,
  context = {},
  module,
  user,
  req,
  links = {},
  title,
  filenameHint,
}) {
  if (!config.features.documentGeneration) {
    throw ApiError.badRequest('Document generation is switched off (FEATURE_DOCUMENT_GENERATION=false).');
  }

  const template = await loadTemplate(TEMPLATE_KINDS.DOCUMENT, templateId);
  const documentNumber = await nextNumber(SEQUENCES.DOCUMENT);
  const now = new Date();

  // Everything a template can reference, in one object.
  const fullContext = {
    ...context,
    org: config.documents.org,
    doc: {
      number: documentNumber,
      date: now,
      templateName: template.name,
      templateId: template.id,
    },
    preparedBy: user
      ? { name: user.fullName ?? `${user.firstName} ${user.lastName}`, email: user.email, role: user.role }
      : null,
  };

  const buffer = await renderTemplateToBuffer(template, fullContext);

  const resolvedTitle = title ?? interpolate(template.titleTemplate ?? template.name, fullContext);
  const filename = `${slug(filenameHint ?? resolvedTitle)}.docx`;
  const key = documentKey({ module: module ?? template.module ?? 'general', documentNumber, filename });

  const stored = await storage.put(key, buffer, { contentType: DOCX_MIME });

  const record = await GeneratedDocument.create({
    documentNumber,
    documentType: template.documentType ?? 'other',
    title: resolvedTitle,
    template: template.id,
    templateVersion: template.version ?? '1',
    module: module ?? template.module,
    parcel: links.parcel,
    contract: links.contract,
    purchaseOrder: links.purchaseOrder,
    landApplication: links.landApplication,
    dispositionCase: links.dispositionCase,
    recipientOrganization: links.recipientOrganization,
    storage: {
      provider: stored.provider,
      key: stored.key,
      bucket: stored.bucket,
      mimeType: DOCX_MIME,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
    },
    generatedBy: user?._id,
    generatedAt: now,
  });

  await recordActivity({
    req,
    actor: user,
    action: 'generate_document',
    entityType: 'GeneratedDocument',
    entityId: record._id,
    entityLabel: documentNumber,
    module: module ?? template.module,
    summary: `Generated ${template.name} (${documentNumber}).`,
  });

  return { document: record, buffer, filename };
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export { DOCX_MIME };
