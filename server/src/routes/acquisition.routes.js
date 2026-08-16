import { Router } from 'express';
import config from '../config/env.js';
import {
  Checklist,
  Evaluation,
  LandApplication,
  Prospectus,
  APPLICATION_STATUS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { diffFields } from '../services/activityService.js';
import { ACTIONS, MODULES } from '../config/permissions.js';
import { createApplication, intakeStatus, simulateIncoming, verifyWebhookSignature } from '../services/intakeService.js';
import { loadTemplate, TEMPLATE_KINDS } from '../services/templateService.js';
import { createChecklist, listChecklistsFor, updateItem } from '../services/checklistService.js';
import { currentCycle, getRankedList, recalculateRanks, saveScores } from '../services/scoringService.js';
import { generateDocument } from '../services/documentService.js';
import { advanceApplicationToManagement } from '../services/transitionService.js';

const router = Router();
const MODULE = MODULES.ACQUISITION;

/* -------------------------------------------------------------------------- */
/* Intake — the queue of new applications                                     */
/* -------------------------------------------------------------------------- */

/**
 * Posted by the online form system. Unauthenticated by necessity — it is
 * verified by HMAC signature instead, using INTAKE_WEBHOOK_SECRET.
 */
router.post(
  '/intake/webhook',
  asyncHandler(async (req, res) => {
    if (!verifyWebhookSignature(req.rawBody, req.get('x-lams-intake-signature'))) {
      throw ApiError.unauthorized('Invalid intake signature.', { code: 'BAD_SIGNATURE' });
    }
    const application = await createApplication(req.body ?? {}, { source: 'webhook', req });
    res.status(201).json({ fileNumber: application.fileNumber, id: application._id });
  })
);

/* Everything below requires a signed-in user. */
router.use(authenticate, auditMutations({ entityType: 'LandApplication', module: MODULE }));

router.get(
  '/intake/status',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (_req, res) => res.json(intakeStatus()))
);

/** Stand-in for the online form system until the real connection is made. */
router.post(
  '/intake/simulate',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    if (config.intake.source !== 'simulated') {
      throw ApiError.badRequest(
        `Simulated intake is off. INTAKE_SOURCE is "${config.intake.source}"; set it to "simulated" to use this.`
      );
    }
    const created = await simulateIncoming({ count: Number(req.body?.count ?? 1), user: req.user, req });
    res.locals.auditSkip = true; // createApplication already logged each one
    res.status(201).json({ created: created.length, applications: created });
  })
);

/* -------------------------------------------------------------------------- */
/* Applications                                                               */
/* -------------------------------------------------------------------------- */

