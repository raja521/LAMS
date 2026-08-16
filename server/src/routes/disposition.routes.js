import { Router } from 'express';
import {
  Contract,
  DispositionCase,
  Evaluation,
  GeneratedDocument,
  MaintenanceTask,
  ManagementPlan,
  Parcel,
  DISPOSITION_STATUS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { diffFields } from '../services/activityService.js';
import { ACTIONS, MODULES } from '../config/permissions.js';
import { loadTemplate, TEMPLATE_KINDS } from '../services/templateService.js';
import { createChecklist, listChecklistsFor, updateItem } from '../services/checklistService.js';
import { saveScores } from '../services/scoringService.js';
import { generateDocument } from '../services/documentService.js';
import { nextNumber, SEQUENCES } from '../services/numberingService.js';

const router = Router();
const MODULE = MODULES.DISPOSITION;

router.use(authenticate, auditMutations({ entityType: 'DispositionCase', module: MODULE }));

/* -------------------------------------------------------------------------- */
/* Cases                                                                      */
/* -------------------------------------------------------------------------- */

router.get(
  '/cases',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const { status, method, search, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (method) filter.method = method;
    if (search) {
      filter.$or = [{ caseNumber: new RegExp(search, 'i') }, { title: new RegExp(search, 'i') }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total, statusCounts] = await Promise.all([
      DispositionCase.find(filter)
        .populate('parcel', 'parcelId name county region area geometry')
        .populate('assignedTo', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      DispositionCase.countDocuments(filter),
      DispositionCase.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    res.json({
      items,
      total,
      page: Number(page),
      limit: Number(limit),
      statusCounts: Object.fromEntries(statusCounts.map((row) => [row._id, row.count])),
    });
  })
);

/** Open a case by hand, for a property not arriving from Land Management. */
router.post(
  '/cases',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const parcel = await Parcel.findById(req.body?.parcel);
    if (!parcel) throw ApiError.badRequest('A valid parcel is required to open a disposition case.');

    const dispositionCase = await DispositionCase.create({
      ...(req.body ?? {}),
      caseNumber: await nextNumber(SEQUENCES.DISPOSITION),
      title: req.body?.title ?? `Disposition of ${parcel.name}`,
      originModule: 'manual',
      createdBy: req.user._id,
    });

    res.locals.audit = {
      entityId: dispositionCase._id,
      entityLabel: dispositionCase.caseNumber,
      summary: `Opened disposition case ${dispositionCase.caseNumber}.`,
    };
    res.status(201).json(dispositionCase);
  })
);

const loadCase = asyncHandler(async (req, _res, next) => {
  const dispositionCase = await DispositionCase.findById(req.params.id)
    .populate('parcel')
    .populate('assignedTo', 'firstName lastName email');
  if (!dispositionCase) throw ApiError.notFound('That disposition case does not exist.');
  req.dispositionCase = dispositionCase;
  next();
});

/** The case with everything carried in from Land Management alongside it. */
router.get(
  '/cases/:id',
  requirePermission(ACTIONS.READ, MODULE),
  loadCase,
  asyncHandler(async (req, res) => {
    const { dispositionCase } = req;

    const [evaluation, checklists, documents, plans, tasks, contracts] = await Promise.all([
      Evaluation.findOne({ subject: dispositionCase._id, subjectType: 'DispositionCase' }),
      listChecklistsFor('DispositionCase', dispositionCase._id),
      GeneratedDocument.find({ dispositionCase: dispositionCase._id })
        .sort({ generatedAt: -1 })
        .populate('generatedBy', 'firstName lastName email'),
      ManagementPlan.find({ parcel: dispositionCase.parcel?._id }).sort({ startYear: -1 }),
      MaintenanceTask.find({ parcel: dispositionCase.parcel?._id }).sort({ scheduledStart: -1 }).limit(50),
      Contract.find({ parcels: dispositionCase.parcel?._id }).populate('vendor', 'name'),
    ]);

    res.json({
      dispositionCase,
      evaluation,
      checklists,
      documents,
      managementHistory: { plans, tasks, contracts },
    });
  })
);

const CASE_FIELDS = [
  'title', 'reason', 'method', 'status', 'estimatedValue', 'appraisedValue', 'salePrice',
  'recipient', 'listedOn', 'closedOn', 'assignedTo', 'notes',
];

router.patch(
  '/cases/:id',
  loadCase,
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const { dispositionCase } = req;
    const before = pick(dispositionCase.toObject(), CASE_FIELDS);

    Object.assign(dispositionCase, pick(req.body ?? {}, CASE_FIELDS));
    dispositionCase.updatedBy = req.user._id;
    await dispositionCase.save();

    // Completing a case takes the parcel out of the active portfolio.
    if (dispositionCase.status === DISPOSITION_STATUS.COMPLETED && dispositionCase.parcel) {
      await Parcel.updateOne(
        { _id: dispositionCase.parcel._id ?? dispositionCase.parcel },
        { $set: { status: 'disposition', module: 'disposition', disposedOn: dispositionCase.closedOn ?? new Date() } }
      );
    }

    res.locals.audit = {
      entityId: dispositionCase._id,
      entityLabel: dispositionCase.caseNumber,
      changes: diffFields(before, pick(dispositionCase.toObject(), CASE_FIELDS), CASE_FIELDS),
      summary: `Updated disposition case ${dispositionCase.caseNumber}.`,
    };
    res.json(dispositionCase);
  })
);

