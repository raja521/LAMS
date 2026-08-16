import { Router } from 'express';
import { ActivityLog } from '../models/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

/* The full audit trail is an administrator view. */
router.use(authenticate, requireAdmin);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { actor, action, entityType, from, to, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (actor) filter.actor = actor;
    if (action) filter.action = action;
    if (entityType) filter.entityType = entityType;
    if (from || to) {
      filter.at = {};
      if (from) filter.at.$gte = new Date(from);
      if (to) filter.at.$lte = new Date(to);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [items, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ at: -1 })
        .skip(skip)
        .limit(Math.min(Number(limit), 200))
        .populate('actor', 'firstName lastName email role'),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({ items, total, page: Number(page), limit: Number(limit) });
  })
);

export default router;
