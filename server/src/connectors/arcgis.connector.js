/**
 * ArcGIS — the District's mapping system.
 *
 * LAMS reads location information and writes labels and associations only. It is
 * never allowed to change the shape or boundary of a property; the District
 * manages geometry itself.
 *
 * That guard is enforced here in code, not in configuration:
 *   - the write path strips `geometry` from every edit before it is sent
 *   - only the fields named in ARCGIS_WRITABLE_FIELDS may be written at all
 *   - adds and deletes are not implemented; updates to existing features only
 * There is no setting that turns any of this off.
 */
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import Connector, { CONNECTOR_STATE } from './Connector.js';

/** Attributes LAMS will never send, whatever the configuration says. */
const NEVER_WRITABLE = new Set(['geometry', 'shape', 'shape_area', 'shape_length', 'objectid', 'globalid']);

class ArcGisConnector extends Connector {
  constructor() {
    super({
      id: 'arcgis',
      name: 'ArcGIS (mapping)',
      purpose: 'Live parcel geometry for the map, and label write-back.',
      direction: 'read-write',
      notes:
        'Reads geometry. Writes labels and associations only — LAMS cannot change a property boundary, by design.',
      settings: () => config.connectors.arcgis,
      requiredSettings: [
        { key: 'featureServiceUrl', env: 'ARCGIS_FEATURE_SERVICE_URL', description: 'Feature service URL.' },
        { key: 'apiKey', env: 'ARCGIS_API_KEY', description: 'API key or token.' },
        { key: 'parcelIdField', env: 'ARCGIS_PARCEL_ID_FIELD', description: 'Attribute holding the parcel id.' },
      ],
    });
  }

  serviceUrl(suffix) {
    return `${this.config.featureServiceUrl.replace(/\/$/, '')}/${suffix}`;
  }

