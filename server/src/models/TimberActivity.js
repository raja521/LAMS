import mongoose from 'mongoose';

/**
 * Timber work is a distinct, specialised part of what the District does, so it
 * gets its own record type rather than being squeezed into a general
 * maintenance task: pre-harvest meetings, sales, inspections, load tracking,
 * standing inventory and reforestation planning.
 */
export const TIMBER_ACTIVITY_TYPES = Object.freeze([
  'pre_harvest_meeting',
  'timber_sale',
  'inspection',
  'load_tracking',
  'inventory',
  'reforestation_plan',
]);

/** One truckload leaving the site — only used on load_tracking records. */
const loadSchema = new mongoose.Schema(
  {
    ticketNumber: { type: String, required: true, trim: true },
    haulDate: { type: Date, required: true },
    species: { type: String, trim: true },
    product: { type: String, trim: true },
    volume: { type: Number, min: 0, required: true },
    volumeUnit: { type: String, enum: ['cords', 'tons', 'mbf', 'cubic_meters'], default: 'cords' },
    hauler: { type: String, trim: true },
    destination: { type: String, trim: true },
    value: { type: Number, min: 0 },
  },
  { _id: true }
);

const timberActivitySchema = new mongoose.Schema(
  {
    activityType: { type: String, enum: TIMBER_ACTIVITY_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true },

    parcel: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
    contract: { type: mongoose.Schema.Types.ObjectId, ref: 'Contract', index: true },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', index: true },
    /** Loads and inspections point back at the sale they belong to. */
    parentActivity: { type: mongoose.Schema.Types.ObjectId, ref: 'TimberActivity', index: true },

    occurredOn: { type: Date, index: true },
    status: {
      type: String,
      enum: ['planned', 'scheduled', 'in_progress', 'complete', 'cancelled'],
      default: 'planned',
      index: true,
    },

    /* --- pre-harvest meeting --- */
    attendees: [{ type: String, trim: true }],
    meetingNotes: { type: String, trim: true },

    /* --- timber sale --- */
    sale: {
      saleNumber: { type: String, trim: true },
      buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
      acres: { type: Number, min: 0 },
      estimatedVolume: { type: Number, min: 0 },
      volumeUnit: { type: String, enum: ['cords', 'tons', 'mbf', 'cubic_meters'], default: 'cords' },
      awardedAmount: { type: Number, min: 0 },
      bidOpeningDate: { type: Date },
      contractExpiry: { type: Date },
    },

    /* --- inspection --- */
    inspection: {
      inspector: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      compliant: { type: Boolean },
      findings: { type: String, trim: true },
      correctiveActions: { type: String, trim: true },
    },

    /* --- load tracking --- */
    loads: [loadSchema],

    /* --- standing inventory --- */
    inventory: {
      cruiseDate: { type: Date },
      acresCruised: { type: Number, min: 0 },
      speciesComposition: { type: String, trim: true },
      volumePerAcre: { type: Number, min: 0 },
      totalVolume: { type: Number, min: 0 },
      volumeUnit: { type: String, enum: ['cords', 'tons', 'mbf', 'cubic_meters'], default: 'cords' },
    },

    /* --- reforestation --- */
    reforestation: {
      method: { type: String, enum: ['natural', 'planting', 'seeding', 'mixed'], default: 'natural' },
      species: [{ type: String, trim: true }],
      acres: { type: Number, min: 0 },
      seedlingCount: { type: Number, min: 0 },
      plannedYear: { type: Number },
      survivalCheckDate: { type: Date },
    },

    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

timberActivitySchema.index({ parcel: 1, activityType: 1, occurredOn: -1 });

timberActivitySchema.virtual('totalLoadVolume').get(function totalLoadVolume() {
  return (this.loads ?? []).reduce((sum, load) => sum + (load.volume ?? 0), 0);
});

timberActivitySchema.virtual('totalLoadValue').get(function totalLoadValue() {
  return (this.loads ?? []).reduce((sum, load) => sum + (load.value ?? 0), 0);
});

export default mongoose.model('TimberActivity', timberActivitySchema);
