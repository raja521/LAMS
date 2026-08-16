import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config/env.js';
import { User } from '../models/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { authenticate } from '../middleware/auth.js';
import { issueTokens, verifyRefreshToken } from '../services/tokenService.js';
import { recordActivity } from '../services/activityService.js';
import { capabilitiesFor, ROLES } from '../config/permissions.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait and try again.' } },
});

/* Signing up is cheaper to abuse than signing in, so it gets a tighter limit. */
const registerLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.registerMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many accounts created. Please wait and try again.' } },
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
      lastLoginAt: user.lastLoginAt,
    },
    capabilities: capabilitiesFor(user),
  };
}

/**
 * What the sign-in screen needs to render itself. Everything here comes from the
 * environment — the client never hard-codes anything about how sign-in works.
 */
router.get('/config', (_req, res) => {
  res.json({
    appName: 'LAMS',
    registrationOpen: config.auth.allowRegistration,
    minPasswordLength: config.auth.minPasswordLength,
  });
});

/**
 * Create an account.
 *
 * Anyone may sign up, but a new account always lands on the lowest role and an
 * administrator promotes it afterwards. The role is fixed here in code rather
 * than read from DEFAULT_USER_ROLE on purpose: that setting is what an admin
 * gets when creating a user, and if it were ever set to `admin` this form would
 * become a way to grant yourself the run of the system. Anything the caller
 * sends for `role` or `modules` is ignored for the same reason.
 */
router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req, res) => {
    if (!config.auth.allowRegistration) {
      throw ApiError.forbidden('Creating your own account is turned off. Ask an administrator to set one up.');
    }

    const { firstName, lastName, email, password } = req.body ?? {};

    if (!firstName?.trim() || !lastName?.trim()) {
      throw ApiError.badRequest('Enter your first and last name.');
    }
    if (!email?.trim() || !password) {
      throw ApiError.badRequest('Enter both an email address and a password.');
    }
    if (String(password).length < config.auth.minPasswordLength) {
      throw ApiError.badRequest(
        `Choose a password of at least ${config.auth.minPasswordLength} characters.`
      );
    }

    const cleanEmail = String(email).toLowerCase().trim();

    // Checked up front for a clear message; the unique index below is what
    // actually guarantees it when two people sign up at the same instant.
    if (await User.exists({ email: cleanEmail })) {
      throw ApiError.conflict('That email address cannot be used. Try signing in instead.');
    }

    const user = new User({
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: cleanEmail,
      role: ROLES.READ_ONLY,
      modules: [],
    });
    await user.setPassword(String(password));

    try {
      await user.save();
    } catch (error) {
      if (error?.code === 11000) {
        throw ApiError.conflict('That email address cannot be used. Try signing in instead.');
      }
      throw error;
    }

    await recordActivity({
      req,
      actor: user,
      action: 'register',
      summary: 'Created an account.',
    });

    res.status(201).json({ ...issueTokens(user), ...sessionPayload(user) });
  })
);

/** Sign in with an email address and password. */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) throw ApiError.badRequest('Enter both your email address and password.');

    const user = await User.findOne({ email: String(email).toLowerCase().trim() })
      .select('+passwordHash')
      .populate('organization', 'name code type');

    // One message for both cases, so the response never confirms an address exists.
    const invalid = ApiError.unauthorized('That email address or password is not correct.');

    if (!user) {
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
