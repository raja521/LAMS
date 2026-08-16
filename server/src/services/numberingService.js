/**
 * Automatic reference numbers — file numbers, contract numbers, PO numbers,
 * document numbers and disposition case numbers.
 *
 * Nobody types one of these by hand. The prefixes, padding width and whether the
 * sequence restarts each year all come from the environment, so the District's
 * own numbering convention can be matched without a code change.
 */
import config from '../config/env.js';
import Counter from '../models/Counter.js';

const { prefixes, pad, scope } = config.numbering;

export const SEQUENCES = Object.freeze({
  APPLICATION: 'application',
  CONTRACT: 'contract',
  PURCHASE_ORDER: 'purchaseOrder',
  DOCUMENT: 'document',
  DISPOSITION: 'disposition',
});

/**
 * Reserve the next number in a sequence.
 *
 * findOneAndUpdate with $inc and upsert is a single atomic operation, so
 * concurrent callers each get a distinct value.
 */
export async function nextNumber(sequence, { at = new Date() } = {}) {
  const prefix = prefixes[sequence];
  if (!prefix) throw new Error(`Unknown numbering sequence "${sequence}".`);

  const year = at.getFullYear();
  const key = scope === 'yearly' ? `${sequence}:${year}` : sequence;

  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const serial = String(counter.value).padStart(pad, '0');
  return scope === 'yearly' ? `${prefix}-${year}-${serial}` : `${prefix}-${serial}`;
}

/** What the next number would look like, without consuming it. */
export async function peekNumber(sequence, { at = new Date() } = {}) {
  const prefix = prefixes[sequence];
  const year = at.getFullYear();
  const key = scope === 'yearly' ? `${sequence}:${year}` : sequence;
  const counter = await Counter.findOne({ key });
  const serial = String((counter?.value ?? 0) + 1).padStart(pad, '0');
  return scope === 'yearly' ? `${prefix}-${year}-${serial}` : `${prefix}-${serial}`;
}
