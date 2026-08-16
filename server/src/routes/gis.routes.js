import { Router } from 'express';
import { Parcel } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { ACTIONS } from '../config/permissions.js';
import { centroidOf, fetchFeatures, fetchParcelGeometry, gisStatus } from '../services/gisService.js';

const router = Router();

router.use(authenticate);

/**
 * The map talks to these three endpoints and nothing else. Whether the geometry
 * behind them comes from the sample file or the District's live ArcGIS service
 * is decided by GIS_PROVIDER — the browser never knows the difference, which is
 * what makes the real connection a configuration change later.
 */

router.get(
  '/status',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (_req, res) => res.json(gisStatus()))
);

/** Every feature, or the subset named by ?parcelIds=A,B,C */
router.get(
  '/features',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const parcelIds = req.query.parcelIds
      ? String(req.query.parcelIds)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    const collection = await fetchFeatures({ parcelIds, bbox: req.query.bbox });
    res.json(collection);
  })
);

/** Geometry for one parcel record, resolved through its stored geometry reference. */
router.get(
  '/parcels/:id/geometry',
  requirePermission(ACTIONS.READ),
  asyncHandler(async (req, res) => {
    const parcel = await Parcel.findById(req.params.id).select('parcelId name geometry county region area');
    if (!parcel) throw ApiError.notFound('That parcel does not exist.');

    // The record points at the shape; it never stores the shape itself.
    const lookupId = parcel.geometry?.ref || parcel.parcelId;
    const feature = await fetchParcelGeometry(lookupId);

    res.json({
      parcel: {
        id: parcel._id,
        parcelId: parcel.parcelId,
        name: parcel.name,
        county: parcel.county,
        region: parcel.region,
        area: parcel.area,
      },
      feature,
      centroid: feature ? centroidOf(feature) : null,
      resolvedFrom: lookupId,
    });
  })
);

export default router;
