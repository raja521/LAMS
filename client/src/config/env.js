/**
 * Browser-side environment contract.
 *
 * Vite only inlines names beginning with VITE_. Only the API address is
 * required — without it the app has nothing to talk to. Everything else falls
 * back to a working default so a fresh clone runs straight away.
 */
const raw = import.meta.env;

function required(name) {
  const value = raw[name];
  if (value === undefined || String(value).trim() === '') {
    throw new Error(
      `LAMS cannot start: ${name} is not set.\n` +
        'Copy .env.example to .env inside the client folder and set it.'
    );
  }
  return String(value).trim();
}

function optional(name, fallback) {
  const value = raw[name];
  return value === undefined || String(value).trim() === '' ? fallback : String(value).trim();
}

function list(name, fallback) {
  return optional(name, fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(name, fallback) {
  const value = raw[name];
  if (value === undefined || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

/** "44.9778,-93.2650" → [44.9778, -93.2650] */
function latLng(name, fallback) {
  const parts = optional(name, fallback).split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    throw new Error(`LAMS cannot start: ${name} must be "latitude,longitude" — received "${raw[name]}".`);
  }
  return parts;
}

const mapProvider = optional('VITE_MAP_PROVIDER', 'sample');

const env = Object.freeze({
  appName: optional('VITE_APP_NAME', 'LAMS'),
  apiBaseUrl: required('VITE_API_BASE_URL').replace(/\/$/, ''),
  /** Display-only, shown in the header and on the sign-in screen. */
  orgName: optional('VITE_ORG_NAME', ''),

  /**
   * Map settings. Nothing about the basemap, the layers or the service URL is
   * written into the map component — swapping in the District's own ArcGIS
   * service is a change to these values.
   */
  map: Object.freeze({
    provider: mapProvider,
    basemapUrl: optional('VITE_MAP_BASEMAP_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    basemapAttribution: optional('VITE_MAP_BASEMAP_ATTRIBUTION', '© OpenStreetMap contributors'),
    defaultCenter: latLng('VITE_MAP_DEFAULT_CENTER', '44.9778,-93.2650'),
    defaultZoom: Number(optional('VITE_MAP_DEFAULT_ZOOM', '11')),
    maxZoom: Number(optional('VITE_MAP_MAX_ZOOM', '19')),
    layers: list('VITE_MAP_LAYERS', 'parcels,boundaries'),
    // Required in practice only when the provider is arcgis; the server enforces
    // its own equivalents, so a blank value here is not fatal for sample data.
    apiKey: optional('VITE_MAP_API_KEY', ''),
    featureServiceUrl: optional('VITE_MAP_FEATURE_SERVICE_URL', ''),
  }),

  features: Object.freeze({
    map: bool('VITE_FEATURE_MAP', true),
    documentGeneration: bool('VITE_FEATURE_DOCUMENT_GENERATION', true),
    timber: bool('VITE_FEATURE_TIMBER', true),
  }),

  isDev: raw.DEV,
});

if (env.map.provider === 'arcgis' && !env.map.featureServiceUrl) {
  throw new Error(
    'LAMS cannot start: VITE_MAP_PROVIDER is "arcgis" but VITE_MAP_FEATURE_SERVICE_URL is not set.'
  );
}

export default env;
