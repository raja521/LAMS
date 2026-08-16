import mongoose from 'mongoose';

/**
 * A multi-year plan for a piece of land, organized by program area — prescribed
 * burning, mowing, road maintenance and so on. One plan per parcel per program
 * area, with an entry for each year in the horizon.
 */
export const PROGRAM_AREAS = Object.freeze([
  'prescribed_burning',
  'mowing',
  'road_maintenance',
  'boundary_maintenance',
  'vegetation_management',
  'invasive_species_control',
  'rare_species_monitoring',
  'facility_repair',
  'timber',
  'other',
]);

const plannedYearSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, min: 1900 },
    planned: { type: Boolean, default: true },
    activity: { type: String, trim: true },
    estimatedCost: { type: Number, min: 0, default: 0 },
    acres: { type: Number, min: 0 },
    status: {
      type: String,
      enum: ['planned', 'scheduled', 'in_progress', 'complete', 'deferred', 'cancelled'],
      default: 'planned',
    },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const managementPlanSchema = new mongoose.Schema(
  {
    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
    program: { type: mongoose.Schema.Types.ObjectId, ref: 'Program', index: true },

    programArea: { type: String, enum: PROGRAM_AREAS, required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    startYear: { type: Number, required: true, min: 1900 },
    endYear: { type: Number, required: true, min: 1900 },

    /** One row per year in the horizon — small, fixed, and always read together. */
    years: [plannedYearSchema],

    status: { type: String, enum: ['draft', 'active', 'complete', 'archived'], default: 'draft', index: true },

    responsible: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

managementPlanSchema.index({ parcel: 1, programArea: 1, startYear: 1 });

managementPlanSchema.virtual('totalEstimatedCost').get(function totalEstimatedCost() {
  return (this.years ?? []).reduce((sum, year) => sum + (year.estimatedCost ?? 0), 0);
});

export default mongoose.model('ManagementPlan', managementPlanSchema);
