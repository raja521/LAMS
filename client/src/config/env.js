/**
 * Browser-side environment contract.
 *
 * Vite only inlines names beginning with VITE_. A missing required value throws
 * immediately with the variable named, rather than silently rendering a broken
 * screen. Nothing here has a hard-coded fallback.
 */
const raw = import.meta.env;

function required(name) {
  const value = raw[name];
  if (value === undefined || String(value).trim() === '') {
    throw new Error(
      `LAMS cannot start: ${name} is not set.\n` +
        'Copy .env.example to .env at the repository root and set it. ' +
        'No default is applied for this setting by design.'
    );
  }
  return String(value).trim();
}

function optional(name, fallback) {
  const value = raw[name];
  return value === undefined || String(value).trim() === '' ? fallback : String(value).trim();
}

function requiredList(name) {
  return required(name)
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
function requiredLatLng(name) {
  const parts = required(name).split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2 || parts.some(Number.isNaN)) {
    throw new Error(`LAMS cannot start: ${name} must be "latitude,longitude" — received "${raw[name]}".`);
  }
  return parts;
}

const mapProvider = required('VITE_MAP_PROVIDER');

const env = Object.freeze({
  appName: required('VITE_APP_NAME'),
  apiBaseUrl: required('VITE_API_BASE_URL').replace(/\/$/, ''),
  /** Display-only. The server decides which providers are actually enabled. */
  orgName: optional('VITE_ORG_NAME', ''),
  authProvider: optional('VITE_AUTH_PROVIDER', 'local'),
  azureClientId: optional('VITE_AZURE_AD_CLIENT_ID', ''),
  azureTenantId: optional('VITE_AZURE_AD_TENANT_ID', ''),

  /**
   * Map settings. Nothing about the basemap, the layers or the service URL is
   * written into the map component — swapping in the District's own ArcGIS
   * service is a change to these values.
   */
  map: Object.freeze({
    provider: mapProvider,
    basemapUrl: required('VITE_MAP_BASEMAP_URL'),
    basemapAttribution: required('VITE_MAP_BASEMAP_ATTRIBUTION'),
    defaultCenter: requiredLatLng('VITE_MAP_DEFAULT_CENTER'),
    defaultZoom: Number(required('VITE_MAP_DEFAULT_ZOOM')),
    maxZoom: Number(required('VITE_MAP_MAX_ZOOM')),
    layers: requiredList('VITE_MAP_LAYERS'),
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
