import { Router } from 'express';
import config from '../config/env.js';
import {
  Contract,
  GeneratedDocument,
  MaintenanceTask,
  ManagementPlan,
  Parcel,
  PurchaseOrder,
  TimberActivity,
  PROGRAM_AREAS,
  TASK_TYPES,
  TIMBER_ACTIVITY_TYPES,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { diffFields } from '../services/activityService.js';
import { ACTIONS, MODULES } from '../config/permissions.js';
import { generateDocument } from '../services/documentService.js';
import { nextNumber, SEQUENCES } from '../services/numberingService.js';
import { advanceParcelToDisposition } from '../services/transitionService.js';

const router = Router();
const MODULE = MODULES.MANAGEMENT;

router.use(authenticate, auditMutations({ module: MODULE }));

/** Enumerations the screens need, straight from the schema. */
router.get(
  '/options',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (_req, res) => {
    res.json({
      programAreas: PROGRAM_AREAS,
      taskTypes: TASK_TYPES,
      timberActivityTypes: TIMBER_ACTIVITY_TYPES,
      timberEnabled: config.features.timber,
    });
  })
);

/* -------------------------------------------------------------------------- */
/* Multi-year planning, by program area                                       */
/* -------------------------------------------------------------------------- */

router.get(
  '/plans',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const { parcel, programArea, status, year } = req.query;
    const filter = {};
    if (parcel) filter.parcel = parcel;
    if (programArea) filter.programArea = programArea;
    if (status) filter.status = status;
    if (year) filter.$and = [{ startYear: { $lte: Number(year) } }, { endYear: { $gte: Number(year) } }];

    const items = await ManagementPlan.find(filter)
      .populate('parcel', 'parcelId name county region')
      .populate('responsible', 'firstName lastName email')
      .sort({ startYear: -1, programArea: 1 });

    res.json({ items, total: items.length });
  })
);

/**
 * The planning grid: one row per parcel and program area, one column per year.
 * Built server-side so the screen does not have to reshape it.
 */
router.get(
  '/plans/grid',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const startYear = Number(req.query.startYear ?? new Date().getFullYear());
    const span = Math.min(Number(req.query.span ?? 5), 20);
    const years = Array.from({ length: span }, (_, index) => startYear + index);

    const plans = await ManagementPlan.find({
      startYear: { $lte: startYear + span - 1 },
      endYear: { $gte: startYear },
    }).populate('parcel', 'parcelId name county');

    const rows = plans.map((plan) => ({
      planId: plan._id,
      parcel: plan.parcel,
      programArea: plan.programArea,
      name: plan.name,
      status: plan.status,
      cells: years.map((year) => {
        const entry = (plan.years ?? []).find((y) => y.year === year);
        return entry
          ? {
              year,
              planned: entry.planned,
              activity: entry.activity,
              estimatedCost: entry.estimatedCost,
              status: entry.status,
              acres: entry.acres,
            }
          : { year, planned: false };
      }),
    }));

    res.json({ years, rows, total: rows.length });
  })
);

router.post(
  '/plans',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const startYear = Number(body.startYear ?? new Date().getFullYear());
    const endYear = Number(body.endYear ?? startYear + 4);
    if (endYear < startYear) throw ApiError.badRequest('The end year cannot be before the start year.');

    const plan = await ManagementPlan.create({
      ...body,
      startYear,
      endYear,
      // Seed a row for every year so the grid has something to edit.
      years:
        body.years ??
        Array.from({ length: endYear - startYear + 1 }, (_, index) => ({
          year: startYear + index,
          planned: false,
          estimatedCost: 0,
          status: 'planned',
        })),
      createdBy: req.user._id,
    });

    res.locals.audit = {
      entityType: 'ManagementPlan',
      entityId: plan._id,
      entityLabel: plan.name,
      summary: `Created management plan "${plan.name}".`,
    };
    res.status(201).json(plan);
  })
);

router.patch(
  '/plans/:id',
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const plan = await ManagementPlan.findById(req.params.id);
    if (!plan) throw ApiError.notFound('That plan does not exist.');

    const fields = ['name', 'description', 'programArea', 'program', 'startYear', 'endYear', 'years', 'status', 'responsible'];
    const before = pick(plan.toObject(), fields);
    Object.assign(plan, pick(req.body ?? {}, fields));
    plan.updatedBy = req.user._id;
    await plan.save();

    res.locals.audit = {
      entityType: 'ManagementPlan',
      entityId: plan._id,
      entityLabel: plan.name,
      changes: diffFields(before, pick(plan.toObject(), fields), fields),
      summary: `Updated management plan "${plan.name}".`,
    };
    res.json(plan);
  })
);

