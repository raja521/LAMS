import { ActivityLog } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Append an entry to the activity log.
 *
 * Logging must never break the operation it is recording, so failures here are
 * reported and swallowed rather than thrown.
 */
export async function recordActivity({
  req,
  actor,
  action,
  entityType,
  entityId,
  entityLabel,
  module,
  changes,
  summary,
  success = true,
  statusCode,
}) {
  try {
    const user = actor ?? req?.user;
    await ActivityLog.create({
      actor: user?._id,
      actorEmail: user?.email,
      actorRole: user?.role,
      action,
      entityType,
      entityId,
      entityLabel,
      module,
      changes,
      summary,
      success,
      method: req?.method,
      path: req?.originalUrl,
      statusCode,
      ipAddress: req?.ip,
      userAgent: req?.get?.('user-agent'),
      at: new Date(),
    });
  } catch (error) {
    logger.error('Failed to write activity log entry:', error.message);
  }
}

/**
 * Field-level diff for update entries — records what actually changed rather
 * than the whole document.
 */
export function diffFields(before = {}, after = {}, fields) {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes = {};
  for (const key of keys) {
    const from = before?.[key];
    const to = after?.[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  return Object.keys(changes).length ? changes : undefined;
}
