import mongoose from 'mongoose';

/**
 * The paperwork that has to happen before a purchase — or a sale — can close.
 * Built from templates/checklists/*.json so the District can change the steps
 * without a developer.
 *
 * Items live in their own collection (see ChecklistItem) rather than nested
 * here, so questions like "every overdue appraisal across all properties" stay
 * a single indexed query.
 */
const checklistSchema = new mongoose.Schema(
  {
    /** What the checklist is attached to. */
    subject: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    subjectType: {
      type: String,
      enum: ['LandApplication', 'DispositionCase', 'Parcel', 'Contract'],
      required: true,
      index: true,
    },

    module: { type: String, enum: ['acquisition', 'management', 'disposition'], required: true, index: true },

    template: { type: String, required: true, trim: true },
    templateVersion: { type: String, trim: true },
    name: { type: String, required: true, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

checklistSchema.index({ subject: 1, subjectType: 1, template: 1 }, { unique: true });

checklistSchema.virtual('items', {
  ref: 'ChecklistItem',
  localField: '_id',
  foreignField: 'checklist',
});

export default mongoose.model('Checklist', checklistSchema);
