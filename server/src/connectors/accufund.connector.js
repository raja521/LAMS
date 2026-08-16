/**
 * AccuFund — the District's financial system.
 *
 * A live, always-on connection is not confirmed to be available, so this is
 * deliberately a scheduled file transfer:
 *
 *   export  LAMS writes a CSV of contract and purchase-order activity into the
 *           outbound directory on a cron schedule
 *   import  LAMS reads response files the finance team drops in the inbound
 *           directory, updates the matching purchase orders, and archives them
 *
 * Directories, schedules, file naming and the fund code all come from the
 * environment, so moving to a shared drive or an SFTP mount is a config change.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import Connector from './Connector.js';
import { Contract, PurchaseOrder } from '../models/index.js';

class AccuFundConnector extends Connector {
  constructor() {
    super({
      id: 'accufund',
      name: 'AccuFund (financial system)',
      purpose: 'Nightly file exchange of contract and purchase-order activity.',
      direction: 'read-write',
      notes:
        'Scheduled file transfer rather than a live connection — a live AccuFund API has not been confirmed as available.',
      settings: () => config.connectors.accufund,
      requiredSettings: [
        { key: 'exportDir', env: 'ACCUFUND_EXPORT_DIR', description: 'Outbound directory.' },
        { key: 'importDir', env: 'ACCUFUND_IMPORT_DIR', description: 'Inbound directory.' },
        { key: 'archiveDir', env: 'ACCUFUND_ARCHIVE_DIR', description: 'Archive directory.' },
        { key: 'exportSchedule', env: 'ACCUFUND_EXPORT_SCHEDULE', description: 'Export cron expression.' },
        { key: 'importSchedule', env: 'ACCUFUND_IMPORT_SCHEDULE', description: 'Import cron expression.' },
        { key: 'filePrefix', env: 'ACCUFUND_FILE_PREFIX', description: 'Exported file name prefix.' },
      ],
    });
  }

  /** The three directories must exist and be writable for the transfer to work. */
  async checkConnection() {
    this.assertUsable();
    const checks = [];

    for (const [label, dir] of [
      ['outbound', this.config.exportDir],
      ['inbound', this.config.importDir],
      ['archive', this.config.archiveDir],
    ]) {
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.access(dir);
        checks.push(`${label} ok`);
      } catch (error) {
        return { ok: false, message: `The ${label} directory (${dir}) is not usable: ${error.message}` };
      }
    }

    const pending = await this.pendingImportFiles().catch(() => []);
    return {
      ok: true,
      message: `Directories ready (${checks.join(', ')}). ${pending.length} file(s) waiting to be imported.`,
      details: {
        exportSchedule: this.config.exportSchedule,
        importSchedule: this.config.importSchedule,
        pendingImports: pending.length,
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Export                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Write a CSV of encumbrance activity for AccuFund to pick up.
   * @param {{since?: Date}} options
   */
  async runExport({ since } = {}) {
    this.assertUsable();
    const startedAt = new Date();

    const filter = since ? { updatedAt: { $gte: since } } : {};
    const purchaseOrders = await PurchaseOrder.find(filter)
      .populate('contract', 'contractNumber title')
      .populate('parcel', 'parcelId name')
      .populate('vendor', 'name code')
      .sort({ createdAt: 1 });

    const columns = [
      'FUND_CODE',
      'PO_NUMBER',
      'CONTRACT_NUMBER',
      'VENDOR',
      'PARCEL_ID',
      'DESCRIPTION',
      'STATUS',
      'AMOUNT',
      'AMOUNT_INVOICED',
      'AMOUNT_PAID',
      'ISSUED_ON',
      'DUE_ON',
      'LAMS_ID',
    ];

    const rows = purchaseOrders.map((po) => [
      this.config.fundCode,
      po.poNumber,
      po.contract?.contractNumber ?? '',
      po.vendor?.name ?? '',
      po.parcel?.parcelId ?? '',
      po.description ?? '',
      po.status,
      (po.amount?.value ?? 0).toFixed(2),
      (po.amountInvoiced ?? 0).toFixed(2),
      (po.amountPaid ?? 0).toFixed(2),
      po.issuedOn ? po.issuedOn.toISOString().slice(0, 10) : '',
      po.dueOn ? po.dueOn.toISOString().slice(0, 10) : '',
      String(po._id),
    ]);

    const delimiter = this.config.delimiter || ',';
    const csv = [columns, ...rows]
      .map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter))
      .join('\r\n');

    await fs.mkdir(this.config.exportDir, { recursive: true });
    const stamp = startedAt.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `${this.config.filePrefix}_PO_${stamp}.csv`;
    const filePath = path.join(this.config.exportDir, filename);
    await fs.writeFile(filePath, csv, 'utf8');

    this.lastRun = { at: startedAt, operation: 'export', count: rows.length, file: filename };
    logger.info(`AccuFund export wrote ${rows.length} row(s) to ${filename}`);

    return { file: filePath, filename, rows: rows.length, startedAt, finishedAt: new Date() };
  }

  /* ---------------------------------------------------------------------- */
  /* Import                                                                 */
  /* ---------------------------------------------------------------------- */

  async pendingImportFiles() {
    const entries = await fs.readdir(this.config.importDir).catch(() => []);
    return entries.filter((name) => name.toLowerCase().endsWith('.csv'));
  }

  /**
   * Read response files and apply invoiced/paid amounts back onto purchase
   * orders. Rows that do not match anything are reported rather than dropped.
   */
  async runImport() {
    this.assertUsable();
    const startedAt = new Date();
    const files = await this.pendingImportFiles();

    const summary = { files: files.length, rows: 0, updated: 0, unmatched: [], errors: [] };

    for (const filename of files) {
      const filePath = path.join(this.config.importDir, filename);
      let records;
      try {
        const contents = await fs.readFile(filePath, 'utf8');
        records = parse(contents, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          delimiter: this.config.delimiter || ',',
        });
      } catch (error) {
        summary.errors.push({ file: filename, message: `Could not read: ${error.message}` });
        continue;
      }

      for (const record of records) {
        summary.rows += 1;
        const poNumber = record.PO_NUMBER ?? record.po_number;
        if (!poNumber) {
          summary.unmatched.push({ file: filename, reason: 'no PO_NUMBER column', record });
          continue;
        }

        const purchaseOrder = await PurchaseOrder.findOne({ poNumber: String(poNumber).toUpperCase().trim() });
        if (!purchaseOrder) {
          summary.unmatched.push({ file: filename, poNumber, reason: 'no matching purchase order in LAMS' });
          continue;
        }

        if (record.AMOUNT_INVOICED !== undefined) purchaseOrder.amountInvoiced = Number(record.AMOUNT_INVOICED) || 0;
        if (record.AMOUNT_PAID !== undefined) purchaseOrder.amountPaid = Number(record.AMOUNT_PAID) || 0;
        if (record.STATUS) purchaseOrder.status = mapStatus(record.STATUS) ?? purchaseOrder.status;

        await purchaseOrder.save();
        summary.updated += 1;
      }

      // Archive the file so the same rows are never applied twice.
      await fs.mkdir(this.config.archiveDir, { recursive: true });
      await fs
        .rename(filePath, path.join(this.config.archiveDir, `${startedAt.getTime()}-${filename}`))
        .catch((error) => summary.errors.push({ file: filename, message: `Could not archive: ${error.message}` }));
    }

    this.lastRun = { at: startedAt, operation: 'import', count: summary.updated, files: summary.files };
    logger.info(`AccuFund import: ${summary.updated} purchase order(s) updated from ${summary.files} file(s)`);

    return { ...summary, startedAt, finishedAt: new Date() };
  }

  /** Also used to link contracts by number when finance sends contract rows. */
  async resolveContract(contractNumber) {
    return Contract.findOne({ contractNumber: String(contractNumber).toUpperCase().trim() });
  }
}

function csvCell(value, delimiter) {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.includes(delimiter) || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** AccuFund status words mapped onto the LAMS purchase-order states. */
function mapStatus(value) {
  const normalized = String(value).toLowerCase().replace(/\s+/g, '_');
  const allowed = ['draft', 'issued', 'partially_received', 'received', 'invoiced', 'paid', 'cancelled'];
  return allowed.includes(normalized) ? normalized : null;
}

export default new AccuFundConnector();
