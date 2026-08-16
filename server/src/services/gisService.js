/**
 * Where parcel geometry comes from.
 *
 * Two sources behind one interface:
 *   sample  a local GeoJSON file, used before the District's service is wired up
 *   arcgis  the live ArcGIS feature service, through the ArcGIS connector
 *
 * The ArcGIS connector wins whenever it is switched on and configured, so going
 * live is a change to CONNECTOR_ARCGIS_ENABLED and the ARCGIS_* settings — the
 * map component and every caller below stay exactly as they are.
 *
 * Reads only. Label write-back lives on the connector and is separately gated;
 * nothing in this file can alter a property boundary.
 */
import fs from 'node:fs/promises';
import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import arcgisConnector from '../connectors/arcgis.connector.js';
import { isUsable } from '../connectors/index.js';

const EMPTY = Object.freeze({ type: 'FeatureCollection', features: [] });

let sampleCache = null;

async function loadSample() {
  if (sampleCache && config.isProduction) return sampleCache;
  try {
    const contents = await fs.readFile(config.gis.samplePath, 'utf8');
    sampleCache = JSON.parse(contents);
    return sampleCache;
  } catch (error) {
    logger.warn(`Could not read sample GIS data at ${config.gis.samplePath}: ${error.message}`);
    return EMPTY;
  }
}

/** Which source is actually in play right now. */
export function activeProvider() {
  if (isUsable('arcgis')) return 'arcgis';
  if (config.connectors.arcgis.enabled) return 'arcgis-unconfigured';
  return config.gis.provider;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

const sources = {
  async sample({ parcelIds } = {}) {
    const collection = await loadSample();
    if (!parcelIds?.length) return collection;

    const wanted = new Set(parcelIds.map((id) => String(id).toUpperCase()));
    return {
      type: 'FeatureCollection',
      features: collection.features.filter((feature) =>
        wanted.has(String(feature.properties?.parcelId ?? feature.id ?? '').toUpperCase())
      ),
    };
  },

  async arcgis(options) {
    // Normalises ArcGIS attribute names onto the shape the rest of LAMS expects.
    const collection = await arcgisConnector.fetchFeatures(options);
    const idField = config.connectors.arcgis.parcelIdField;

    return {
      ...collection,
      features: (collection.features ?? []).map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          parcelId: feature.properties?.parcelId ?? feature.properties?.[idField] ?? null,
        },
      })),
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Public interface                                                           */
/* -------------------------------------------------------------------------- */

export async function fetchFeatures(options = {}) {
  if (!config.features.map) return EMPTY;

  const provider = activeProvider();

  // Switched on but half-configured: say so rather than quietly serving sample
  // data that would look like the District's real holdings.
  if (provider === 'arcgis-unconfigured') {
    const missing = arcgisConnector.missingSettings().map((entry) => entry.env);
    throw ApiError.badRequest(
      `The ArcGIS connection is switched on but not configured. Missing: ${missing.join(', ')}.`,
      { code: 'CONNECTOR_NOT_CONFIGURED', details: { connector: 'arcgis', missing } }
    );
  }

  const source = sources[provider];
  if (!source) throw new Error(`Unsupported GIS source "${provider}".`);
  return source(options);
}

/** The shape for one parcel, or null when the service has nothing for it. */
export async function fetchParcelGeometry(parcelId) {
  const collection = await fetchFeatures({ parcelIds: [parcelId] });
  return collection.features?.[0] ?? null;
}

/** Rough centre of a feature, used to drop a marker without a geometry library. */
export function centroidOf(feature) {
  if (!feature?.geometry) return null;

  const coordinates = [];
  const walk = (node) => {
    if (typeof node?.[0] === 'number' && typeof node?.[1] === 'number') {
      coordinates.push(node);
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
  };
  walk(feature.geometry.coordinates);

  if (coordinates.length === 0) return null;
  const sum = coordinates.reduce((acc, [lng, lat]) => ({ lng: acc.lng + lng, lat: acc.lat + lat }), { lng: 0, lat: 0 });
  return { lng: sum.lng / coordinates.length, lat: sum.lat / coordinates.length };
}

/**
 * Write LAMS labels back onto the District's features.
 *
 * Delegates to the connector, which strips geometry from every edit — LAMS
 * cannot change a boundary through this path or any other.
 */
export async function writeParcelLabel(parcel) {
  if (!isUsable('arcgis')) {
    throw ApiError.badRequest('Label write-back needs the ArcGIS connection switched on and configured.');
  }

  const lookupId = parcel.geometry?.ref || parcel.parcelId;
  const objectId = await arcgisConnector.findObjectId(lookupId);
  if (objectId === null) {
    throw ApiError.notFound(`ArcGIS has no feature with ${config.connectors.arcgis.parcelIdField} = "${lookupId}".`);
  }

  return arcgisConnector.writeLabels([
    {
      objectId,
      attributes: {
        LAMS_LABEL: parcel.name,
        LAMS_PARCEL_ID: parcel.parcelId,
        LAMS_PROGRAM: parcel.programName ?? '',
        LAMS_STATUS: parcel.status,
      },
    },
  ]);
}

/**
 * What the browser needs to know about the current map setup.
 *
 * `live` means geometry is actually coming from the District's service right
 * now — not merely that it has been configured. A service that is configured
 * but failed its last check reports as not live, with the reason, so the map
 * never claims to be showing the District's data when it is not.
 */
export function gisStatus() {
  const provider = activeProvider();
  const configured = provider === 'arcgis';
  const lastCheck = arcgisConnector.lastCheck;
  const reachable = configured && lastCheck?.ok !== false;

  let message;
  if (provider === 'arcgis-unconfigured') {
    message = 'The ArcGIS connection is switched on but not fully configured — see Administration → Integrations.';
  } else if (configured && !reachable) {
    message = `The ArcGIS service could not be reached: ${lastCheck?.message ?? 'unknown error'}`;
  } else if (configured && !lastCheck) {
    message = 'Configured for the District’s ArcGIS service. No connection check has been run yet.';
  } else if (configured) {
    message = 'Connected to the District’s ArcGIS service.';
  } else {
    message = 'Using sample map data. Switch CONNECTOR_ARCGIS_ENABLED on to use the District’s service.';
  }

  return {
    provider: provider === 'arcgis-unconfigured' ? 'arcgis' : provider,
    enabled: config.features.map,
    live: reachable,
    configured: provider !== 'arcgis-unconfigured',
    checked: Boolean(lastCheck),
    checkedAt: lastCheck?.at ?? null,
    parcelIdField: configured ? config.connectors.arcgis.parcelIdField : 'parcelId',
    labelWriteBack: reachable && config.connectors.arcgis.allowAttributeWrite,
    message,
  };
}
