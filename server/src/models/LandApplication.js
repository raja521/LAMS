import mongoose from 'mongoose';
import legacyPlugin from './legacyPlugin.js';

/**
 * An offer from a landowner to sell land to the District — the front of the
 * acquisition queue. Arrives from the online form system (simulated for now)
 * and is given a file number automatically on the way in.
 */
export const APPLICATION_STATUS = Object.freeze({
  NEW: 'new',
  UNDER_REVIEW: 'under_review',
  PROSPECTUS_DRAFTED: 'prospectus_drafted',
  SCORED: 'scored',
  APPROVED: 'approved',
  DECLINED: 'declined',
  CLOSING: 'closing',
  COMPLETED: 'completed',
  WITHDRAWN: 'withdrawn',
});

const landApplicationSchema = new mongoose.Schema(
  {
    /** Assigned automatically — nobody types one of these. */
    fileNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },

    /** Where it came from: the online form, a webhook, or entered by hand. */
    source: { type: String, enum: ['online_form', 'webhook', 'manual', 'simulated'], required: true, index: true },
    externalReference: { type: String, trim: true, index: true, sparse: true },
    submittedAt: { type: Date, required: true, default: Date.now, index: true },

    applicant: {
      name: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      phone: { type: String, trim: true },
      mailingAddress: { type: String, trim: true },
      organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
    },

    property: {
      description: { type: String, trim: true },
      address: { type: String, trim: true },
      county: { type: String, required: true, trim: true, index: true },
      region: { type: String, trim: true, index: true },
      acres: { type: Number, min: 0 },
      parcelIdentifiers: [{ type: String, trim: true }],
      askingPrice: { type: Number, min: 0 },
      /** Reference to the map shape, same shape used on Parcel. */
      geometry: {
        source: { type: String, enum: ['arcgis', 'storage', 'external', 'sample', 'none'], default: 'none' },
        ref: { type: String, trim: true },
        featureId: { type: String, trim: true },
        srid: { type: String, trim: true },
        centroid: { lat: Number, lng: Number },
      },
    },

    status: {
      type: String,
      enum: Object.values(APPLICATION_STATUS),
      required: true,
      default: APPLICATION_STATUS.NEW,
      index: true,
    },

    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    /** Set once the application has been carried forward into Land Management. */
    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', index: true },
    advancedToManagementAt: { type: Date },

    notes: { type: String, trim: true },
    declineReason: { type: String, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

landApplicationSchema.index({ status: 1, submittedAt: -1 });
landApplicationSchema.index({ 'property.county': 1, status: 1 });

/** Everything hanging off an application is fetched by reference, not nested. */
landApplicationSchema.virtual('prospectus', {
  ref: 'Prospectus',
  localField: '_id',
  foreignField: 'landApplication',
  justOne: true,
});

landApplicationSchema.virtual('evaluation', {
  ref: 'Evaluation',
  localField: '_id',
  foreignField: 'subject',
  justOne: true,
});

/* Carries the original id from the District's old system. */
landApplicationSchema.plugin(legacyPlugin);

export default mongoose.model('LandApplication', landApplicationSchema);