/* -------------------------------------------------------------------------- */
/* Evaluation — the same scoring engine acquisition uses                      */
/* -------------------------------------------------------------------------- */

router.put(
  '/cases/:id/scores',
  loadCase,
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const evaluation = await saveScores({
      subject: req.dispositionCase._id,
      subjectType: 'DispositionCase',
      module: 'disposition',
      templateId: req.body?.template ?? 'disposition-evaluation',
      scores: req.body?.scores ?? [],
      recommendation: req.body?.recommendation,
      recommendationNotes: req.body?.recommendationNotes,
      status: req.body?.status,
      user: req.user,
    });

    if (req.dispositionCase.status === DISPOSITION_STATUS.IDENTIFIED || req.dispositionCase.status === DISPOSITION_STATUS.UNDER_EVALUATION) {
      req.dispositionCase.status = DISPOSITION_STATUS.EVALUATED;
      await req.dispositionCase.save();
    }

    res.locals.audit = {
      entityType: 'Evaluation',
      entityId: evaluation._id,
      entityLabel: req.dispositionCase.caseNumber,
      summary: `Evaluated ${req.dispositionCase.caseNumber}: ${evaluation.normalizedScore}%.`,
    };
    res.json(evaluation);
  })
);

/** Board approval, recorded on the evaluation so the memo can quote it. */
router.post(
  '/cases/:id/approve',
  loadCase,
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const approved = req.body?.approved !== false;

    const evaluation = await Evaluation.findOneAndUpdate(
      { subject: req.dispositionCase._id, subjectType: 'DispositionCase' },
      {
        $set: {
          status: approved ? 'approved' : 'rejected',
          approvedBy: req.user._id,
          approvedAt: new Date(),
          decisionNotes: req.body?.notes,
        },
      },
      { new: true }
    );
    if (!evaluation) throw ApiError.badRequest('Score the case before recording an approval decision.');

    req.dispositionCase.status = approved ? DISPOSITION_STATUS.APPROVED : DISPOSITION_STATUS.DECLINED;
    req.dispositionCase.updatedBy = req.user._id;
    await req.dispositionCase.save();

    res.locals.audit = {
      entityId: req.dispositionCase._id,
      entityLabel: req.dispositionCase.caseNumber,
      summary: `${approved ? 'Approved' : 'Declined'} disposition case ${req.dispositionCase.caseNumber}.`,
    };
    res.json({ dispositionCase: req.dispositionCase, evaluation });
  })
);

/* -------------------------------------------------------------------------- */
/* Checklist — the same engine acquisition uses                               */
/* -------------------------------------------------------------------------- */