router.delete(
  '/plans/:id',
  requirePermission(ACTIONS.DELETE, MODULE),
  asyncHandler(async (req, res) => {
    const plan = await ManagementPlan.findById(req.params.id);
    if (!plan) throw ApiError.notFound('That plan does not exist.');
    await plan.deleteOne();
    res.locals.audit = { entityType: 'ManagementPlan', entityId: plan._id, entityLabel: plan.name, summary: `Deleted plan "${plan.name}".` };
    res.status(204).end();
  })
);

/* -------------------------------------------------------------------------- */
/* Task scheduler                                                             */
/* -------------------------------------------------------------------------- */

router.get(
  '/tasks',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const { parcel, taskType, status, from, to, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (parcel) filter.parcel = parcel;
    if (taskType) filter.taskType = taskType;
    if (status) filter.status = status;
    if (from || to) {
      filter.scheduledStart = {};
      if (from) filter.scheduledStart.$gte = new Date(from);
      if (to) filter.scheduledStart.$lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      MaintenanceTask.find(filter)
        .populate('parcel', 'parcelId name county')
        .populate('contract', 'contractNumber title')
        .populate('purchaseOrder', 'poNumber amount status')
        .populate('assignedTo', 'firstName lastName email')
        .populate('vendor', 'name')
        .sort({ scheduledStart: 1 })
        .skip(skip)
        .limit(Number(limit)),
      MaintenanceTask.countDocuments(filter),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  })
);

router.post(
  '/tasks',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const task = await MaintenanceTask.create({ ...(req.body ?? {}), createdBy: req.user._id });
    await task.populate('parcel', 'parcelId name');

    res.locals.audit = {
      entityType: 'MaintenanceTask',
      entityId: task._id,
      entityLabel: task.title,
      summary: `Scheduled "${task.title}" on ${task.parcel?.parcelId ?? 'a parcel'}.`,
    };
    res.status(201).json(task);
  })
);

router.patch(
  '/tasks/:id',
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const task = await MaintenanceTask.findById(req.params.id);
    if (!task) throw ApiError.notFound('That task does not exist.');

    const fields = [
      'title', 'description', 'taskType', 'programArea', 'parcel', 'contract', 'purchaseOrder',
      'managementPlan', 'status', 'priority', 'scheduledStart', 'scheduledEnd', 'acres',
      'estimatedCost', 'actualCost', 'assignedTo', 'vendor', 'notes',
    ];
    const before = pick(task.toObject(), fields);
    Object.assign(task, pick(req.body ?? {}, fields));

    if (req.body?.status === 'complete' && !task.completedOn) task.completedOn = new Date();
    if (req.body?.status && req.body.status !== 'complete') task.completedOn = undefined;

    task.updatedBy = req.user._id;
    await task.save();

    res.locals.audit = {
      entityType: 'MaintenanceTask',
      entityId: task._id,
      entityLabel: task.title,
      changes: diffFields(before, pick(task.toObject(), fields), fields),
      summary: `Updated task "${task.title}".`,
    };
    res.json(task);
  })
);

router.delete(
  '/tasks/:id',
  requirePermission(ACTIONS.DELETE, MODULE),
  asyncHandler(async (req, res) => {
    const task = await MaintenanceTask.findById(req.params.id);
    if (!task) throw ApiError.notFound('That task does not exist.');
    await task.deleteOne();
    res.locals.audit = { entityType: 'MaintenanceTask', entityId: task._id, entityLabel: task.title, summary: `Deleted task "${task.title}".` };
    res.status(204).end();
  })
);

/* -------------------------------------------------------------------------- */
/* Contracts and purchase orders — the money side of a task                   */
/* -------------------------------------------------------------------------- */

router.get(
  '/contracts',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const filter = req.query.parcel ? { parcels: req.query.parcel } : {};
    const items = await Contract.find(filter)
      .populate('vendor', 'name')
      .populate('parcels', 'parcelId name')
      .sort({ createdAt: -1 });
    res.json({ items, total: items.length });
  })
);

router.post(
  '/contracts',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const contract = await Contract.create({
      ...(req.body ?? {}),
      // Assigned automatically, like every other reference number.
      contractNumber: req.body?.contractNumber ?? (await nextNumber(SEQUENCES.CONTRACT)),
      module: MODULE,
      createdBy: req.user._id,
    });
    res.locals.audit = {
      entityType: 'Contract',
      entityId: contract._id,
      entityLabel: contract.contractNumber,
      summary: `Created contract ${contract.contractNumber}.`,
    };
    res.status(201).json(contract);
  })
);

