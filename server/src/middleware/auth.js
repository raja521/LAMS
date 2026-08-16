import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { verifyAccessToken } from '../services/tokenService.js';
import { recordActivity } from '../services/activityService.js';
import { ACTIONS, ROLES, can, capabilitiesFor } from '../config/permissions.js';

function bearerToken(req) {
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.lams_access_token ?? null;
}

/**
 * Identify the caller. The user is re-read from the database on every request so
 * a revoked account or a changed role takes effect at once, not at token expiry.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized('Sign in to continue.');

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (error) {
    const expired = error.name === 'TokenExpiredError';
    throw ApiError.unauthorized(expired ? 'Your session has expired. Please sign in again.' : 'Invalid session token.', {
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    });
  }

  const user = await User.findById(payload.sub).populate('organization', 'name code type');
  if (!user) throw ApiError.unauthorized('This account no longer exists.');
  if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.');

  req.user = user;
  next();
});

/**
 * Server-side permission gate. This is the authoritative check — the client's
 * greyed-out buttons are a courtesy, this is the thing that cannot be bypassed.
 *
 *   requirePermission(ACTIONS.UPDATE, MODULES.ACQUISITION)
 */
export function requirePermission(action, module) {
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized('Sign in to continue.');

    const targetModule = typeof module === 'function' ? module(req) : module;

    if (!can(req.user, action, targetModule)) {
      await recordActivity({
        req,
        action: 'permission_denied',
        module: targetModule,
        success: false,
        statusCode: 403,
        summary: `Denied ${action}${targetModule ? ` on ${targetModule}` : ''} for role ${req.user.role}.`,
      });
      throw ApiError.forbidden(deniedMessage(req.user, action, targetModule), {
        details: { requiredAction: action, module: targetModule, yourRole: req.user.role },
      });
    }
    next();
  });
}

/** Restrict a route to specific roles, independent of module assignment. */
export function requireRole(...roles) {
  const allowed = roles.flat();
  return asyncHandler(async (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized('Sign in to continue.');
    if (!allowed.includes(req.user.role)) {
      await recordActivity({
        req,
        action: 'permission_denied',
        success: false,
        statusCode: 403,
        summary: `Denied: route requires ${allowed.join(' or ')}, caller is ${req.user.role}.`,
      });
      throw ApiError.forbidden('This area is restricted to administrators.', {
        details: { requiredRoles: allowed, yourRole: req.user.role },
      });
    }
    next();
  });
}

export const requireAdmin = requireRole(ROLES.ADMIN);

/** Attach the caller's capability map to the response body helper. */
export function attachCapabilities(req, res, next) {
  res.locals.capabilities = req.user ? capabilitiesFor(req.user) : null;
  next();
}

function deniedMessage(user, action, module) {
  if (user.role === ROLES.READ_ONLY) {
    return 'Your account is Read Only, so it cannot make changes.';
  }
  if (user.role === ROLES.MODULE_EDITOR && action !== ACTIONS.READ) {
    const assigned = user.modules?.length ? user.modules.join(', ') : 'none';
    return `You can only make changes in the modules assigned to you (${assigned}).`;
  }
  return 'You do not have permission to perform this action.';
}
