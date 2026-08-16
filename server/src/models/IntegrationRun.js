import mongoose from 'mongoose';

/**
 * A record of every connector run — scheduled or triggered by hand.
 *
 * This is what makes a silent failure impossible: if the nightly AccuFund
 * transfer did not happen, or happened and failed, it says so here and in the
 * admin screen rather than simply leaving yesterday's numbers in place.
 */
const integrationRunSchema = new mongoose.Schema(
  {
    connector: { type: String, required: true, index: true },
    operation: { type: String, required: true, trim: true },
    trigger: { type: String, enum: ['schedule', 'manual', 'startup'], default: 'schedule', index: true },

    status: { type: String, enum: ['running', 'success', 'partial', 'failed'], default: 'running', index: true },

    startedAt: { type: Date, required: true, default: Date.now, index: true },
    finishedAt: { type: Date },
    durationMs: { type: Number },

    /** Free-form counts: rows read, records created, files archived. */
    counts: { type: mongoose.Schema.Types.Mixed },
    message: { type: String, trim: true },
    /** Rows that could not be matched or applied, kept so staff can chase them. */
    issues: [{ type: mongoose.Schema.Types.Mixed }],

    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: false }
);

integrationRunSchema.index({ connector: 1, startedAt: -1 });

export default mongoose.model('IntegrationRun', integrationRunSchema);