router.post(
  '/cases/:id/checklists',
  loadCase,
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const checklist = await createChecklist({
      subjectType: 'DispositionCase',
      subject: req.dispositionCase._id,
      module: MODULE,
      templateId: req.body?.template ?? 'disposition-closing',
      user: req.user,
    });

    res.locals.audit = {
      entityType: 'Checklist',
      entityId: checklist._id,
      entityLabel: req.dispositionCase.caseNumber,
      summary: `Started checklist "${checklist.name}" for ${req.dispositionCase.caseNumber}.`,
    };
    res.status(201).json(await listChecklistsFor('DispositionCase', req.dispositionCase._id));
  })
);

router.patch(
  '/checklist-items/:itemId',
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const item = await updateItem(req.params.itemId, req.body ?? {}, req.user);
    res.locals.audit = {
      entityType: 'ChecklistItem',
      entityId: item._id,
      entityLabel: item.label,
      summary: `Marked "${item.label}" as ${item.status.replace(/_/g, ' ')}.`,
    };
    res.json(item);
  })
);

/* -------------------------------------------------------------------------- */
/* Documents — the same engine acquisition uses                               */
/* -------------------------------------------------------------------------- */

router.post(
  '/cases/:id/documents',
  loadCase,
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const templateId = req.body?.template ?? 'disposition-recommendation-memo';
    const { dispositionCase } = req;

    const [evaluation, checklists, plans, tasks] = await Promise.all([
      Evaluation.findOne({ subject: dispositionCase._id, subjectType: 'DispositionCase' }),
      listChecklistsFor('DispositionCase', dispositionCase._id),
      ManagementPlan.find({ parcel: dispositionCase.parcel?._id }).sort({ startYear: -1 }),
      MaintenanceTask.find({ parcel: dispositionCase.parcel?._id }).sort({ scheduledStart: -1 }).limit(25),
    ]);

    const scoringTemplate = evaluation
      ? await loadTemplate(TEMPLATE_KINDS.SCORING, evaluation.template).catch(() => null)
      : null;
    const firstChecklist = checklists?.[0];

    const context = {
      dispositionCase: dispositionCase.toObject({ virtuals: true }),
      parcel: dispositionCase.parcel?.toObject?.({ virtuals: true }) ?? dispositionCase.parcel,
      evaluation: evaluation?.toObject({ virtuals: true }) ?? null,
      recommendationLabel:
        scoringTemplate?.recommendations?.find((r) => r.value === evaluation?.recommendation)?.label ??
        'No recommendation has been recorded.',
      history: {
        plans: plans.map((plan) => ({
          programAreaLabel: plan.programArea.replace(/_/g, ' '),
          name: plan.name,
          yearRange: `${plan.startYear}–${plan.endYear}`,
          status: plan.status,
        })),
        tasks: tasks.map((task) => ({
          title: task.title,
          taskTypeLabel: task.taskType.replace(/_/g, ' '),
          scheduledLabel: task.scheduledStart ? new Date(task.scheduledStart).toLocaleDateString() : 'Unscheduled',
          status: task.status,
        })),
      },
      checklist: firstChecklist
        ? {
            name: firstChecklist.checklist.name,
            progress: firstChecklist.progress,
            items: firstChecklist.items.map((item) => ({
              label: item.label,
              statusLabel: item.status.replace(/_/g, ' '),
            })),
          }
        : null,
    };

    const { document } = await generateDocument({
      templateId,
      context,
      module: MODULE,
      user: req.user,
      req,
      links: { dispositionCase: dispositionCase._id, parcel: dispositionCase.parcel?._id },
      filenameHint: `${dispositionCase.caseNumber}-${templateId}`,
    });

    res.locals.auditSkip = true;
    res.status(201).json(document);
  })
);

/** Parcels in active management, offered as candidates for a new case. */
router.get(
  '/candidates',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const openCases = await DispositionCase.find({
      status: { $nin: [DISPOSITION_STATUS.COMPLETED, DISPOSITION_STATUS.DECLINED] },
    }).select('parcel');

    const items = await Parcel.find({
      status: 'management',
      _id: { $nin: openCases.map((c) => c.parcel) },
    })
      .select('parcelId name county region area geometry acquiredOn')
      .sort({ name: 1 });

    res.json({ items, total: items.length });
  })
);

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

export default router;
