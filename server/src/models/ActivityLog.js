import mongoose from 'mongoose';

/**
 * Who changed what, when — across the whole system. Several people use LAMS at
 * once, so every create/update/delete lands here. Entries are append-only.
 */
export const ACTIVITY_ACTIONS = Object.freeze([
  'create',
  'update',
  'delete',
  'login',
  'login_failed',
  'logout',
  'permission_denied',
  'export',
  'generate_document',
]);

const activityLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    /** Kept alongside the reference so the log stays readable if a user is removed. */
    actorEmail: { type: String, trim: true, lowercase: true },
    actorRole: { type: String, trim: true },

    action: { type: String, enum: ACTIVITY_ACTIONS, required: true, index: true },

    entityType: { type: String, trim: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },
    entityLabel: { type: String, trim: true },

    module: { type: String, trim: true, index: true },

    /** Field-level before/after for updates: { field: { from, to } }. */
    changes: { type: mongoose.Schema.Types.Mixed },

    summary: { type: String, trim: true },
    success: { type: Boolean, default: true, index: true },

    method: { type: String, trim: true },
    path: { type: String, trim: true },
    statusCode: { type: Number },
    ipAddress: { type: String, trim: true },
    userAgent: { type: String, trim: true },

    at: { type: Date, required: true, default: Date.now, index: true },
  },
  {
    timestamps: false,
    // The log is a record of what happened; nothing rewrites it after the fact.
    strict: true,
  }
);

activityLogSchema.index({ at: -1 });
activityLogSchema.index({ actor: 1, at: -1 });
activityLogSchema.index({ entityType: 1, entityId: 1, at: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);
