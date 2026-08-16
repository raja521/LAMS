import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { issueTokens, verifyRefreshToken } from '../services/tokenService.js';
import { recordActivity } from '../services/activityService.js';
import { capabilitiesFor } from '../config/permissions.js';
import { buildAuthorizeUrl, exchangeCodeForProfile, resolveRoleFromClaims } from '../services/azureAdService.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait and try again.' } },
});

function sessionPayload(user) {
  return {
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      modules: user.modules,
      organization: user.organization ?? null,
      authProvider: user.authProvider,
      lastLoginAt: user.lastLoginAt,
    },
    capabilities: capabilitiesFor(user),
  };
}

/**
 * What the sign-in screen needs to render itself. Everything here comes from the
 * environment — the client never hard-codes a provider, tenant or org name.
 */
router.get('/config', (_req, res) => {
  res.json({
    providers: config.auth.providers,
    localEnabled: config.auth.localEnabled,
    azureEnabled: config.auth.azure.enabled,
    azureStartUrl: config.auth.azure.enabled ? `${config.apiBaseUrl}/api/auth/azure-ad/start` : null,
  });
});

/** Local sign-in (email + password held in LAMS). */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    if (!config.auth.localEnabled) {
      throw ApiError.badRequest('Password sign-in is disabled. Use your organizational account.');
    }

    const { email, password } = req.body ?? {};
    if (!email || !password) throw ApiError.badRequest('Enter both your email address and password.');

    const user = await User.findOne({ email: String(email).toLowerCase().trim() })
      .select('+passwordHash')
      .populate('organization', 'name code type');

    // One message for both cases, so the response never confirms an address exists.
    const invalid = ApiError.unauthorized('That email address or password is not correct.');

    if (!user || user.authProvider !== 'local') {
      await recordActivity({
        req,
        action: 'login_failed',
        success: false,
        statusCode: 401,
        summary: `Failed sign-in for ${email}.`,
      });
      throw invalid;
    }

    if (!(await user.verifyPassword(password))) {
      await recordActivity({
        req,
        actor: user,
        action: 'login_failed',
        success: false,
        statusCode: 401,
        summary: 'Incorrect password.',
      });
      throw invalid;
    }

    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.');

    user.lastLoginAt = new Date();
    await user.save();

    await recordActivity({ req, actor: user, action: 'login', summary: 'Signed in with a password.' });

    res.json({ ...issueTokens(user), ...sessionPayload(user) });
  })
);

/** Step 1 of the Microsoft organizational sign-in. */
router.get(
  '/azure-ad/start',
  asyncHandler(async (req, res) => {
    if (!config.auth.azure.enabled) {
      throw ApiError.badRequest('Organizational sign-in is not enabled. Set AUTH_PROVIDER to include azure-ad.');
    }
    res.redirect(buildAuthorizeUrl({ state: req.query.redirect ?? '/' }));
  })
);

/** Step 2 — Microsoft redirects here with a code. */
router.get(
  '/azure-ad/callback',
  asyncHandler(async (req, res) => {
    if (!config.auth.azure.enabled) throw ApiError.badRequest('Organizational sign-in is not enabled.');

    const { code, error, error_description: errorDescription } = req.query;
    if (error) throw ApiError.badRequest(`Microsoft sign-in failed: ${errorDescription ?? error}`);
    if (!code) throw ApiError.badRequest('Microsoft sign-in did not return an authorization code.');

    const claims = await exchangeCodeForProfile(code);
    const email = (claims.preferred_username ?? claims.email ?? '').toLowerCase();
    if (!email) throw ApiError.badRequest('Your Microsoft account did not supply an email address.');

    let user = await User.findOne({ $or: [{ externalId: claims.oid }, { email }] });
    if (!user) {
      const [firstName, ...rest] = (claims.name ?? email).split(' ');
      user = new User({
        firstName,
        lastName: rest.join(' ') || firstName,
        email,
        authProvider: 'azure-ad',
        externalId: claims.oid,
        // Role comes from group mapping in the environment, or DEFAULT_USER_ROLE.
        role: resolveRoleFromClaims(claims),
      });
    } else {
      user.externalId = claims.oid ?? user.externalId;
      user.authProvider = 'azure-ad';
      const mapped = resolveRoleFromClaims(claims, { fallback: null });
      if (mapped) user.role = mapped;
    }

    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated.');

    user.lastLoginAt = new Date();
    await user.save();
    await recordActivity({ req, actor: user, action: 'login', summary: 'Signed in with a Microsoft account.' });

    const tokens = issueTokens(user);
    const redirect = new URL('/auth/callback', config.clientUrl);
    redirect.searchParams.set('access_token', tokens.accessToken);
    redirect.searchParams.set('refresh_token', tokens.refreshToken);
    res.redirect(redirect.toString());
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.body?.refreshToken ?? req.cookies?.lams_refresh_token;
    if (!token) throw ApiError.unauthorized('No refresh token supplied.');

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw ApiError.unauthorized('Your session has expired. Please sign in again.');
    }

    const user = await User.findById(payload.sub).populate('organization', 'name code type');
    if (!user || !user.isActive) throw ApiError.unauthorized('This account is no longer active.');

    res.json({ ...issueTokens(user), ...sessionPayload(user) });
  })
);

/** The client asks for this on every load to re-derive permissions from the server. */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(sessionPayload(req.user));
  })
);

router.post(
  '/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    await recordActivity({ req, action: 'logout', summary: 'Signed out.' });
    res.clearCookie('lams_access_token');
    res.clearCookie('lams_refresh_token');
    res.status(204).end();
  })
);

export default router;
