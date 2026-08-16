/**
 * Reporting.
 *
 * Each report is a dataset (a real query, defined here) plus a presentation
 * (columns, labels, widths — defined in templates/reports/*.json, so staff can
 * change what a report shows without a developer).
 *
 * Every report accepts the same filters — property, region, county, program,
 * status and a date range — so the report screen is one screen rather than one
 * per report, and can be run on demand or on a schedule.
 */
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import {
  Contract,
  DispositionCase,
  GeneratedDocument,
  LandApplication,
  MaintenanceTask,
  ManagementPlan,
  Parcel,
  PurchaseOrder,
  TimberActivity,
} from '../models/index.js';
import { listTemplates, loadTemplate, TEMPLATE_KINDS } from './templateService.js';

export const REPORT_TEMPLATE_KIND = 'reports';

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Each dataset says which of its fields the shared filters map onto, so
 * "county" means the right thing whether the rows are parcels or applications.
 */
function applyFilters(filters = {}, map = {}) {
  const query = {};

  const set = (field, value) => {
    if (field && value !== undefined && value !== null && value !== '') query[field] = value;
  };

  set(map.parcel, filters.parcel);
  set(map.region, filters.region);
  set(map.county, filters.county);
  set(map.program, filters.program);
  set(map.status, filters.status);
  set(map.module, filters.module);

  if (map.date && (filters.dateFrom || filters.dateTo)) {
    query[map.date] = {};
    if (filters.dateFrom) query[map.date].$gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      // Inclusive of the whole end day.
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      query[map.date].$lte = end;
    }
  }

  return query;
}

/* -------------------------------------------------------------------------- */
/* Datasets                                                                   */
/* -------------------------------------------------------------------------- */

