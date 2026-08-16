import jwt from 'jsonwebtoken';
import config from '../config/env.js';

const { jwt: jwtConfig } = config.auth;

const baseOptions = {
  issuer: jwtConfig.issuer,
  audience: jwtConfig.audience,
};

/**
 * The token carries the role only as a hint for the UI. Every request re-reads
 * the user from the database before authorising, so a role change or a
 * deactivation takes effect immediately rather than at token expiry.
 */
export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), email: user.email, role: user.role, typ: 'access' },
    jwtConfig.secret,
    { ...baseOptions, expiresIn: jwtConfig.expiresIn }
  );
}

export function signRefreshToken(user) {
  return jwt.sign({ sub: String(user._id), typ: 'refresh' }, jwtConfig.refreshSecret, {
    ...baseOptions,
    expiresIn: jwtConfig.refreshExpiresIn,
  });
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, jwtConfig.secret, baseOptions);
  if (payload.typ !== 'access') throw new jwt.JsonWebTokenError('Not an access token.');
  return payload;
}

export function verifyRefreshToken(token) {
  const payload = jwt.verify(token, jwtConfig.refreshSecret, baseOptions);
  if (payload.typ !== 'refresh') throw new jwt.JsonWebTokenError('Not a refresh token.');
  return payload;
}

export function issueTokens(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
    expiresIn: jwtConfig.expiresIn,
  };
}
