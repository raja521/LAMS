import mongoose from 'mongoose';
import legacyPlugin from './legacyPlugin.js';
import { MODULES } from '../config/permissions.js';

/** The paperwork covering work done on land. Purchase orders hang off it by reference. */
const contractSchema = new mongoose.Schema(
  {
    contractNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    type: {
      type: String,
      enum: ['services', 'construction', 'maintenance', 'purchase', 'lease', 'other'],
      default: 'services',
      index: true,
    },

    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'active', 'suspended', 'completed', 'terminated'],
      default: 'draft',
      index: true,
    },

    /** Which module's work this contract covers. */
    module: {
      type: String,
      enum: [MODULES.ACQUISITION, MODULES.MANAGEMENT, MODULES.DISPOSITION],
      required: true,
      index: true,
    },

    /** Referenced, not embedded — a contract can span many parcels. */
    parcels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', index: true }],
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', index: true },

    value: {
      amount: { type: Number, min: 0, default: 0 },
      currency: { type: String, default: 'USD', uppercase: true, trim: true },
    },

    startDate: { type: Date },
    endDate: { type: Date },
    executedOn: { type: Date },

    contractManager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

contractSchema.index({ status: 1, module: 1 });

/** Purchase orders are looked up by reference rather than nested in the contract. */
contractSchema.virtual('purchaseOrders', {
  ref: 'PurchaseOrder',
  localField: '_id',
  foreignField: 'contract',
});

/* Carries the original id from the District's old system. */
contractSchema.plugin(legacyPlugin);

export default mongoose.model('Contract', contractSchema);
