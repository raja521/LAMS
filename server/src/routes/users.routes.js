import { Router } from 'express';
import config from '../config/env.js';
import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { auditMutations } from '../middleware/audit.js';
import { diffFields } from '../services/activityService.js';
import { ASSIGNABLE_MODULES, MODULES, ROLES, ROLE_LABELS } from '../config/permissions.js';

const router = Router();

/* Managing people is an Administrator-only area, top to bottom. */
router.use(authenticate, requireAdmin, auditMutations({ entityType: 'User', module: MODULES.ADMIN }));

const EDITABLE = ['firstName', 'lastName', 'email', 'role', 'modules', 'organization', 'isActive'];

router.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    res.json({
      roles: Object.values(ROLES).map((value) => ({ value, label: ROLE_LABELS[value] })),
      assignableModules: ASSIGNABLE_MODULES,
    });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { role, search, page = 1, limit = 25 } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { firstName: new RegExp(search, 'i') },
        { lastName: new RegExp(search, 'i') },
        { email: new RegExp(search, 'i') },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      User.find(filter).populate('organization', 'name code').sort({ lastName: 1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { password, ...fields } = req.body ?? {};

    // Every account signs in with a password, so one has to be set here —
    // otherwise the account would be created unable to sign in at all.
    if (!password) {
      throw ApiError.badRequest('Set a password for the new user.');
    }
    if (String(password).length < config.auth.minPasswordLength) {
      throw ApiError.badRequest(
        `Passwords must be at least ${config.auth.minPasswordLength} characters long.`
      );
    }

    const user = new User(pick(fields, EDITABLE));
    await user.setPassword(password);
    validateModules(user);
    await user.save();

    res.locals.audit = { entityId: user._id, entityLabel: user.email, summary: `Created user ${user.email}.` };
    res.status(201).json(user);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id).populate('organization', 'name code');
    if (!user) throw ApiError.notFound('That user does not exist.');
    res.json(user);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('That user does not exist.');

    const before = pick(user.toObject(), EDITABLE);
    Object.assign(user, pick(req.body ?? {}, EDITABLE));

    if (req.body?.password) {
      if (String(req.body.password).length < config.auth.minPasswordLength) {
        throw ApiError.badRequest(
          `Passwords must be at least ${config.auth.minPasswordLength} characters long.`
        );
      }
      await user.setPassword(req.body.password);
    }

    // An administrator cannot strip their own admin rights and lock the system out.
    if (String(user._id) === String(req.user._id) && user.role !== ROLES.ADMIN) {
      throw ApiError.badRequest('You cannot remove your own administrator role.');
    }

    validateModules(user);
    await user.save();

    res.locals.audit = {
      entityId: user._id,
      entityLabel: user.email,
      changes: diffFields(before, pick(user.toObject(), EDITABLE), EDITABLE),
      summary: `Updated user ${user.email}.`,
    };
    res.json(user);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.user._id)) {
      throw ApiError.badRequest('You cannot deactivate your own account.');
    }
    const user = await User.findById(req.params.id);
    if (!user) throw ApiError.notFound('That user does not exist.');

    // Deactivate rather than delete: the activity log must keep pointing somewhere.
    user.isActive = false;
    await user.save();

    res.locals.audit = { entityId: user._id, entityLabel: user.email, summary: `Deactivated user ${user.email}.` };
    res.status(204).end();
  })
);

function validateModules(user) {
  if (user.role === ROLES.MODULE_EDITOR && (!user.modules || user.modules.length === 0)) {
    throw ApiError.badRequest(
      `A Module Editor needs at least one assigned module (${ASSIGNABLE_MODULES.join(', ')}).`
    );
  }
  if (user.role !== ROLES.MODULE_EDITOR) user.modules = [];
  if (!user.role) user.role = config.auth.defaultRole;
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source?.[key] !== undefined) out[key] = source[key];
  return out;
}

export default router;
