/**
 * The three permission levels the District asked for — and nothing more
 * complicated than that.
 *
 *   read_only     can look but not touch, anywhere in the system
 *   module_editor can edit within the modules assigned to them, read everywhere
 *   admin         can do anything, including managing users
 *
 * This file is the single source of truth. The server enforces it (authoritative)
 * and the client mirrors the same shape to decide what to grey out.
 */
import { ROLES } from './env.js';

export { ROLES };

export const ROLE_LABELS = Object.freeze({
  [ROLES.READ_ONLY]: 'Read Only',
  [ROLES.MODULE_EDITOR]: 'Module Editor',
  [ROLES.ADMIN]: 'Administrator',
});

/** The three functional areas that arrive in the next step, plus system admin. */
export const MODULES = Object.freeze({
  ACQUISITION: 'acquisition',
  MANAGEMENT: 'management',
  DISPOSITION: 'disposition',
  ADMIN: 'admin',
});

export const MODULE_VALUES = Object.freeze(Object.values(MODULES));

/** Assignable to a Module Editor — 'admin' is reserved for Administrators. */
export const ASSIGNABLE_MODULES = Object.freeze([
  MODULES.ACQUISITION,
  MODULES.MANAGEMENT,
  MODULES.DISPOSITION,
]);

export const ACTIONS = Object.freeze({
  READ: 'read',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  MANAGE_USERS: 'manage_users',
});

const WRITE_ACTIONS = new Set([ACTIONS.CREATE, ACTIONS.UPDATE, ACTIONS.DELETE]);

/**
 * Authoritative check.
 *
 * @param {{role: string, modules?: string[], isActive?: boolean}} user
 * @param {string} action  one of ACTIONS
 * @param {string} [module] one of MODULES; required for write actions
 * @returns {boolean}
 */
export function can(user, action, module) {
  if (!user || !user.role) return false;
  if (user.isActive === false) return false;

  switch (user.role) {
    case ROLES.ADMIN:
      return true;

    case ROLES.MODULE_EDITOR: {
      if (action === ACTIONS.MANAGE_USERS) return false;
      if (action === ACTIONS.READ) return module !== MODULES.ADMIN;
      if (!WRITE_ACTIONS.has(action)) return false;
      if (!module || module === MODULES.ADMIN) return false;
      return Array.isArray(user.modules) && user.modules.includes(module);
    }

    case ROLES.READ_ONLY:
      // Look, don't touch.
      return action === ACTIONS.READ && module !== MODULES.ADMIN;

    default:
      return false;
  }
}

/** Convenience wrapper used by route guards for the three write verbs. */
export function canWrite(user, module) {
  return (
    can(user, ACTIONS.CREATE, module) ||
    can(user, ACTIONS.UPDATE, module) ||
    can(user, ACTIONS.DELETE, module)
  );
}

/** Map an HTTP method onto the action it represents. */
export function actionForMethod(method) {
  switch (String(method).toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return ACTIONS.READ;
    case 'POST':
      return ACTIONS.CREATE;
    case 'PUT':
    case 'PATCH':
      return ACTIONS.UPDATE;
    case 'DELETE':
      return ACTIONS.DELETE;
    default:
      return ACTIONS.READ;
  }
}

/** Everything the browser needs to grey out controls, derived from the same rules. */
export function capabilitiesFor(user) {
  const modules = {};
  for (const module of MODULE_VALUES) {
    modules[module] = {
      read: can(user, ACTIONS.READ, module),
      create: can(user, ACTIONS.CREATE, module),
      update: can(user, ACTIONS.UPDATE, module),
      delete: can(user, ACTIONS.DELETE, module),
    };
  }
  return {
    role: user?.role ?? null,
    roleLabel: user?.role ? ROLE_LABELS[user.role] : null,
    canManageUsers: can(user, ACTIONS.MANAGE_USERS),
    modules,
  };
}
