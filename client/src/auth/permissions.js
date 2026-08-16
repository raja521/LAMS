/**
 * A mirror of the server's permission rules, used only to decide what to grey
 * out. The server is the authority — every one of these checks is repeated there
 * before anything is written, so editing this file changes the UI and nothing else.
 */
export const ROLES = Object.freeze({
  READ_ONLY: 'read_only',
  MODULE_EDITOR: 'module_editor',
  ADMIN: 'admin',
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.READ_ONLY]: 'Read Only',
  [ROLES.MODULE_EDITOR]: 'Module Editor',
  [ROLES.ADMIN]: 'Administrator',
});

export const MODULES = Object.freeze({
  ACQUISITION: 'acquisition',
  MANAGEMENT: 'management',
  DISPOSITION: 'disposition',
  ADMIN: 'admin',
});

/**
 * Read a capability out of the map the server sent with the session.
 * Defaults to `false` whenever the answer is unknown.
 */
export function can(capabilities, action, module) {
  if (!capabilities) return false;
  if (action === 'manage_users') return Boolean(capabilities.canManageUsers);
  return Boolean(capabilities.modules?.[module]?.[action]);
}

export function canEditAnything(capabilities) {
  if (!capabilities?.modules) return false;
  return Object.values(capabilities.modules).some((m) => m.create || m.update || m.delete);
}
