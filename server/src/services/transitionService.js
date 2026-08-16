/**
 * "Move this along" — carrying a property forward between modules without
 * anyone retyping anything.
 *
 *   Acquisition  →  Management   a completed purchase becomes a managed parcel
 *   Management   →  Disposition  a managed parcel becomes a disposition case
 *
 * Both directions copy the facts across, link the records to each other, and
 * leave an entry in the activity log saying what moved and where it went.
 */
import {
  Contract,
  DispositionCase,
  LandApplication,
  MaintenanceTask,
  ManagementPlan,
  Parcel,
  Prospectus,
  APPLICATION_STATUS,
  DISPOSITION_STATUS,
} from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import { nextNumber, SEQUENCES } from './numberingService.js';
import { recordActivity } from './activityService.js';
import { getChecklistWithItems, listChecklistsFor } from './checklistService.js';

/* -------------------------------------------------------------------------- */
/* Acquisition → Management                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Turn a completed acquisition into a parcel under active management.
 *
 * Refuses to run unless the application has been approved and every required
 * item on its closing checklist is done — the button is a shortcut, not a way
 * around the paperwork.
 */
export async function advanceApplicationToManagement({ applicationId, user, req, overrides = {} }) {
  const application = await LandApplication.findById(applicationId).populate('program', 'name code');
  if (!application) throw ApiError.notFound('That application does not exist.');

  if (application.parcel) {
    throw ApiError.conflict('This application has already been carried forward into Land Management.');
  }
  if (![APPLICATION_STATUS.APPROVED, APPLICATION_STATUS.CLOSING].includes(application.status)) {
    throw ApiError.badRequest(
      `Only an approved application can be moved into Land Management — this one is "${application.status}".`
    );
  }

  const blockers = await outstandingChecklistItems('LandApplication', application._id);
  if (blockers.length) {
    throw ApiError.badRequest(
      `${blockers.length} required item(s) are still outstanding: ${blockers.map((i) => i.label).join(', ')}.`,
      { details: { outstanding: blockers.map((i) => ({ id: i._id, label: i.label, status: i.status })) } }
    );
  }

  const prospectus = await Prospectus.findOne({ landApplication: application._id });

  // Everything below is copied from the application — nothing is retyped.
  const parcel = await Parcel.create({
    parcelId: overrides.parcelId ?? (await nextNumber(SEQUENCES.APPLICATION)).replace(/^[A-Z]+/, 'P'),
    name: overrides.name ?? application.property.description ?? `Parcel from ${application.fileNumber}`,
    region: application.property.region ?? overrides.region ?? 'Unassigned',
    county: application.property.county,
    area: { value: application.property.acres ?? 0, unit: 'acres' },
    program: application.program?._id ?? prospectus?.programPlan?.program,
    programName: application.program?.name,
    status: 'management',
    module: 'management',
    geometry: {
      source: application.property.geometry?.source ?? 'none',
      ref: application.property.geometry?.ref,
      featureId: application.property.geometry?.featureId,
      srid: application.property.geometry?.srid,
    },
    assignedTo: application.assignedTo,
    acquiredOn: new Date(),
    notes: `Acquired through application ${application.fileNumber}.`,
    createdBy: user?._id,
  });

  application.parcel = parcel._id;
  application.status = APPLICATION_STATUS.COMPLETED;
  application.advancedToManagementAt = new Date();
  application.updatedBy = user?._id;
  await application.save();

  if (prospectus) {
    prospectus.parcel = parcel._id;
    await prospectus.save();
  }

  // The management plan starts from the prospectus's program plan, so the
  // thinking done during acquisition is not thrown away.
  let plan = null;
  if (prospectus?.programPlan?.intendedUse || prospectus?.programPlan?.managementApproach) {
    const startYear = new Date().getFullYear();
    const horizon = prospectus.programPlan.horizonYears || 5;
    plan = await ManagementPlan.create({
      parcel: parcel._id,
      program: prospectus.programPlan.program,
      programArea: overrides.programArea ?? 'other',
      name: `Initial plan — ${parcel.name}`,
      description: prospectus.programPlan.managementApproach ?? prospectus.programPlan.intendedUse,
      startYear,
      endYear: startYear + horizon - 1,
      years: Array.from({ length: horizon }, (_, index) => ({
        year: startYear + index,
        planned: index === 0,
        activity: index === 0 ? 'Initial site assessment' : '',
        estimatedCost: 0,
        status: 'planned',
      })),
      status: 'draft',
      responsible: application.assignedTo,
      createdBy: user?._id,
    });
  }

  await recordActivity({
    req,
    actor: user,
    action: 'update',
    entityType: 'LandApplication',
    entityId: application._id,
    entityLabel: application.fileNumber,
    module: 'acquisition',
    summary: `Moved ${application.fileNumber} into Land Management as parcel ${parcel.parcelId}.`,
  });

  return { application, parcel, plan };
}

/* -------------------------------------------------------------------------- */
/* Management → Disposition                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Open a disposition case for a managed parcel, pulling its management history
 * in with it so the evaluation starts from what is already known.
 */
export async function advanceParcelToDisposition({ parcelId, user, req, reason, method = 'undetermined' }) {
  const parcel = await Parcel.findById(parcelId);
  if (!parcel) throw ApiError.notFound('That parcel does not exist.');

  const open = await DispositionCase.findOne({
    parcel: parcel._id,
    status: { $nin: [DISPOSITION_STATUS.COMPLETED, DISPOSITION_STATUS.DECLINED] },
  });
  if (open) {
    throw ApiError.conflict(`Disposition case ${open.caseNumber} is already open for this parcel.`);
  }

  const [plans, tasks, contracts] = await Promise.all([
    ManagementPlan.find({ parcel: parcel._id }).select('_id'),
    MaintenanceTask.find({ parcel: parcel._id }).select('_id'),
    Contract.find({ parcels: parcel._id }).select('_id'),
  ]);

  const dispositionCase = await DispositionCase.create({
    caseNumber: await nextNumber(SEQUENCES.DISPOSITION),
    parcel: parcel._id,
    title: `Disposition of ${parcel.name}`,
    reason,
    method,
    status: DISPOSITION_STATUS.IDENTIFIED,
    originModule: 'management',
    advancedFromManagementAt: new Date(),
    // Referenced by id, so the history stays a single source of truth.
    carriedForward: {
      managementPlans: plans.map((p) => p._id),
      maintenanceTasks: tasks.map((t) => t._id),
      contracts: contracts.map((c) => c._id),
    },
    assignedTo: parcel.assignedTo,
    createdBy: user?._id,
  });

  parcel.status = 'disposition';
  parcel.module = 'disposition';
  parcel.updatedBy = user?._id;
  await parcel.save();

  await recordActivity({
    req,
    actor: user,
    action: 'update',
    entityType: 'Parcel',
    entityId: parcel._id,
    entityLabel: parcel.parcelId,
    module: 'management',
    summary: `Moved ${parcel.parcelId} into Land Disposition as case ${dispositionCase.caseNumber}.`,
  });

  return { parcel, dispositionCase, carried: { plans: plans.length, tasks: tasks.length, contracts: contracts.length } };
}

/* -------------------------------------------------------------------------- */

/** Required checklist items that are not yet complete, across every checklist. */
async function outstandingChecklistItems(subjectType, subject) {
  const checklists = await listChecklistsFor(subjectType, subject);
  return checklists.flatMap(({ items }) =>
    items.filter((item) => item.required && !['complete', 'not_applicable'].includes(item.status))
  );
}

export { outstandingChecklistItems, getChecklistWithItems };