router.get(
  '/purchase-orders',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.contract) filter.contract = req.query.contract;
    if (req.query.parcel) filter.parcel = req.query.parcel;
    const items = await PurchaseOrder.find(filter)
      .populate('contract', 'contractNumber title')
      .populate('parcel', 'parcelId name')
      .populate('vendor', 'name')
      .sort({ createdAt: -1 });
    res.json({ items, total: items.length });
  })
);

router.post(
  '/purchase-orders',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const purchaseOrder = await PurchaseOrder.create({
      ...(req.body ?? {}),
      poNumber: req.body?.poNumber ?? (await nextNumber(SEQUENCES.PURCHASE_ORDER)),
      createdBy: req.user._id,
    });
    res.locals.audit = {
      entityType: 'PurchaseOrder',
      entityId: purchaseOrder._id,
      entityLabel: purchaseOrder.poNumber,
      summary: `Created purchase order ${purchaseOrder.poNumber}.`,
    };
    res.status(201).json(purchaseOrder);
  })
);

/* -------------------------------------------------------------------------- */
/* Timber                                                                     */
/* -------------------------------------------------------------------------- */

function requireTimber(_req, _res, next) {
  if (!config.features.timber) {
    return next(ApiError.badRequest('The timber section is switched off (FEATURE_TIMBER=false).'));
  }
  next();
}

router.get(
  '/timber',
  requirePermission(ACTIONS.READ, MODULE),
  requireTimber,
  asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.parcel) filter.parcel = req.query.parcel;
    if (req.query.activityType) filter.activityType = req.query.activityType;
    if (req.query.parentActivity) filter.parentActivity = req.query.parentActivity;

    const items = await TimberActivity.find(filter)
      .populate('parcel', 'parcelId name county')
      .populate('contract', 'contractNumber')
      .populate('sale.buyer', 'name')
      .sort({ occurredOn: -1, createdAt: -1 });

    res.json({ items, total: items.length });
  })
);

router.post(
  '/timber',
  requirePermission(ACTIONS.CREATE, MODULE),
  requireTimber,
  asyncHandler(async (req, res) => {
    const activity = await TimberActivity.create({ ...(req.body ?? {}), createdBy: req.user._id });
    res.locals.audit = {
      entityType: 'TimberActivity',
      entityId: activity._id,
      entityLabel: activity.title,
      summary: `Recorded timber ${activity.activityType.replace(/_/g, ' ')}: "${activity.title}".`,
    };
    res.status(201).json(activity);
  })
);

router.patch(
  '/timber/:id',
  requirePermission(ACTIONS.UPDATE, MODULE),
  requireTimber,
  asyncHandler(async (req, res) => {
    const activity = await TimberActivity.findById(req.params.id);
    if (!activity) throw ApiError.notFound('That timber record does not exist.');

    const fields = [
      'title', 'activityType', 'parcel', 'contract', 'purchaseOrder', 'parentActivity', 'occurredOn',
      'status', 'attendees', 'meetingNotes', 'sale', 'inspection', 'loads', 'inventory', 'reforestation', 'notes',
    ];
    Object.assign(activity, pick(req.body ?? {}, fields));
    activity.updatedBy = req.user._id;
    await activity.save();

    res.locals.audit = {
      entityType: 'TimberActivity',
      entityId: activity._id,
      entityLabel: activity.title,
      summary: `Updated timber record "${activity.title}".`,
    };
    res.json(activity);
  })
);

/** Add one load ticket to a sale without rewriting the whole record. */
router.post(
  '/timber/:id/loads',
  requirePermission(ACTIONS.UPDATE, MODULE),
  requireTimber,
  asyncHandler(async (req, res) => {
    const activity = await TimberActivity.findById(req.params.id);
    if (!activity) throw ApiError.notFound('That timber record does not exist.');

    activity.loads.push(req.body ?? {});
    activity.updatedBy = req.user._id;
    await activity.save();

    res.locals.audit = {
      entityType: 'TimberActivity',
      entityId: activity._id,
      entityLabel: activity.title,
      summary: `Recorded load ticket ${req.body?.ticketNumber} on "${activity.title}".`,
    };
    res.status(201).json(activity);
  })
);

/* -------------------------------------------------------------------------- */
/* Documents — the same engine as acquisition                                 */
/* -------------------------------------------------------------------------- */

