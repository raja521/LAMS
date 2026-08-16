import { recordActivity } from '../services/activityService.js';
import { actionForMethod } from '../config/permissions.js';

/**
 * Automatic activity logging for state-changing requests.
 *
 * Mount it on a router and every successful create / update / delete on that
 * router is recorded without the route handler remembering to do it. A handler
 * can enrich the entry via `res.locals.audit = { entityId, entityLabel, changes }`.
 */
export function auditMutations({ entityType, module } = {}) {
  return (req, res, next) => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

    res.on('finish', () => {
      // Failed requests are covered by the error handler and the permission gate.
      if (res.statusCode >= 400) return;
      if (res.locals.auditSkip) return;

      const extra = res.locals.audit ?? {};
      void recordActivity({
        req,
        action: extra.action ?? actionForMethod(method),
        entityType: extra.entityType ?? entityType,
        entityId: extra.entityId,
        entityLabel: extra.entityLabel,
        module: extra.module ?? (typeof module === 'function' ? module(req) : module),
        changes: extra.changes,
        summary: extra.summary,
        success: true,
        statusCode: res.statusCode,
      });
    });

    next();
  };
}

export default auditMutations;
