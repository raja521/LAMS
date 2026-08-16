import { Router } from 'express';
import {
  ActivityLog,
  Contract,
  DispositionCase,
  GeneratedDocument,
  LandApplication,
  MaintenanceTask,
  Parcel,
  PurchaseOrder,
  APPLICATION_STATUS,
  DISPOSITION_STATUS,
} from '../models/index.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { ACTIONS, PARCEL_STATUS_VALUES } from '../config/dashboard.js';
import { capabilitiesFor } from '../config/permissions.js';

const router = Router();

router.use(authenticate);

/**
 * Summary numbers for the landing page. The queries are real; the counts are
 * simply zero until the modules in the next step start creating records.
 */
router.get(
  '/summary',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const [
      byStatus,
      activeContracts,
      openPurchaseOrders,
      documentsGenerated,
      totalParcels,
      newApplications,
      applicationsInFlight,
      tasksDue,
      openDispositions,
    ] = await Promise.all([
      Parcel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Contract.countDocuments({ status: 'active' }),
      PurchaseOrder.countDocuments({ status: { $in: ['issued', 'partially_received', 'invoiced'] } }),
      GeneratedDocument.countDocuments({}),
      Parcel.countDocuments({}),
      LandApplication.countDocuments({ status: APPLICATION_STATUS.NEW }),
      LandApplication.countDocuments({
        status: { $nin: [APPLICATION_STATUS.COMPLETED, APPLICATION_STATUS.DECLINED, APPLICATION_STATUS.WITHDRAWN] },
      }),
      MaintenanceTask.countDocuments({ status: { $in: ['scheduled', 'in_progress'] } }),
      DispositionCase.countDocuments({
        status: { $nin: [DISPOSITION_STATUS.COMPLETED, DISPOSITION_STATUS.DECLINED] },
      }),
    ]);

    const parcels = Object.fromEntries(PARCEL_STATUS_VALUES.map((status) => [status, 0]));
    for (const row of byStatus) if (row._id in parcels) parcels[row._id] = row.count;

    res.json({
      parcels: { total: totalParcels, ...parcels },
      contracts: { active: activeContracts },
      purchaseOrders: { open: openPurchaseOrders },
      documents: { generated: documentsGenerated },
      applications: { new: newApplications, inFlight: applicationsInFlight },
      tasks: { open: tasksDue },
      dispositions: { open: openDispositions },
      capabilities: capabilitiesFor(req.user),
      generatedAt: new Date().toISOString(),
    });
  })
);

/** The "who changed what" feed shown on the dashboard. */
router.get(
  '/activity',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 10), 100);
    const items = await ActivityLog.find({}).sort({ at: -1 }).limit(limit).populate('actor', 'firstName lastName email');
    res.json({ items, limit });
  })
);

export default router;
