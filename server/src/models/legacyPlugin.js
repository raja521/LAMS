/**
 * Keeps each record's original identifier from the old system alongside its new
 * one, so anything in LAMS can always be traced back to where it came from.
 *
 * Applied as a schema plugin rather than repeated on every model, so every
 * migrated collection carries the same shape and the same indexes.
 */
import mongoose from 'mongoose';

export default function legacyPlugin(schema) {
  schema.add({
    legacy: {
      /** Which old system the record came from, e.g. "District Land Tracker". */
      system: { type: String, trim: true },
      /** The primary key it had over there. Never reused, never overwritten. */
      id: { type: String, trim: true },
      /** Sheet/table it came from, when the export had more than one. */
      source: { type: String, trim: true },
      /** Which migration batch brought it across. */
      batch: { type: String, trim: true, index: true },
      importedAt: { type: Date },
      /** The original row, kept verbatim so a mismatch can always be explained. */
      raw: { type: mongoose.Schema.Types.Mixed, select: false },
    },
  });

  // Sparse so records created in LAMS (with no legacy id) are unaffected.
  schema.index({ 'legacy.system': 1, 'legacy.id': 1 }, { sparse: true });
}
