import mongoose from 'mongoose';

/**
 * A pointer from a LAMS record to a record in one of the District's other
 * systems — a PaperVision document, a PERCH site, a CivicPlus submission, a row
 * in the old land tracker.
 *
 * This is deliberately a reference and never a copy. It holds the external id, a
 * click-through URL and a label; the content of record stays where it is.
 */
const externalReferenceSchema = new mongoose.Schema(
  {
    system: {
      type: String,
      enum: ['papervision', 'perch', 'civicplus', 'accufund', 'arcgis', 'legacy'],
      required: true,
      index: true,
    },

    /** The identifier that system uses. */
    externalId: { type: String, required: true, trim: true, index: true },
    /** Where a person clicks through to see the real thing. */
    externalUrl: { type: String, trim: true },

    /** What in LAMS this hangs off. */
    entityType: {
      type: String,
      enum: ['Parcel', 'LandApplication', 'Contract', 'PurchaseOrder', 'DispositionCase', 'Organization', 'MaintenanceTask'],
      required: true,
      index: true,
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    label: { type: String, trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed },

    syncedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

externalReferenceSchema.index({ system: 1, externalId: 1, entityType: 1, entityId: 1 }, { unique: true });
externalReferenceSchema.index({ entityType: 1, entityId: 1, system: 1 });

export default mongoose.model('ExternalReference', externalReferenceSchema);