router.get(
  '/applications',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const { status, county, search, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (county) filter['property.county'] = county;
    if (search) {
      filter.$or = [
        { fileNumber: new RegExp(search, 'i') },
        { 'applicant.name': new RegExp(search, 'i') },
        { 'property.description': new RegExp(search, 'i') },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total, statusCounts] = await Promise.all([
      LandApplication.find(filter)
        .populate('assignedTo', 'firstName lastName email')
        .populate('program', 'name code')
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      LandApplication.countDocuments(filter),
      LandApplication.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
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

router.post(
  '/applications',
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    // The file number is assigned inside createApplication — never supplied.
    const application = await createApplication(req.body ?? {}, { source: 'manual', user: req.user, req });
    res.locals.auditSkip = true;
    res.status(201).json(application);
  })
);

const loadApplication = asyncHandler(async (req, _res, next) => {
  const application = await LandApplication.findById(req.params.id)
    .populate('assignedTo', 'firstName lastName email')
    .populate('program', 'name code');
  if (!application) throw ApiError.notFound('That application does not exist.');
  req.application = application;
  next();
});

router.get(
  '/applications/:id',
  requirePermission(ACTIONS.READ, MODULE),
  loadApplication,
  asyncHandler(async (req, res) => {
    const [prospectus, evaluation, checklists, documents] = await Promise.all([
      Prospectus.findOne({ landApplication: req.application._id }),
      Evaluation.findOne({ subject: req.application._id, subjectType: 'LandApplication' }),
      listChecklistsFor('LandApplication', req.application._id),
      (await import('../models/index.js')).GeneratedDocument.find({ landApplication: req.application._id })
        .sort({ generatedAt: -1 })
        .populate('generatedBy', 'firstName lastName email'),
    ]);

    res.json({ application: req.application, prospectus, evaluation, checklists, documents });
  })
);

const APPLICATION_FIELDS = ['applicant', 'property', 'status', 'program', 'assignedTo', 'notes', 'declineReason'];

router.patch(
  '/applications/:id',
  loadApplication,
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const { application } = req;
    const before = pick(application.toObject(), APPLICATION_FIELDS);

    // fileNumber is deliberately not editable — it is assigned by the system.
    Object.assign(application, pick(req.body ?? {}, APPLICATION_FIELDS));
    application.updatedBy = req.user._id;
    await application.save();

    res.locals.audit = {
      entityId: application._id,
      entityLabel: application.fileNumber,
      changes: diffFields(before, pick(application.toObject(), APPLICATION_FIELDS), APPLICATION_FIELDS),
      summary: `Updated application ${application.fileNumber}.`,
    };
    res.json(application);
  })
);

/* -------------------------------------------------------------------------- */
/* Prospectus — the short planning document                                   */
/* -------------------------------------------------------------------------- */

router.get(
  '/prospectus-template/:templateId',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    res.json(await loadTemplate(TEMPLATE_KINDS.PROSPECTUS, req.params.templateId));
  })
);

/** Start a prospectus from the template — prompted sections, not a blank page. */
router.post(
  '/applications/:id/prospectus',
  loadApplication,
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const templateId = req.body?.template ?? 'standard-prospectus';
    const template = await loadTemplate(TEMPLATE_KINDS.PROSPECTUS, templateId);

    const existing = await Prospectus.findOne({ landApplication: req.application._id });
    if (existing) throw ApiError.conflict('This application already has a prospectus.');

    const costSection = (template.sections ?? []).find((section) => section.costEstimate);

    const prospectus = await Prospectus.create({
      landApplication: req.application._id,
      template: template.id,
      templateVersion: template.version ?? '1',
      title: `Prospectus — ${req.application.property.description ?? req.application.fileNumber}`,
      // Cost lines start from the template's default list rather than empty.
      costEstimate: {
        lines: (costSection?.defaultLines ?? []).map((line) => ({ ...line })),
        contingencyPercent: costSection?.defaultContingencyPercent ?? 10,
      },
      programPlan: { horizonYears: 5 },
      preparedBy: req.user._id,
      createdBy: req.user._id,
    });

    if (req.application.status === APPLICATION_STATUS.NEW) {
      req.application.status = APPLICATION_STATUS.UNDER_REVIEW;
      await req.application.save();
    }

    res.locals.audit = {
      entityType: 'Prospectus',
      entityId: prospectus._id,
      entityLabel: req.application.fileNumber,
      summary: `Started a prospectus for ${req.application.fileNumber}.`,
    };
    res.status(201).json({ prospectus, template });
  })
);

router.patch(
  '/prospectus/:id',
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const prospectus = await Prospectus.findById(req.params.id);
    if (!prospectus) throw ApiError.notFound('That prospectus does not exist.');

    const fields = ['title', 'siteInspection', 'programPlan', 'costEstimate', 'responses', 'status'];
    const before = pick(prospectus.toObject(), fields);
    Object.assign(prospectus, pick(req.body ?? {}, fields));
    prospectus.updatedBy = req.user._id;
    await prospectus.save();

    if (prospectus.status === 'final') {
      await LandApplication.updateOne(
        { _id: prospectus.landApplication, status: APPLICATION_STATUS.UNDER_REVIEW },
        { $set: { status: APPLICATION_STATUS.PROSPECTUS_DRAFTED } }
      );
    }

    res.locals.audit = {
      entityType: 'Prospectus',
      entityId: prospectus._id,
      entityLabel: prospectus.title,
      changes: diffFields(before, pick(prospectus.toObject(), fields), fields),
      summary: `Updated prospectus ${prospectus.title}.`,
    };
    res.json(prospectus);
  })
);