router.post(
  '/parcels/:parcelId/documents',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const templateId = req.body?.template ?? 'management-work-order-memo';

    const parcel = await Parcel.findById(req.params.parcelId);
    if (!parcel) throw ApiError.notFound('That parcel does not exist.');

    const [tasks, contract, purchaseOrder, timberActivity] = await Promise.all([
      MaintenanceTask.find({ parcel: parcel._id, ...(req.body?.taskIds ? { _id: { $in: req.body.taskIds } } : {}) })
        .populate('vendor', 'name')
        .sort({ scheduledStart: 1 }),
      req.body?.contractId ? Contract.findById(req.body.contractId).populate('vendor', 'name') : null,
      req.body?.purchaseOrderId ? PurchaseOrder.findById(req.body.purchaseOrderId) : null,
      req.body?.timberActivityId ? TimberActivity.findById(req.body.timberActivityId).populate('sale.buyer', 'name') : null,
    ]);

    const inventory = timberActivity
      ? await TimberActivity.findOne({ parcel: parcel._id, activityType: 'inventory' }).sort({ occurredOn: -1 })
      : null;

    const context = {
      parcel: parcel.toObject({ virtuals: true }),
      contract: contract?.toObject({ virtuals: true }) ?? null,
      purchaseOrder: purchaseOrder?.toObject({ virtuals: true }) ?? null,
      vendorName: contract?.vendor?.name ?? tasks[0]?.vendor?.name ?? 'the Contractor',
      managerName: req.user.fullName,
      parcels: [
        {
          parcelId: parcel.parcelId,
          name: parcel.name,
          county: parcel.county,
          areaLabel: `${parcel.area?.value ?? 0} ${parcel.area?.unit ?? 'acres'}`,
        },
      ],
      tasks: tasks.map((task) => ({
        title: task.title,
        taskTypeLabel: task.taskType.replace(/_/g, ' '),
        scheduledLabel: task.scheduledStart ? new Date(task.scheduledStart).toLocaleDateString(config.documents.locale) : 'Unscheduled',
        acres: task.acres ?? '',
        estimatedCostLabel: formatMoney(task.estimatedCost),
        status: task.status,
      })),
      totals: { estimatedCost: tasks.reduce((sum, task) => sum + (task.estimatedCost ?? 0), 0) },
      activity: timberActivity?.toObject({ virtuals: true }) ?? null,
      inventory: inventory?.toObject({ virtuals: true }) ?? null,
    };

    const { document } = await generateDocument({
      templateId,
      context,
      module: MODULE,
      user: req.user,
      req,
      links: { parcel: parcel._id, contract: contract?._id, purchaseOrder: purchaseOrder?._id },
      filenameHint: `${parcel.parcelId}-${templateId}`,
    });

    res.locals.auditSkip = true;
    res.status(201).json(document);
  })
);

router.get(
  '/parcels/:parcelId/overview',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const parcel = await Parcel.findById(req.params.parcelId).populate('program', 'name code');
    if (!parcel) throw ApiError.notFound('That parcel does not exist.');

    const [plans, tasks, timber, contracts, documents] = await Promise.all([
      ManagementPlan.find({ parcel: parcel._id }).sort({ startYear: -1 }),
      MaintenanceTask.find({ parcel: parcel._id })
        .populate('contract', 'contractNumber')
        .populate('purchaseOrder', 'poNumber')
        .sort({ scheduledStart: 1 }),
      config.features.timber ? TimberActivity.find({ parcel: parcel._id }).sort({ occurredOn: -1 }) : [],
      Contract.find({ parcels: parcel._id }).populate('vendor', 'name'),
      GeneratedDocument.find({ parcel: parcel._id }).sort({ generatedAt: -1 }).limit(25),
    ]);

    res.json({ parcel, plans, tasks, timber, contracts, documents });
  })
);

/* -------------------------------------------------------------------------- */
/* Move this along → Land Disposition                                         */
/* -------------------------------------------------------------------------- */

router.post(
  '/parcels/:parcelId/advance',
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const result = await advanceParcelToDisposition({
      parcelId: req.params.parcelId,
      user: req.user,
      req,
      reason: req.body?.reason,
      method: req.body?.method,
    });

    res.locals.auditSkip = true;
    res.status(201).json({
      parcel: result.parcel,
      dispositionCase: result.dispositionCase,
      carried: result.carried,
      message: `${result.parcel.parcelId} moved to Land Disposition as case ${result.dispositionCase.caseNumber}.`,
    });
  })
);

function formatMoney(value) {
  if (value == null) return '';
  return new Intl.NumberFormat(config.documents.locale, {
    style: 'currency',
    currency: config.documents.currency,
  }).format(value);
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

export default router;
