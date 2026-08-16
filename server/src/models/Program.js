import mongoose from 'mongoose';
import legacyPlugin from './legacyPlugin.js';

/** A funding or work program that parcels belong to. */
const programSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, uppercase: true, index: true },
    description: { type: String, trim: true },
    fundingSource: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

/* Carries the original id from the District's old system. */
programSchema.plugin(legacyPlugin);

export default mongoose.model('Program', programSchema);
