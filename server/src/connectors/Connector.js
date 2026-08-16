/**
 * Base class for every connection to one of the District's other systems.
 *
 * Three rules hold for all of them:
 *   1. A connector is off unless its CONNECTOR_*_ENABLED flag says otherwise.
 *      Nothing in the application may assume a connector is available.
 *   2. Calling into a connector that is off, or missing settings, raises a clear
 *      error naming the system and what is missing — it never returns empty data
 *      that would read as "there is nothing there".
 *   3. Every connector reports its own state so the admin screen can say plainly
 *      whether a connection is on, configured, reachable, or not ready yet.
 */
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';

export const CONNECTOR_STATE = Object.freeze({
  /** Switched off in configuration. */
  DISABLED: 'disabled',
  /** Switched on, but required settings are missing. */
  NOT_CONFIGURED: 'not_configured',
  /** Switched on and configured; a live check has not been run yet. */
  CONFIGURED: 'configured',
  /** A live check succeeded. */
  AVAILABLE: 'available',
  /** A live check failed — the reason is carried alongside. */
  UNAVAILABLE: 'unavailable',
});

export default class Connector {
  /**
   * @param {object} definition
   * @param {string} definition.id            stable key, e.g. "arcgis"
   * @param {string} definition.name          system name shown to staff
   * @param {string} definition.purpose       one line on what it is for
   * @param {'read'|'write'|'read-write'|'one-time'} definition.direction
   * @param {() => object} definition.settings  reads this connector's config slice
   * @param {string[]} definition.requiredSettings  env names that must be present
   */
  constructor(definition) {
    Object.assign(this, definition);
    this.lastCheck = null;
    this.lastRun = null;
  }

  get config() {
    return this.settings();
  }

  get enabled() {
    return Boolean(this.config?.enabled);
  }

  /** Env names that are switched on but still blank. */
  missingSettings() {
    if (!this.enabled) return [];
    const config = this.config;
    return (this.requiredSettings ?? []).filter((entry) => {
      const value = config[entry.key];
      return value === undefined || value === null || value === '';
    });
  }

  /**
   * Guard placed at the top of every operation. Throws rather than returning
   * nothing, so a switched-off system can never be mistaken for empty data.
   */
  assertUsable() {
    if (!this.enabled) {
      throw ApiError.badRequest(
        `The ${this.name} connection is switched off. Set CONNECTOR_${this.id.toUpperCase()}_ENABLED=true to use it.`,
        { code: 'CONNECTOR_DISABLED', details: { connector: this.id } }
      );
    }
    const missing = this.missingSettings();
    if (missing.length) {
      throw ApiError.badRequest(
        `The ${this.name} connection is switched on but not configured. Missing: ${missing
          .map((entry) => entry.env)
          .join(', ')}.`,
        { code: 'CONNECTOR_NOT_CONFIGURED', details: { connector: this.id, missing: missing.map((m) => m.env) } }
      );
    }
  }

  /** Subclasses override with a real reachability check. */
  async checkConnection() {
    return { ok: true, message: 'No live check is implemented for this connector.' };
  }

  /** Run the live check, remembering the outcome for the admin screen. */
  async test() {
    if (!this.enabled) {
      return { state: CONNECTOR_STATE.DISABLED, message: `${this.name} is switched off.` };
    }
    const missing = this.missingSettings();
    if (missing.length) {
      return {
        state: CONNECTOR_STATE.NOT_CONFIGURED,
        message: `Switched on but missing: ${missing.map((entry) => entry.env).join(', ')}.`,
        missing: missing.map((entry) => ({ env: entry.env, description: entry.description })),
      };
    }

    try {
      const result = await this.checkConnection();
      this.lastCheck = {
        at: new Date(),
        ok: result.ok !== false,
        message: result.message,
        details: result.details,
      };
      return {
        state: result.ok === false ? CONNECTOR_STATE.UNAVAILABLE : CONNECTOR_STATE.AVAILABLE,
        message: result.message,
        details: result.details,
      };
    } catch (error) {
      logger.warn(`Connector ${this.id} check failed: ${error.message}`);
      this.lastCheck = { at: new Date(), ok: false, message: error.message };
      return { state: CONNECTOR_STATE.UNAVAILABLE, message: error.message };
    }
  }

  /** Cheap description of the connector without making a network call. */
  describe() {
    const missing = this.missingSettings();
    let state = CONNECTOR_STATE.DISABLED;
    let message = `${this.name} is switched off.`;

    if (this.enabled && missing.length) {
      state = CONNECTOR_STATE.NOT_CONFIGURED;
      message = `Switched on but not configured yet — missing ${missing.map((e) => e.env).join(', ')}.`;
    } else if (this.enabled) {
      state = this.lastCheck
        ? this.lastCheck.ok
          ? CONNECTOR_STATE.AVAILABLE
          : CONNECTOR_STATE.UNAVAILABLE
        : CONNECTOR_STATE.CONFIGURED;
      message = this.lastCheck?.message ?? 'Configured. No live check has been run yet.';
    }

    return {
      id: this.id,
      name: this.name,
      purpose: this.purpose,
      direction: this.direction,
      notes: this.notes ?? null,
      enabled: this.enabled,
      state,
      message,
      missing: missing.map((entry) => ({ env: entry.env, description: entry.description })),
      requiredSettings: (this.requiredSettings ?? []).map((entry) => entry.env),
      lastCheck: this.lastCheck,
      lastRun: this.lastRun,
    };
  }

  /** Fetch helper with a timeout, used by the HTTP-based connectors. */
  async request(url, { timeoutMs, ...options } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.config.timeoutMs ?? 15000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError(504, `${this.name} did not respond within the configured timeout.`);
      }
      throw new ApiError(502, `${this.name} could not be reached: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
