import mongoose from 'mongoose';

/**
 * A scored review of a property — used by Acquisition to rank properties the
 * District might buy, and by Disposition to decide whether one should be sold or
 * transferred. One model, two modules, because the workflow is the same shape:
 * score against criteria, total, rank, approve, generate a memo.
 *
 * The criteria and their weights come from templates/scoring/*.json, so the
 * review team can change how properties are judged without a code change.
 */
const scoreSchema = new mongoose.Schema(
  {
    /** Matches a criterion id in the scoring template. */
    criterionId: { type: String, required: true, trim: true },
    label: { type: String, trim: true },
    weight: { type: Number, required: true, min: 0 },
    score: { type: Number, required: true, min: 0 },
    maxScore: { type: Number, required: true, min: 1 },
    comment: { type: String, trim: true },
    scoredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const evaluationSchema = new mongoose.Schema(
  {
    /** What is being evaluated — a LandApplication or a DispositionCase. */
    subject: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    subjectType: { type: String, enum: ['LandApplication', 'DispositionCase'], required: true, index: true },

    module: { type: String, enum: ['acquisition', 'disposition'], required: true, index: true },

    template: { type: String, required: true, trim: true },
    templateVersion: { type: String, trim: true },

    scores: [scoreSchema],

    /** Computed by scoringService — stored so ranking queries stay cheap. */
    totalScore: { type: Number, default: 0, index: true },
    maxPossibleScore: { type: Number, default: 0 },
    normalizedScore: { type: Number, default: 0, index: true },

    /** Position within the same template and cycle, 1 = highest scoring. */
    rank: { type: Number, index: true },
    rankCycle: { type: String, trim: true, index: true },

    recommendation: {
      type: String,
      enum: ['pending', 'recommend', 'recommend_with_conditions', 'do_not_recommend'],
      default: 'pending',
      index: true,
    },
    recommendationNotes: { type: String, trim: true },

    status: { type: String, enum: ['draft', 'submitted', 'approved', 'rejected'], default: 'draft', index: true },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    decisionNotes: { type: String, trim: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

evaluationSchema.index({ subject: 1, subjectType: 1 }, { unique: true });
evaluationSchema.index({ module: 1, rankCycle: 1, normalizedScore: -1 });

export default mongoose.model('Evaluation', evaluationSchema);
