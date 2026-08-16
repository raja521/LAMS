import { Router } from 'express';
import { Parcel } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { diffFields } from '../services/activityService.js';
import { ACTIONS, MODULES } from '../config/permissions.js';

const router = Router();

router.use(authenticate, auditMutations({ entityType: 'Parcel' }));

const EDITABLE = [
  'parcelId',
  'name',
  'region',
  'county',
  'area',
  'program',
  'programName',
  'status',
  'geometry',
  'ownerOrganization',
  'assignedTo',
  'notes',
];

/**
 * A parcel's module follows its status, so the permission check is derived from
 * the record (or the request body on create) rather than from the route path.
 */
const moduleFromBody = (req) => req.body?.status ?? MODULES.ACQUISITION;
const moduleFromRecord = (req) => req.parcel?.module ?? req.parcel?.status;

const loadParcel = asyncHandler(async (req, _res, next) => {
  const parcel = await Parcel.findById(req.params.id);
  if (!parcel) throw ApiError.notFound('That parcel does not exist.');
  req.parcel = parcel;
  next();
});

/* Everyone signed in may read; only editors of the right module may change. */

router.get(
  '/',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const { status, region, county, search, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (region) filter.region = region;
    if (county) filter.county = county;
    if (search) filter.$or = [{ name: new RegExp(search, 'i') }, { parcelId: new RegExp(search, 'i') }];

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      Parcel.find(filter)
        .populate('assignedTo', 'firstName lastName email')
        .populate('program', 'name code')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Parcel.countDocuments(filter),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  })
);

router.get(
  '/:id',
  requirePermission(ACTIONS.READ),
  loadParcel,
  asyncHandler(async (req, res) => {
    res.json(req.parcel);
  })
);

router.post(
  '/',
  requirePermission(ACTIONS.CREATE, moduleFromBody),
  asyncHandler(async (req, res) => {
    const parcel = new Parcel({ ...pick(req.body ?? {}, EDITABLE), createdBy: req.user._id });
    await parcel.save();

    res.locals.audit = {
      entityId: parcel._id,
      entityLabel: parcel.parcelId,
      module: parcel.module,
      summary: `Created parcel ${parcel.parcelId}.`,
    };
    res.status(201).json(parcel);
  })
);

router.patch(
  '/:id',
  loadParcel,
  requirePermission(ACTIONS.UPDATE, moduleFromRecord),
  asyncHandler(async (req, res) => {
    const { parcel } = req;
    const before = pick(parcel.toObject(), EDITABLE);

    Object.assign(parcel, pick(req.body ?? {}, EDITABLE));
    parcel.updatedBy = req.user._id;
    await parcel.save();

    res.locals.audit = {
      entityId: parcel._id,
      entityLabel: parcel.parcelId,
      module: parcel.module,
      changes: diffFields(before, pick(parcel.toObject(), EDITABLE), EDITABLE),
      summary: `Updated parcel ${parcel.parcelId}.`,
    };
    res.json(parcel);
  })
);

router.delete(
  '/:id',
  loadParcel,
  requirePermission(ACTIONS.DELETE, moduleFromRecord),
  asyncHandler(async (req, res) => {
    const { parcel } = req;
    await parcel.deleteOne();

    res.locals.audit = {
      entityId: parcel._id,
      entityLabel: parcel.parcelId,
      module: parcel.module,
      summary: `Deleted parcel ${parcel.parcelId}.`,
    };
    res.status(204).end();
  })
);

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

export default router;