/* -------------------------------------------------------------------------- */
/* Scoring and ranking                                                        */
/* -------------------------------------------------------------------------- */

router.get(
  '/scoring-template/:templateId',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    res.json(await loadTemplate(TEMPLATE_KINDS.SCORING, req.params.templateId));
  })
);

router.put(
  '/applications/:id/scores',
  loadApplication,
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const evaluation = await saveScores({
      subject: req.application._id,
      subjectType: 'LandApplication',
      module: 'acquisition',
      templateId: req.body?.template ?? 'acquisition-ranking',
      scores: req.body?.scores ?? [],
      recommendation: req.body?.recommendation,
      recommendationNotes: req.body?.recommendationNotes,
      status: req.body?.status,
      user: req.user,
    });

    // Ranks are recomputed across the whole cycle so the list stays consistent.
    await recalculateRanks({ module: 'acquisition', rankCycle: evaluation.rankCycle });
    const refreshed = await Evaluation.findById(evaluation._id);

    // Scoring moves the application forward from any of the pre-decision states.
    const PRE_DECISION = [
      APPLICATION_STATUS.NEW,
      APPLICATION_STATUS.UNDER_REVIEW,
      APPLICATION_STATUS.PROSPECTUS_DRAFTED,
    ];
    if (PRE_DECISION.includes(req.application.status)) {
      req.application.status = APPLICATION_STATUS.SCORED;
      await req.application.save();
    }

    res.locals.audit = {
      entityType: 'Evaluation',
      entityId: refreshed._id,
      entityLabel: req.application.fileNumber,
      summary: `Scored ${req.application.fileNumber}: ${refreshed.normalizedScore}% (rank ${refreshed.rank}).`,
    };
    res.json(refreshed);
  })
);

router.get(
  '/ranking',
  requirePermission(ACTIONS.READ, MODULE),
  asyncHandler(async (req, res) => {
    const rankCycle = req.query.cycle ?? currentCycle();
    const evaluations = await getRankedList({ module: 'acquisition', rankCycle });

    const applications = await LandApplication.find({
      _id: { $in: evaluations.map((e) => e.subject) },
    }).select('fileNumber property applicant status');
    const byId = new Map(applications.map((a) => [String(a._id), a]));

    res.json({
      cycle: rankCycle,
      items: evaluations.map((evaluation) => ({
        evaluation,
        application: byId.get(String(evaluation.subject)) ?? null,
      })),
    });
  })
);

router.post(
  '/ranking/recalculate',
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const rankCycle = req.body?.cycle ?? currentCycle();
    const ranked = await recalculateRanks({ module: 'acquisition', rankCycle });
    res.locals.audit = { entityType: 'Evaluation', summary: `Recalculated acquisition ranking for ${rankCycle}.` };
    res.json({ cycle: rankCycle, ranked });
  })
);

/* -------------------------------------------------------------------------- */
/* Documents                                                                  */
/* -------------------------------------------------------------------------- */

/** One click: build the committee memo as a real, editable Word file. */
router.post(
  '/applications/:id/documents',
  loadApplication,
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const templateId = req.body?.template ?? 'acquisition-ranking-memo';
    const { application } = req;

    const [prospectus, evaluation, checklists] = await Promise.all([
      Prospectus.findOne({ landApplication: application._id }),
      Evaluation.findOne({ subject: application._id, subjectType: 'LandApplication' }),
      listChecklistsFor('LandApplication', application._id),
    ]);

    const context = await buildAcquisitionContext({ application, prospectus, evaluation, checklists, body: req.body });

    const { document } = await generateDocument({
      templateId,
      context,
      module: MODULE,
      user: req.user,
      req,
      links: { landApplication: application._id, parcel: application.parcel },
      filenameHint: `${application.fileNumber}-${templateId}`,
    });

    res.locals.auditSkip = true; // generateDocument logs it
    res.status(201).json(document);
  })
);

