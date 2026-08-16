import mongoose from 'mongoose';
import legacyPlugin from './legacyPlugin.js';

/** A purchase order issued against a contract. */
const purchaseOrderSchema = new mongoose.Schema(
  {
    poNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },

    /** Every PO points at its contract; the contract does not carry a nested list. */
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', index: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },

    description: { type: String, trim: true },

    status: {
      type: String,
      enum: ['draft', 'issued', 'partially_received', 'received', 'invoiced', 'paid', 'cancelled'],
      default: 'draft',
      index: true,
    },

    amount: {
      value: { type: Number, min: 0, required: true, default: 0 },
      currency: { type: String, default: 'USD', uppercase: true, trim: true },
    },
    amountInvoiced: { type: Number, min: 0, default: 0 },
    amountPaid: { type: Number, min: 0, default: 0 },

    issuedOn: { type: Date },
    dueOn: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

purchaseOrderSchema.index({ contract: 1, status: 1 });

/* Carries the original id from the District's old system. */
purchaseOrderSchema.plugin(legacyPlugin);

export default mongoose.model('PurchaseOrder', purchaseOrderSchema);
