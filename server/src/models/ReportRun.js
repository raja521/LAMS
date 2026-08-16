import mongoose from 'mongoose';

/**
 * A report that was actually produced — scheduled or on demand — so staff can
 * find last month's figures again without re-running anything.
 */
const reportRunSchema = new mongoose.Schema(
  {
    reportId: { type: String, required: true, trim: true, index: true },
    reportName: { type: String, required: true, trim: true },

    trigger: { type: String, enum: ['schedule', 'manual'], default: 'manual', index: true },
    format: { type: String, enum: ['json', 'xlsx'], default: 'xlsx' },

    /** The filters the report was run with, so a figure can be reproduced. */
    filters: { type: mongoose.Schema.Types.Mixed },

    rowCount: { type: Number, default: 0 },
    truncated: { type: Boolean, default: false },

    /** Where the generated file was written, when one was kept. */
    storage: {
      provider: { type: String, enum: ['local', 's3'] },
      key: { type: String, trim: true },
      bucket: { type: String, trim: true },
      sizeBytes: { type: Number },
    },

    status: { type: String, enum: ['success', 'failed'], default: 'success', index: true },
    message: { type: String, trim: true },

    periodStart: { type: Date },
    periodEnd: { type: Date },

    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedAt: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: false }
);

reportRunSchema.index({ reportId: 1, generatedAt: -1 });

export default mongoose.model('ReportRun', reportRunSchema);
