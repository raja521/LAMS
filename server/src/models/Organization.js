import mongoose from 'mongoose';
import legacyPlugin from './legacyPlugin.js';

/**
 * The company / agency / district a person belongs to. Kept in its own
 * collection so a user carries a reference rather than a copy of the name.
 */
const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, uppercase: true, index: true },
    type: {
      type: String,
      enum: ['district', 'agency', 'contractor', 'consultant', 'other'],
      default: 'other',
      index: true,
    },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

/* Carries the original id from the District's old system. */
organizationSchema.plugin(legacyPlugin);

export default mongoose.model('Organization', organizationSchema);
