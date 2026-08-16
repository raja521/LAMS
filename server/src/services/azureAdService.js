/**
 * Microsoft Entra ID (Azure AD) organizational sign-in.
 *
 * Every value used here — tenant, client id, secret, redirect URI, authority and
 * the group-to-role mapping — comes from the environment. There is no account
 * name, tenant or secret written anywhere in this file.
 */
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { ROLES } from '../config/permissions.js';

const azure = config.auth.azure;

function endpoints() {
  const base = `${azure.authority.replace(/\/$/, '')}/${azure.tenantId}/oauth2/v2.0`;
  return { authorize: `${base}/authorize`, token: `${base}/token` };
}

export function buildAuthorizeUrl({ state = '/' } = {}) {
  const url = new URL(endpoints().authorize);
  url.searchParams.set('client_id', azure.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', azure.redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', azure.scopes.join(' '));
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Exchange the authorization code for tokens and return the id_token claims.
 *
 * This is a back-channel call: the request goes directly to Microsoft over TLS
 * and is authenticated with the client secret, so the id_token arrives from a
 * trusted source rather than via the browser. Add JWKS signature verification
 * before accepting id_tokens from any other path.
 */
export async function exchangeCodeForProfile(code) {
  const body = new URLSearchParams({
    client_id: azure.clientId,
    client_secret: azure.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: azure.redirectUri,
    scope: azure.scopes.join(' '),
  });

  const response = await fetch(endpoints().token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw ApiError.unauthorized(
      `Microsoft rejected the sign-in: ${payload.error_description ?? payload.error ?? response.statusText}`
    );
  }
  if (!payload.id_token) throw ApiError.unauthorized('Microsoft did not return an identity token.');

  return decodeJwtClaims(payload.id_token);
}

function decodeJwtClaims(token) {
  const [, payload] = token.split('.');
  if (!payload) throw ApiError.unauthorized('Malformed identity token.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/**
 * Translate Entra group membership into one of the three LAMS roles, using the
 * group ids configured in the environment. Falls back to DEFAULT_USER_ROLE.
 */
export function resolveRoleFromClaims(claims, { fallback = config.auth.defaultRole } = {}) {
  const groups = Array.isArray(claims.groups) ? claims.groups : [];
  const map = azure.groupRoleMap;

  for (const role of [ROLES.ADMIN, ROLES.MODULE_EDITOR, ROLES.READ_ONLY]) {
    const groupId = map[role];
    if (groupId && groups.includes(groupId)) return role;
  }
  return fallback;
}