const DATASETS = {
  parcels: {
    label: 'Land holdings',
    filterMap: { parcel: '_id', region: 'region', county: 'county', program: 'program', status: 'status', date: 'acquiredOn' },
    async run(filters, limit) {
      const rows = await Parcel.find(applyFilters(filters, this.filterMap))
        .populate('program', 'name code')
        .populate('assignedTo', 'firstName lastName email')
        .sort({ parcelId: 1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        parcelId: row.parcelId,
        name: row.name,
        region: row.region,
        county: row.county,
        acres: row.area?.value ?? 0,
        areaUnit: row.area?.unit ?? '',
        program: row.program?.name ?? row.programName ?? '',
        status: row.status,
        acquiredOn: row.acquiredOn ?? null,
        disposedOn: row.disposedOn ?? null,
        assignedTo: row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : '',
        legacyId: row.legacy?.id ?? '',
      }));
    },
  },

  applications: {
    label: 'Acquisition applications',
    filterMap: {
      parcel: 'parcel',
      region: 'property.region',
      county: 'property.county',
      program: 'program',
      status: 'status',
      date: 'submittedAt',
    },
    async run(filters, limit) {
      const rows = await LandApplication.find(applyFilters(filters, this.filterMap))
        .populate('program', 'name')
        .populate('assignedTo', 'firstName lastName')
        .sort({ submittedAt: -1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        fileNumber: row.fileNumber,
        applicant: row.applicant?.name ?? '',
        property: row.property?.description ?? '',
        county: row.property?.county ?? '',
        region: row.property?.region ?? '',
        acres: row.property?.acres ?? 0,
        askingPrice: row.property?.askingPrice ?? 0,
        status: row.status,
        source: row.source,
        submittedAt: row.submittedAt,
        assignedTo: row.assignedTo ? `${row.assignedTo.firstName} ${row.assignedTo.lastName}` : '',
        legacyId: row.legacy?.id ?? '',
      }));
    },
  },

  tasks: {
    label: 'Maintenance tasks',
    filterMap: { parcel: 'parcel', status: 'status', date: 'scheduledStart' },
    async run(filters, limit) {
      const query = applyFilters(filters, this.filterMap);

      // Region/county live on the parcel, so narrow by parcel first.
      const parcelQuery = applyFilters(filters, { region: 'region', county: 'county', program: 'program' });
      if (Object.keys(parcelQuery).length) {
        const parcels = await Parcel.find(parcelQuery).select('_id');
        query.parcel = { $in: parcels.map((p) => p._id) };
      }

      const rows = await MaintenanceTask.find(query)
        .populate('parcel', 'parcelId name county region')
        .populate('contract', 'contractNumber')
        .populate('purchaseOrder', 'poNumber')
        .populate('vendor', 'name')
        .sort({ scheduledStart: 1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        title: row.title,
        taskType: row.taskType,
        parcelId: row.parcel?.parcelId ?? '',
        parcelName: row.parcel?.name ?? '',
        county: row.parcel?.county ?? '',
        region: row.parcel?.region ?? '',
        contractNumber: row.contract?.contractNumber ?? '',
        poNumber: row.purchaseOrder?.poNumber ?? '',
        vendor: row.vendor?.name ?? '',
        scheduledStart: row.scheduledStart ?? null,
        scheduledEnd: row.scheduledEnd ?? null,
        completedOn: row.completedOn ?? null,
        acres: row.acres ?? 0,
        estimatedCost: row.estimatedCost ?? 0,
        actualCost: row.actualCost ?? 0,
        status: row.status,
      }));
    },
  },

  contracts: {
    label: 'Contracts',
    filterMap: { parcel: 'parcels', program: 'program', status: 'status', module: 'module', date: 'startDate' },
    async run(filters, limit) {
      const rows = await Contract.find(applyFilters(filters, this.filterMap))
        .populate('vendor', 'name')
        .populate('parcels', 'parcelId name county')
        .sort({ startDate: -1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        contractNumber: row.contractNumber,
        title: row.title,
        type: row.type,
        vendor: row.vendor?.name ?? '',
        parcels: (row.parcels ?? []).map((p) => p.parcelId).join(', '),
        module: row.module,
        value: row.value?.amount ?? 0,
        startDate: row.startDate ?? null,
        endDate: row.endDate ?? null,
        status: row.status,
        legacyId: row.legacy?.id ?? '',
      }));
    },
  },

  purchaseOrders: {
    label: 'Purchase orders',
    filterMap: { parcel: 'parcel', status: 'status', date: 'issuedOn' },
    async run(filters, limit) {
      const rows = await PurchaseOrder.find(applyFilters(filters, this.filterMap))
        .populate('contract', 'contractNumber title')
        .populate('parcel', 'parcelId name')
        .populate('vendor', 'name')
        .sort({ issuedOn: -1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        poNumber: row.poNumber,
        contractNumber: row.contract?.contractNumber ?? '',
        parcelId: row.parcel?.parcelId ?? '',
        vendor: row.vendor?.name ?? '',
        description: row.description ?? '',
        amount: row.amount?.value ?? 0,
        amountInvoiced: row.amountInvoiced ?? 0,
        amountPaid: row.amountPaid ?? 0,
        outstanding: (row.amount?.value ?? 0) - (row.amountPaid ?? 0),
        issuedOn: row.issuedOn ?? null,
        dueOn: row.dueOn ?? null,
        status: row.status,
      }));
    },
  },

  dispositions: {
    label: 'Disposition cases',
    filterMap: { parcel: 'parcel', status: 'status', date: 'createdAt' },
    async run(filters, limit) {
      const rows = await DispositionCase.find(applyFilters(filters, this.filterMap))
        .populate('parcel', 'parcelId name county region area')
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        caseNumber: row.caseNumber,
        parcelId: row.parcel?.parcelId ?? '',
        parcelName: row.parcel?.name ?? '',
        county: row.parcel?.county ?? '',
        region: row.parcel?.region ?? '',
        acres: row.parcel?.area?.value ?? 0,
        method: row.method,
        estimatedValue: row.estimatedValue ?? 0,
        appraisedValue: row.appraisedValue ?? 0,
        salePrice: row.salePrice ?? 0,
        status: row.status,
        listedOn: row.listedOn ?? null,
        closedOn: row.closedOn ?? null,
      }));
    },
  },

  documents: {
    label: 'Generated documents',
    filterMap: { parcel: 'parcel', module: 'module', date: 'generatedAt' },
    async run(filters, limit) {
      const rows = await GeneratedDocument.find(applyFilters(filters, this.filterMap))
        .populate('generatedBy', 'firstName lastName email')
        .populate('parcel', 'parcelId')
        .sort({ generatedAt: -1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        documentNumber: row.documentNumber,
        title: row.title,
        documentType: row.documentType,
        module: row.module ?? '',
        template: row.template,
        parcelId: row.parcel?.parcelId ?? '',
        generatedBy: row.generatedBy ? `${row.generatedBy.firstName} ${row.generatedBy.lastName}` : '',
        generatedAt: row.generatedAt,
        sizeBytes: row.storage?.sizeBytes ?? 0,
      }));
    },
  },

  timber: {
    label: 'Timber activity',
    filterMap: { parcel: 'parcel', status: 'status', date: 'occurredOn' },
    async run(filters, limit) {
      const rows = await TimberActivity.find(applyFilters(filters, this.filterMap))
        .populate('parcel', 'parcelId name county')
        .sort({ occurredOn: -1 })
        .limit(limit)
        .lean();

      return rows.map((row) => ({
        title: row.title,
        activityType: row.activityType,
        parcelId: row.parcel?.parcelId ?? '',
        county: row.parcel?.county ?? '',
        occurredOn: row.occurredOn ?? null,
        saleNumber: row.sale?.saleNumber ?? '',
        acres: row.sale?.acres ?? row.inventory?.acresCruised ?? row.reforestation?.acres ?? 0,
        volume: row.sale?.estimatedVolume ?? row.inventory?.totalVolume ?? 0,
        loadCount: row.loads?.length ?? 0,
        loadVolume: (row.loads ?? []).reduce((sum, load) => sum + (load.volume ?? 0), 0),
        loadValue: (row.loads ?? []).reduce((sum, load) => sum + (load.value ?? 0), 0),
        awardedAmount: row.sale?.awardedAmount ?? 0,
        status: row.status,
      }));
    },
  },

  plans: {
    label: 'Multi-year plans',
    filterMap: { parcel: 'parcel', program: 'program', status: 'status' },
    async run(filters, limit) {
      const rows = await ManagementPlan.find(applyFilters(filters, this.filterMap))
        .populate('parcel', 'parcelId name county region')
        .sort({ startYear: -1 })
        .limit(limit)
        .lean();

      return rows.flatMap((row) =>
        (row.years ?? [])
          .filter((year) => year.planned)
          .map((year) => ({
            parcelId: row.parcel?.parcelId ?? '',
            parcelName: row.parcel?.name ?? '',
            county: row.parcel?.county ?? '',
            region: row.parcel?.region ?? '',
            planName: row.name,
            programArea: row.programArea,
            year: year.year,
            activity: year.activity ?? '',
            acres: year.acres ?? 0,
            estimatedCost: year.estimatedCost ?? 0,
            status: year.status,
          }))
      );
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Public interface                                                           */
/* -------------------------------------------------------------------------- */

export async function listReports() {
  const templates = await listTemplates(REPORT_TEMPLATE_KIND);
  return templates.filter((template) => Boolean(template));
}

export async function loadReport(reportId) {
  const template = await loadTemplate(REPORT_TEMPLATE_KIND, reportId);
  if (!DATASETS[template.dataset]) {
    throw ApiError.badRequest(
      `Report "${reportId}" names an unknown dataset "${template.dataset}". Available: ${Object.keys(DATASETS).join(', ')}.`
    );
  }
  return template;
}

/**
 * Run a report and return its rows plus the totals row, if the template asks
 * for one.
 */
export async function runReport(reportId, filters = {}) {
  const template = await loadReport(reportId);
  const dataset = DATASETS[template.dataset];

  // One more than the cap, so we can tell the difference between "exactly the
  // cap" and "more than we are willing to return".
  const limit = config.reporting.maxRows + 1;
  const allRows = await dataset.run.call(dataset, filters, limit);

  const truncated = allRows.length > config.reporting.maxRows;
  const rows = truncated ? allRows.slice(0, config.reporting.maxRows) : allRows;

  return {
    report: {
      id: template.id,
      name: template.name,
      description: template.description ?? null,
      dataset: template.dataset,
      module: template.module ?? null,
      columns: template.columns,
    },
    filters,
    rows,
    rowCount: rows.length,
    truncated,
    totals: template.totals ? computeTotals(rows, template.totals) : null,
    generatedAt: new Date().toISOString(),
  };
}

/** Column totals named by the template, e.g. ["estimatedCost", "acres"]. */
function computeTotals(rows, fields) {
  const totals = {};
  for (const field of fields) {
    totals[field] = rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  }
  return totals;
}

export function availableDatasets() {
  return Object.entries(DATASETS).map(([id, dataset]) => ({ id, label: dataset.label }));
}

export { DATASETS };
