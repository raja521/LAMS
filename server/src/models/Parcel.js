import mongoose from 'mongoose';
import legacyPlugin from './legacyPlugin.js';
import { MODULES } from '../config/permissions.js';

/**
 * A piece of land. The map shape itself is NOT stored here — this record holds a
 * reference to where the geometry lives (GIS feature service, shapefile in
 * object storage, etc.), which keeps parcel queries and reports fast.
 */
export const PARCEL_STATUS = Object.freeze({
  ACQUISITION: 'acquisition',
  MANAGEMENT: 'management',
  DISPOSITION: 'disposition',
});

const geometryRefSchema = new mongoose.Schema(
  {
    /** How to resolve the shape: a GIS service, a file in storage, or none yet. */
    source: { type: String, enum: ['arcgis', 'storage', 'external', 'sample', 'none'], default: 'none' },
    /** Service URL, storage key, or other locator — never the geometry itself. */
    ref: { type: String, trim: true },
    /** Layer/feature identifier within the source, when applicable. */
    featureId: { type: String, trim: true },
    /** Coordinate reference system, e.g. EPSG:4326. */
    srid: { type: String, trim: true },
  },
  { _id: false }
);

const parcelSchema = new mongoose.Schema(
  {
    /** Human-facing identifier, e.g. the APN or district parcel number. */
    parcelId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },

    region: { type: String, required: true, trim: true, index: true },
    county: { type: String, required: true, trim: true, index: true },

    /** Size with its unit kept alongside, so acres and hectares never get mixed up. */
    area: {
      value: { type: Number, required: true, min: 0 },
      unit: { type: String, enum: ['acres', 'hectares', 'sq_ft', 'sq_m'], default: 'acres' },
    },

    /** Which program owns this parcel, by reference. */
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', index: true },
    programName: { type: String, trim: true, index: true },

    status: {
      type: String,
      enum: Object.values(PARCEL_STATUS),
      required: true,
      index: true,
    },

    /** Which module currently owns the work on this parcel — mirrors status. */
    module: {
      type: String,
      enum: [MODULES.ACQUISITION, MODULES.MANAGEMENT, MODULES.DISPOSITION],
      index: true,
    },

    geometry: { type: geometryRefSchema, default: () => ({}) },

    ownerOrganization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    acquiredOn: { type: Date },
    disposedOn: { type: Date },
    notes: { type: String, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

/* Reporting-shaped indexes: the dashboard counts by status, region and county. */
parcelSchema.index({ status: 1, region: 1 });
parcelSchema.index({ county: 1, status: 1 });
parcelSchema.index({ name: 'text', parcelId: 'text', notes: 'text' });

/** Status and module move together, so a caller can never set them out of sync. */
parcelSchema.pre('save', function syncModule(next) {
  if (this.isModified('status') || !this.module) this.module = this.status;
  next();
});

/* Carries the original id from the District's old system. */
parcelSchema.plugin(legacyPlugin);

export default mongoose.model('Parcel', parcelSchema);
