import mongoose from 'mongoose';

/**
 * A property being considered for sale or transfer out of the District's
 * portfolio. Carries the same shape of workflow as acquisition — evaluate,
 * approve, generate a memo, work a closing checklist — deliberately, so the two
 * reuse the same engines.
 */
export const DISPOSITION_STATUS = Object.freeze({
  IDENTIFIED: 'identified',
  UNDER_EVALUATION: 'under_evaluation',
  EVALUATED: 'evaluated',
  APPROVED: 'approved',
  DECLINED: 'declined',
  LISTED: 'listed',
  CLOSING: 'closing',
  COMPLETED: 'completed',
});

const dispositionCaseSchema = new mongoose.Schema(
  {
    /** Assigned automatically, same as acquisition file numbers. */
    caseNumber: { type: String, required: true, unique: true, trim: true, uppercase: true },

    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },

    title: { type: String, required: true, trim: true },
    reason: { type: String, trim: true },

    method: {
      type: String,
      enum: ['sale', 'transfer', 'exchange', 'lease', 'undetermined'],
      default: 'undetermined',
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(DISPOSITION_STATUS),
      default: DISPOSITION_STATUS.IDENTIFIED,
      required: true,
      index: true,
    },

    /** Where the property came from — set when carried in from Land Management. */
    originModule: { type: String, enum: ['management', 'acquisition', 'manual'], default: 'manual' },
    advancedFromManagementAt: { type: Date },
    /** Management records copied forward for reference, by id not by value. */
    carriedForward: {
      managementPlans: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ManagementPlan' }],
      maintenanceTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceTask' }],
      contracts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Contract' }],
    },

    estimatedValue: { type: Number, min: 0 },
    appraisedValue: { type: Number, min: 0 },
    salePrice: { type: Number, min: 0 },
    currency: { type: String, default: 'USD', uppercase: true, trim: true },

    recipient: {
      name: { type: String, trim: true },
      organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
      contactEmail: { type: String, trim: true, lowercase: true },
    },

    listedOn: { type: Date },
    closedOn: { type: Date },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    notes: { type: String, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

dispositionCaseSchema.index({ status: 1, createdAt: -1 });

dispositionCaseSchema.virtual('evaluation', {
  ref: 'Evaluation',
  localField: '_id',
  foreignField: 'subject',
  justOne: true,
});

export default mongoose.model('DispositionCase', dispositionCaseSchema);
