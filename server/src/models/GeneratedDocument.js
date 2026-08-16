import mongoose from 'mongoose';
import { MODULES } from '../config/permissions.js';

/**
 * A record of every memo, contract, letter or bid the system produced —
 * who generated it, when, from what, and where the file itself lives.
 * The file bytes stay in storage (local or S3); this is the index card.
 */
const generatedDocumentSchema = new mongoose.Schema(
  {
    /** Assigned automatically — see numberingService. */
    documentNumber: { type: String, required: true, unique: true, trim: true },

    documentType: {
      type: String,
      enum: ['memo', 'contract', 'letter', 'bid', 'offer', 'appraisal', 'report', 'other'],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },

    /** Which template produced it, so a regeneration is reproducible. */
    template: { type: String, trim: true },
    templateVersion: { type: String, trim: true },

    module: {
      type: String,
      enum: [MODULES.ACQUISITION, MODULES.MANAGEMENT, MODULES.DISPOSITION],
      index: true,
    },

    /** What the document is about — references, never copies. */
    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', index: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', index: true },
    landApplication: { type: mongoose.Schema.Types.ObjectId, ref: 'LandApplication', index: true },
    dispositionCase: { type: mongoose.Schema.Types.ObjectId, ref: 'DispositionCase', index: true },
    recipientOrganization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },

    /** Where the rendered file lives. */
    storage: {
      provider: { type: String, enum: ['local', 's3'], required: true },
      key: { type: String, required: true, trim: true },
      bucket: { type: String, trim: true },
      mimeType: { type: String, trim: true, default: 'application/pdf' },
      sizeBytes: { type: Number, min: 0 },
      checksum: { type: String, trim: true },
    },

    status: {
      type: String,
      enum: ['generated', 'under_review', 'issued', 'signed', 'void'],
      default: 'generated',
      index: true,
    },

    /** Who created it and when — required by the District's audit expectations. */
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    generatedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

generatedDocumentSchema.index({ documentType: 1, generatedAt: -1 });
generatedDocumentSchema.index({ generatedBy: 1, generatedAt: -1 });

export default mongoose.model('GeneratedDocument', generatedDocumentSchema);