  /** Confirms the service answers and reports what it is. */
  async checkConnection() {
    this.assertUsable();
    const url = new URL(this.config.featureServiceUrl);
    url.searchParams.set('f', 'json');
    if (this.config.apiKey) url.searchParams.set('token', this.config.apiKey);

    const response = await this.request(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      return { ok: false, message: `Service returned ${response.status} ${response.statusText}.` };
    }

    const payload = await response.json().catch(() => ({}));
    if (payload.error) {
      return { ok: false, message: `ArcGIS reported: ${payload.error.message ?? 'unknown error'}` };
    }

    const fields = (payload.fields ?? []).map((field) => field.name);
    const hasIdField = fields.length === 0 || fields.includes(this.config.parcelIdField);

    return {
      ok: hasIdField,
      message: hasIdField
        ? `Connected to "${payload.name ?? 'feature service'}" (${payload.geometryType ?? 'unknown geometry'}).`
        : `Connected, but the service has no field named "${this.config.parcelIdField}". Check ARCGIS_PARCEL_ID_FIELD.`,
      details: {
        layerName: payload.name,
        geometryType: payload.geometryType,
        fieldCount: fields.length,
        writeCapable: this.config.allowAttributeWrite,
        writableFields: this.config.writableFields,
      },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Read                                                                   */
  /* ---------------------------------------------------------------------- */

  /** GeoJSON FeatureCollection for the given parcel ids, or everything. */
  async fetchFeatures({ parcelIds, bbox } = {}) {
    this.assertUsable();

    const url = new URL(this.serviceUrl('query'));
    url.searchParams.set('f', 'geojson');
    url.searchParams.set('outFields', '*');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('returnGeometry', 'true');

    if (parcelIds?.length) {
      const list = parcelIds.map((id) => `'${String(id).replace(/'/g, "''")}'`).join(',');
      url.searchParams.set('where', `${this.config.parcelIdField} IN (${list})`);
    } else {
      url.searchParams.set('where', '1=1');
    }
    if (bbox) {
      url.searchParams.set('geometry', bbox);
      url.searchParams.set('geometryType', 'esriGeometryEnvelope');
      url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
      url.searchParams.set('inSR', '4326');
    }
    if (this.config.apiKey) url.searchParams.set('token', this.config.apiKey);

    const response = await this.request(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new ApiError(502, `ArcGIS returned ${response.status} ${response.statusText}.`);
    }

    const payload = await response.json();
    if (payload.error) {
      throw new ApiError(502, `ArcGIS reported: ${payload.error.message ?? 'unknown error'}`);
    }

    this.lastRun = { at: new Date(), operation: 'fetchFeatures', count: payload.features?.length ?? 0 };
    return payload;
  }

  /* ---------------------------------------------------------------------- */
  /* Write — labels and associations only                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * Write LAMS labels back onto existing features.
   *
   * @param {Array<{objectId: number, attributes: object}>} edits
   * @returns {Promise<{updated: number, skipped: string[]}>}
   */
  async writeLabels(edits = []) {
    this.assertUsable();

    if (!this.config.allowAttributeWrite) {
      throw ApiError.badRequest(
        'Writing labels to ArcGIS is switched off. Set ARCGIS_ALLOW_ATTRIBUTE_WRITE=true to enable it.',
        { code: 'ARCGIS_WRITE_DISABLED' }
      );
    }
    if (!this.config.writableFields?.length) {
      throw ApiError.badRequest(
        'No ArcGIS fields are writable. List them in ARCGIS_WRITABLE_FIELDS before writing labels.',
        { code: 'ARCGIS_NO_WRITABLE_FIELDS' }
      );
    }

    const allowed = new Set(this.config.writableFields.map((field) => field.toLowerCase()));
    const skipped = new Set();

    const features = edits.map((edit) => {
      if (edit.objectId === undefined || edit.objectId === null) {
        throw ApiError.badRequest('Every ArcGIS label edit must name the objectId of an existing feature.');
      }

      const attributes = { OBJECTID: edit.objectId };
      for (const [key, value] of Object.entries(edit.attributes ?? {})) {
        const lower = key.toLowerCase();
        // Geometry and identity fields can never be written, whatever is configured.
        if (NEVER_WRITABLE.has(lower) || !allowed.has(lower)) {
          skipped.add(key);
          continue;
        }
        attributes[key] = value;
      }

      // Deliberately no `geometry` key: LAMS does not change boundaries.
      return { attributes };
    });

    if (skipped.size) {
      logger.warn(`ArcGIS write: ignored non-writable field(s) ${[...skipped].join(', ')}.`);
    }

    const body = new URLSearchParams({ f: 'json', updates: JSON.stringify(features) });
    if (this.config.apiKey) body.set('token', this.config.apiKey);

    const response = await this.request(this.serviceUrl('applyEdits'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      throw new ApiError(502, `ArcGIS rejected the label update: ${payload.error?.message ?? response.statusText}`);
    }

    const results = payload.updateResults ?? [];
    const failures = results.filter((result) => result.success === false);
    if (failures.length) {
      throw new ApiError(502, `ArcGIS rejected ${failures.length} of ${results.length} label updates.`);
    }

    this.lastRun = { at: new Date(), operation: 'writeLabels', count: results.length };
    return { updated: results.length, skipped: [...skipped] };
  }

  /** Resolve a parcel id to its ArcGIS OBJECTID, needed before a label write. */
  async findObjectId(parcelId) {
    this.assertUsable();
    const url = new URL(this.serviceUrl('query'));
    url.searchParams.set('f', 'json');
    url.searchParams.set('where', `${this.config.parcelIdField} = '${String(parcelId).replace(/'/g, "''")}'`);
    url.searchParams.set('outFields', 'OBJECTID');
    url.searchParams.set('returnGeometry', 'false');
    if (this.config.apiKey) url.searchParams.set('token', this.config.apiKey);

    const response = await this.request(url);
    const payload = await response.json().catch(() => ({}));
    return payload.features?.[0]?.attributes?.OBJECTID ?? null;
  }
}

export default new ArcGisConnector();
export { CONNECTOR_STATE, NEVER_WRITABLE };