/* -------------------------------------------------------------------------- */
/* Checklist                                                                  */
/* -------------------------------------------------------------------------- */

router.post(
  '/applications/:id/checklists',
  loadApplication,
  requirePermission(ACTIONS.CREATE, MODULE),
  asyncHandler(async (req, res) => {
    const checklist = await createChecklist({
      subjectType: 'LandApplication',
      subject: req.application._id,
      module: MODULE,
      templateId: req.body?.template ?? 'acquisition-closing',
      user: req.user,
    });

    res.locals.audit = {
      entityType: 'Checklist',
      entityId: checklist._id,
      entityLabel: req.application.fileNumber,
      summary: `Started checklist "${checklist.name}" for ${req.application.fileNumber}.`,
    };
    res.status(201).json(await listChecklistsFor('LandApplication', req.application._id));
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
/* Move this along → Land Management                                          */
/* -------------------------------------------------------------------------- */

router.post(
  '/applications/:id/advance',
  loadApplication,
  requirePermission(ACTIONS.UPDATE, MODULE),
  asyncHandler(async (req, res) => {
    const result = await advanceApplicationToManagement({
      applicationId: req.application._id,
      user: req.user,
      req,
      overrides: req.body ?? {},
    });

    res.locals.auditSkip = true; // the transition logs its own entry
    res.status(201).json({
      application: result.application,
      parcel: result.parcel,
      managementPlan: result.plan,
      message: `${result.application.fileNumber} is now parcel ${result.parcel.parcelId} in Land Management.`,
    });
  })
);

/* -------------------------------------------------------------------------- */

/** Everything the acquisition templates can reference, assembled in one place. */
async function buildAcquisitionContext({ application, prospectus, evaluation, checklists, body = {} }) {
  const scoringTemplate = evaluation
    ? await loadTemplate(TEMPLATE_KINDS.SCORING, evaluation.template).catch(() => null)
    : null;

  const rankingContext = { entries: [], total: 0 };
  if (evaluation) {
    const peers = await getRankedList({ module: 'acquisition', rankCycle: evaluation.rankCycle });
    const applications = await LandApplication.find({ _id: { $in: peers.map((p) => p.subject) } }).select(
      'fileNumber property'
    );
    const byId = new Map(applications.map((a) => [String(a._id), a]));

    rankingContext.total = peers.length;
    rankingContext.entries = peers.map((peer) => {
      const peerApplication = byId.get(String(peer.subject));
      return {
        rank: peer.rank ?? '—',
        fileNumber: peerApplication?.fileNumber ?? '—',
        label: peerApplication?.property?.description ?? '—',
        normalizedScoreLabel: `${peer.normalizedScore}%`,
      };
    });
  }

  const recommendationLabel =
    scoringTemplate?.recommendations?.find((r) => r.value === evaluation?.recommendation)?.label ??
    'No recommendation has been recorded.';

  const firstChecklist = checklists?.[0];

  return {
    application: application.toObject({ virtuals: true }),
    prospectus: prospectus ? prospectus.toObject({ virtuals: true }) : null,
    evaluation: evaluation ? evaluation.toObject({ virtuals: true }) : null,
    scoringTemplate,
    rankingContext,
    recommendationLabel,
    checklist: firstChecklist
      ? {
          name: firstChecklist.checklist.name,
          progress: firstChecklist.progress,
          items: firstChecklist.items.map((item) => ({
            label: item.label,
            statusLabel: item.status.replace(/_/g, ' '),
            dueOn: item.dueOn,
          })),
        }
      : null,
    offer: {
      amount: body.offerAmount ?? application.property?.askingPrice,
      expiresOn: body.offerExpiresOn ?? null,
    },
  };
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

export default router;
