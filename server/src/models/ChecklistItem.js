import mongoose from 'mongoose';

export const CHECKLIST_ITEM_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  COMPLETE: 'complete',
  NOT_APPLICABLE: 'not_applicable',
});

/** One line of paperwork — an appraisal, an environmental assessment, a contract. */
const checklistItemSchema = new mongoose.Schema(
  {
    checklist: { type: mongoose.Schema.Types.ObjectId, ref: 'Checklist', required: true, index: true },

    /** Matches an item id in the checklist template. */
    itemId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    order: { type: Number, default: 0 },
    required: { type: Boolean, default: true },

    status: {
      type: String,
      enum: Object.values(CHECKLIST_ITEM_STATUS),
      default: CHECKLIST_ITEM_STATUS.NOT_STARTED,
      index: true,
    },

    dueOn: { type: Date, index: true },
    completedOn: { type: Date },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    /** A generated or uploaded document that satisfies this item. */
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'GeneratedDocument' },

    notes: { type: String, trim: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

checklistItemSchema.index({ checklist: 1, order: 1 });
checklistItemSchema.index({ status: 1, dueOn: 1 });

export default mongoose.model('ChecklistItem', checklistItemSchema);
