import mongoose from 'mongoose';
import { PROGRAM_AREAS } from './ManagementPlan.js';

/**
 * Scheduled maintenance work on a property. Each task ties a piece of land to
 * the contract and purchase order paying for it, so the money and the work stay
 * connected without anyone cross-referencing spreadsheets.
 */
export const TASK_TYPES = Object.freeze([
  'boundary_maintenance',
  'vegetation_management',
  'road_maintenance',
  'ditch_maintenance',
  'invasive_species_control',
  'rare_species_monitoring',
  'facility_repair',
  'prescribed_burn',
  'mowing',
  'timber_operation',
  'other',
]);

const maintenanceTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    taskType: { type: String, enum: TASK_TYPES, required: true, index: true },
    programArea: { type: String, enum: PROGRAM_AREAS, index: true },

    /* The three links that keep work, land and money joined up. */
    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', index: true },
    managementPlan: { type: mongoose.Schema.Types.ObjectId, ref: 'ManagementPlan', index: true },

    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'complete', 'deferred', 'cancelled'],
      default: 'scheduled',
      index: true,
    },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal', index: true },

    scheduledStart: { type: Date, index: true },
    scheduledEnd: { type: Date },
    completedOn: { type: Date },

    acres: { type: Number, min: 0 },
    estimatedCost: { type: Number, min: 0, default: 0 },
    actualCost: { type: Number, min: 0 },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', index: true },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

maintenanceTaskSchema.index({ parcel: 1, scheduledStart: 1 });
maintenanceTaskSchema.index({ status: 1, scheduledStart: 1 });

export default mongoose.model('MaintenanceTask', maintenanceTaskSchema);
