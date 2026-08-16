import mongoose from 'mongoose';

/**
 * The planning document the District builds for a property under consideration:
 * a site inspection, a program plan and a rough cost estimate in one short form.
 *
 * It is filled in from a reusable template (templates/prospectus/*.json), so the
 * team starts from prompted sections rather than a blank page.
 */
const costLineSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    category: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0, default: 0 },
    recurring: { type: Boolean, default: false },
    notes: { type: String, trim: true },
  },
  { _id: true }
);

const prospectusSchema = new mongoose.Schema(
  {
    landApplication: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LandApplication',
      required: true,
      unique: true,
      index: true,
    },
    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', index: true },

    /** Which prospectus template this was built from. */
    template: { type: String, required: true, trim: true },
    templateVersion: { type: String, trim: true },

    title: { type: String, required: true, trim: true },

    /**
     * Answers keyed by the field ids declared in the template. Kept as a map so a
     * template can gain or lose a question without a schema migration.
     */
    responses: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

    siteInspection: {
      inspectedOn: { type: Date },
      inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      conditionSummary: { type: String, trim: true },
      accessNotes: { type: String, trim: true },
      concerns: { type: String, trim: true },
    },

    programPlan: {
      program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
      intendedUse: { type: String, trim: true },
      managementApproach: { type: String, trim: true },
      horizonYears: { type: Number, min: 0, default: 5 },
    },

    /** Rough cost estimate — line items totalled on read. */
    costEstimate: {
      lines: [costLineSchema],
      contingencyPercent: { type: Number, min: 0, max: 100, default: 10 },
      currency: { type: String, default: 'USD', uppercase: true, trim: true },
    },

    status: { type: String, enum: ['draft', 'in_review', 'final'], default: 'draft', index: true },

    preparedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

prospectusSchema.virtual('costEstimate.subtotal').get(function subtotal() {
  return (this.costEstimate?.lines ?? []).reduce((sum, line) => sum + (line.amount ?? 0), 0);
});

prospectusSchema.virtual('costEstimate.total').get(function total() {
  const lines = (this.costEstimate?.lines ?? []).reduce((sum, line) => sum + (line.amount ?? 0), 0);
  const contingency = lines * ((this.costEstimate?.contingencyPercent ?? 0) / 100);
  return Math.round((lines + contingency) * 100) / 100;
});

export default mongoose.model('Prospectus', prospectusSchema);
