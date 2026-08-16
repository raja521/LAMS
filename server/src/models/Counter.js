import mongoose from 'mongoose';

/**
 * Backing store for automatic reference numbers. One document per
 * (sequence, scope) pair, incremented atomically so two people submitting at the
 * same moment can never be handed the same file number.
 */
const counterSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Counter', counterSchema);
