/**
 * Environment contract for the LAMS API.
 *
 * Ground rule: nothing in this application is configured in code — every value
 * below comes from the environment. Only the three settings that genuinely
 * cannot be guessed are required (the database URL and the two signing keys);
 * everything else carries a working default so a fresh clone runs immediately.
 *
 * A default is never a silent substitution: each one applied is recorded and
 * reported at boot.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The server folder — this project's root. Every relative path resolves here. */
export const SERVER_ROOT = path.resolve(__dirname, '../..');

/** Load server/.env once. Real process env always wins over the file. */
export function loadDotEnv() {
  const envPath = path.join(SERVER_ROOT, '.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
  return envPath;
}

export const ROLES = Object.freeze({
  READ_ONLY: 'read_only',
  MODULE_EDITOR: 'module_editor',
  ADMIN: 'admin',
});

const ROLE_VALUES = Object.values(ROLES);

class EnvValidationError extends Error {
  constructor(problems) {
    const lines = problems.map((p) => `  • ${p.name} — ${p.message}`);
    super(
      'LAMS cannot start: the environment is incomplete.\n\n' +
        `${problems.length} problem${problems.length === 1 ? '' : 's'} found in your environment:\n` +
        `${lines.join('\n')}\n\n` +
        'Fix: copy server/.env.example to server/.env and set the values listed above.\n' +
        '     cd server && cp .env.example .env\n'
    );
    this.name = 'EnvValidationError';
    this.problems = problems;
  }
}

/* -------------------------------------------------------------------------- */
/* Value readers                                                              */
/* -------------------------------------------------------------------------- */

const problems = [];
const defaulted = [];

function fail(name, message) {
  problems.push({ name, message });
  return undefined;
}

function raw(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A required string. Missing => recorded problem, never a default. */
function required(name, { description, validate, allowed } = {}) {
  const value = raw(name);
  if (value === undefined) {
    return fail(name, `is required but not set. ${description ?? ''}`.trim());
  }
  if (allowed && !allowed.includes(value)) {
    return fail(name, `must be one of: ${allowed.join(', ')} (received "${value}").`);
  }
  if (validate) {
    const result = validate(value);
    if (result !== true) return fail(name, result);
  }
  return value;
}

/** Required only when `condition` is true — e.g. S3 settings when S3 is chosen. */
function requiredWhen(condition, name, opts = {}) {
  if (!condition) return raw(name);
  return required(name, opts);
}

/** A setting with a documented default. Applying the default is recorded. */
function optional(name, fallback, { allowed, parse = (v) => v } = {}) {
  const value = raw(name);
  if (value === undefined) {
    defaulted.push(`${name}=${fallback}`);
    return parse(fallback);
  }
  if (allowed && !allowed.includes(value)) {
    fail(name, `must be one of: ${allowed.join(', ')} (received "${value}").`);
    return parse(fallback);
  }
  return parse(value);
}

function optionalInt(name, fallback, { min, max } = {}) {
  const value = optional(name, fallback, { parse: Number });
  if (!Number.isInteger(value)) return fail(name, `must be a whole number (received "${raw(name)}").`);
  if (min !== undefined && value < min) return fail(name, `must be at least ${min} (received ${value}).`);
  if (max !== undefined && value > max) return fail(name, `must be at most ${max} (received ${value}).`);
  return value;
}

const TRUTHY = ['1', 'true', 'yes', 'on'];

function optionalBool(name, fallback) {
  const value = raw(name);
  if (value === undefined) {
    defaulted.push(`${name}=${fallback}`);
    return fallback;
  }
  return TRUTHY.includes(value.toLowerCase());
}

function asList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Every path setting resolves against SERVER_ROOT, so behaviour never depends on
 * which directory node happened to be launched from.
 */
function resolvePath(value) {
  return value ? path.resolve(SERVER_ROOT, value) : undefined;
}

/* -------------------------------------------------------------------------- */
/* The contract                                                               */
/* -------------------------------------------------------------------------- */

function build() {
  problems.length = 0;
  defaulted.length = 0;

  // --- Runtime -------------------------------------------------------------
  const nodeEnv = optional('NODE_ENV', 'development', {
    allowed: ['development', 'test', 'production'],
  });
  const port = optionalInt('PORT', 4000, { min: 1, max: 65535 });
  const apiBaseUrl = optional('API_BASE_URL', `http://localhost:${port}`, {
    parse: (v) => {
      if (!/^https?:\/\//.test(v)) fail('API_BASE_URL', 'must start with http:// or https://.');
      return v.replace(/\/$/, '');
    },
  });

  // --- Database ------------------------------------------------------------
  const mongoUri = required('MONGODB_URI', {
    description: 'MongoDB connection string, e.g. mongodb://127.0.0.1:27017/lams.',
    validate: (v) => (/^mongodb(\+srv)?:\/\//.test(v) ? true : 'must start with mongodb:// or mongodb+srv://.'),
  });
  const mongoDbName = optional('MONGODB_DB_NAME', 'lams');

  // --- Front end -----------------------------------------------------------
  const clientUrl = optional('CLIENT_URL', 'http://localhost:5173', {
    parse: (v) => {
      if (!/^https?:\/\//.test(v)) fail('CLIENT_URL', 'must start with http:// or https://.');
      return v.replace(/\/$/, '');
    },
  });
  /* The client is deployed separately, so its origin must be allowed explicitly. */
  const corsOrigins = asList(optional('CORS_ORIGINS', clientUrl));

  // --- Session security ----------------------------------------------------
  const jwtSecret = required('JWT_SECRET', {
    description: 'Signing key for access tokens. Generate with: openssl rand -base64 48.',
    validate: (v) =>
      v.length >= 32 ? true : `must be at least 32 characters for safety (received ${v.length}).`,
  });
  const jwtRefreshSecret = required('JWT_REFRESH_SECRET', {
    description: 'Signing key for refresh tokens. Must differ from JWT_SECRET.',
    validate: (v) => {
      if (v.length < 32) return `must be at least 32 characters (received ${v.length}).`;
      if (v === process.env.JWT_SECRET) return 'must not be the same value as JWT_SECRET.';
      return true;
    },
  });
  const jwtExpiresIn = optional('JWT_EXPIRES_IN', '1h');
  const jwtRefreshExpiresIn = optional('JWT_REFRESH_EXPIRES_IN', '7d');
  const jwtIssuer = optional('JWT_ISSUER', 'lams-api');
  const jwtAudience = optional('JWT_AUDIENCE', 'lams-client');
  const saltRounds = optionalInt('BCRYPT_SALT_ROUNDS', 12, { min: 4, max: 20 });

  // --- Accounts ------------------------------------------------------------
  /*
   * The role an administrator gets by default when creating a user. Public
   * self-registration deliberately ignores this and always uses read_only —
   * see the register route.
   */
  const defaultRole = optional('DEFAULT_USER_ROLE', ROLES.READ_ONLY, { allowed: ROLE_VALUES });
  const minPasswordLength = optionalInt('MIN_PASSWORD_LENGTH', 12, { min: 8, max: 128 });
  const allowRegistration = optionalBool('ALLOW_REGISTRATION', true);

  // --- File storage --------------------------------------------------------
  const storageProvider = optional('STORAGE_PROVIDER', 'local', { allowed: ['local', 's3'] });
  const isS3 = storageProvider === 's3';
  const storage = {
    provider: storageProvider,
    localPath: resolvePath(optional('STORAGE_LOCAL_PATH', './uploads')),
    s3: {
      bucket: requiredWhen(isS3, 'S3_BUCKET', {
        description: 'Bucket name. Required because STORAGE_PROVIDER=s3.',
      }),
      region: requiredWhen(isS3, 'S3_REGION', {
        description: 'Bucket region. Required because STORAGE_PROVIDER=s3.',
      }),
      accessKeyId: requiredWhen(isS3, 'S3_ACCESS_KEY_ID', {
        description: 'Access key ID. Required because STORAGE_PROVIDER=s3.',
      }),
      secretAccessKey: requiredWhen(isS3, 'S3_SECRET_ACCESS_KEY', {
        description: 'Secret access key. Required because STORAGE_PROVIDER=s3.',
      }),
      endpoint: raw('S3_ENDPOINT') ?? null,
      forcePathStyle: optionalBool('S3_FORCE_PATH_STYLE', false),
    },
    maxUploadBytes: optionalInt('MAX_UPLOAD_BYTES', 26214400, { min: 1 }),
  };

  // --- Document generation -------------------------------------------------
  const templateDir = resolvePath(optional('TEMPLATE_DIR', './templates'));
  const documents = {
    templateDir,
    org: {
      name: optional('DOC_ORG_NAME', 'Example Conservation District'),
      division: optional('DOC_ORG_DIVISION', 'Land Division'),
      address: optional('DOC_ORG_ADDRESS', '100 Main Street'),
    },
    footerText: optional('DOC_FOOTER_TEXT', 'Generated by LAMS'),
    locale: optional('DOC_LOCALE', 'en-US'),
    currency: optional('DOC_CURRENCY', 'USD'),
  };

  // --- Automatic reference numbering ---------------------------------------
  const numbering = {
    prefixes: {
      application: optional('FILE_NUMBER_PREFIX', 'LA'),
      contract: optional('CONTRACT_NUMBER_PREFIX', 'CT'),
      purchaseOrder: optional('PO_NUMBER_PREFIX', 'PO'),
      document: optional('DOCUMENT_NUMBER_PREFIX', 'DOC'),
      disposition: optional('DISPOSITION_NUMBER_PREFIX', 'LD'),
    },
    pad: optionalInt('NUMBER_SEQUENCE_PAD', 5, { min: 1, max: 12 }),
    scope: optional('NUMBER_SEQUENCE_SCOPE', 'yearly', { allowed: ['yearly', 'never'] }),
  };

  // --- Application intake --------------------------------------------------
  const intakeSource = optional('INTAKE_SOURCE', 'simulated', { allowed: ['simulated', 'webhook'] });
  const isWebhookIntake = intakeSource === 'webhook';
  const intake = {
    source: intakeSource,
    webhookSecret: isWebhookIntake
      ? required('INTAKE_WEBHOOK_SECRET', {
          description: 'Shared secret the form system signs intake posts with. Required because INTAKE_SOURCE=webhook.',
          validate: (v) => (v.length >= 8 ? true : 'must be at least 8 characters.'),
        })
      : optional('INTAKE_WEBHOOK_SECRET', 'simulated-intake-not-in-use'),
    formSystemUrl: requiredWhen(isWebhookIntake, 'INTAKE_FORM_SYSTEM_URL', {
      description: 'URL of the online form system. Required because INTAKE_SOURCE=webhook.',
    }),
  };

  // --- Mapping / GIS -------------------------------------------------------
  const gisProvider = optional('GIS_PROVIDER', 'sample', { allowed: ['sample', 'arcgis'] });
  const isArcgis = gisProvider === 'arcgis';
  const gis = {
    provider: gisProvider,
    samplePath: resolvePath(optional('GIS_SAMPLE_DATA_PATH', './sample-data/parcels.geojson')),
    featureServiceUrl: requiredWhen(isArcgis, 'GIS_FEATURE_SERVICE_URL', {
      description: 'ArcGIS feature service URL. Required because GIS_PROVIDER=arcgis.',
    }),
    apiKey: requiredWhen(isArcgis, 'GIS_API_KEY', {
      description: 'ArcGIS API key. Required because GIS_PROVIDER=arcgis.',
    }),
    parcelIdField: requiredWhen(isArcgis, 'GIS_PARCEL_ID_FIELD', {
      description: 'Feature attribute holding the parcel id. Required because GIS_PROVIDER=arcgis.',
    }),
  };

  /* ------------------------------------------------------------------------ */
  /* Connectors to the District's other systems                               */
  /*                                                                          */
  /* Each one is off unless explicitly switched on. Turning a connector on     */
  /* makes its own settings required, so a half-configured connection is       */
  /* refused at boot rather than failing silently in use.                      */
  /* ------------------------------------------------------------------------ */

  const arcgisOn = optionalBool('CONNECTOR_ARCGIS_ENABLED', false);
  const accufundOn = optionalBool('CONNECTOR_ACCUFUND_ENABLED', false);
  const civicplusOn = optionalBool('CONNECTOR_CIVICPLUS_ENABLED', false);
  const papervisionOn = optionalBool('CONNECTOR_PAPERVISION_ENABLED', false);
  const perchOn = optionalBool('CONNECTOR_PERCH_ENABLED', false);
  const legacyOn = optionalBool('CONNECTOR_LEGACY_ENABLED', false);

  const connectors = {
    arcgis: {
      enabled: arcgisOn,
      featureServiceUrl: requiredWhen(arcgisOn, 'ARCGIS_FEATURE_SERVICE_URL', {
        description: 'ArcGIS feature service URL. Required because CONNECTOR_ARCGIS_ENABLED=true.',
      }),
      apiKey: requiredWhen(arcgisOn, 'ARCGIS_API_KEY', {
        description: 'ArcGIS API key or token. Required because CONNECTOR_ARCGIS_ENABLED=true.',
      }),
      parcelIdField: requiredWhen(arcgisOn, 'ARCGIS_PARCEL_ID_FIELD', {
        description: 'Feature attribute holding the District parcel id.',
      }),
      // Even when true, only the whitelisted fields below may be written, and
      // geometry is excluded unconditionally by the connector itself.
      allowAttributeWrite: optionalBool('ARCGIS_ALLOW_ATTRIBUTE_WRITE', false),
      writableFields: asList(raw('ARCGIS_WRITABLE_FIELDS')),
      timeoutMs: Number(raw('ARCGIS_REQUEST_TIMEOUT_MS') ?? 15000),
    },

    accufund: {
      enabled: accufundOn,
      exportDir: resolvePath(optional('ACCUFUND_EXPORT_DIR', './integration/accufund/outbound')),
      importDir: resolvePath(optional('ACCUFUND_IMPORT_DIR', './integration/accufund/inbound')),
      archiveDir: resolvePath(optional('ACCUFUND_ARCHIVE_DIR', './integration/accufund/archive')),
      exportSchedule: optional('ACCUFUND_EXPORT_SCHEDULE', '0 2 * * *'),
      importSchedule: optional('ACCUFUND_IMPORT_SCHEDULE', '0 3 * * *'),
      filePrefix: optional('ACCUFUND_FILE_PREFIX', 'lams'),
      delimiter: raw('ACCUFUND_CSV_DELIMITER') ?? ',',
      fundCode: raw('ACCUFUND_FUND_CODE') ?? '',
      timezone: raw('ACCUFUND_TIMEZONE') ?? raw('SCHEDULER_TIMEZONE') ?? 'UTC',
    },

    civicplus: {
      enabled: civicplusOn,
      baseUrl: requiredWhen(civicplusOn, 'CIVICPLUS_BASE_URL', {
        description: 'CivicPlus API base URL. Required because CONNECTOR_CIVICPLUS_ENABLED=true.',
      }),
      apiKey: requiredWhen(civicplusOn, 'CIVICPLUS_API_KEY', {
        description: 'CivicPlus API key. Required because CONNECTOR_CIVICPLUS_ENABLED=true.',
      }),
      formId: requiredWhen(civicplusOn, 'CIVICPLUS_FORM_ID', {
        description: 'Identifier of the land-application form to pull submissions from.',
      }),
      pollSchedule: requiredWhen(civicplusOn, 'CIVICPLUS_POLL_SCHEDULE', {
        description: 'Cron expression for polling, e.g. "*/15 * * * *".',
      }),
      fieldMapFile: raw('CIVICPLUS_FIELD_MAP_FILE')
        ? resolvePath(raw('CIVICPLUS_FIELD_MAP_FILE'))
        : path.join(templateDir, 'connectors/civicplus-field-map.json'),
      timeoutMs: Number(raw('CIVICPLUS_REQUEST_TIMEOUT_MS') ?? 15000),
    },

    papervision: {
      enabled: papervisionOn,
      baseUrl: requiredWhen(papervisionOn, 'PAPERVISION_BASE_URL', {
        description: 'PaperVision base URL. Required because CONNECTOR_PAPERVISION_ENABLED=true.',
      }),
      apiKey: requiredWhen(papervisionOn, 'PAPERVISION_API_KEY', {
        description: 'PaperVision API key. Required because CONNECTOR_PAPERVISION_ENABLED=true.',
      }),
      documentUrlTemplate: requiredWhen(papervisionOn, 'PAPERVISION_DOCUMENT_URL_TEMPLATE', {
        description: 'Click-through URL template containing {documentId}.',
        validate: (v) => (v.includes('{documentId}') ? true : 'must contain the {documentId} placeholder.'),
      }),
      searchPath: raw('PAPERVISION_SEARCH_PATH') ?? '/api/documents/search',
      timeoutMs: Number(raw('PAPERVISION_REQUEST_TIMEOUT_MS') ?? 15000),
    },

    perch: {
      enabled: perchOn,
      baseUrl: requiredWhen(perchOn, 'PERCH_BASE_URL', {
        description: 'PERCH base URL. Required because CONNECTOR_PERCH_ENABLED=true.',
      }),
      apiKey: requiredWhen(perchOn, 'PERCH_API_KEY', {
        description: 'PERCH API key. Required because CONNECTOR_PERCH_ENABLED=true.',
      }),
      parcelQueryPath: raw('PERCH_PARCEL_QUERY_PATH') ?? '/api/sites',
      timeoutMs: Number(raw('PERCH_REQUEST_TIMEOUT_MS') ?? 15000),
      /** Not configurable: this connector has no write path at all. */
      readOnly: true,
    },

    legacy: {
      enabled: legacyOn,
      systemName: raw('LEGACY_SYSTEM_NAME') ?? 'Legacy land tracker',
    },
  };

  // --- Reporting and scheduling --------------------------------------------
  const scheduler = {
    enabled: optionalBool('SCHEDULER_ENABLED', true),
    timezone: optional('SCHEDULER_TIMEZONE', 'UTC'),
  };

  const reporting = {
    outputDir: resolvePath(optional('REPORT_OUTPUT_DIR', './reports')),
    monthlySchedule: optional('REPORT_MONTHLY_SCHEDULE', '0 6 1 * *'),
    retentionDays: optionalInt('REPORT_RETENTION_DAYS', 365, { min: 1 }),
    maxRows: optionalInt('REPORT_MAX_ROWS', 50000, { min: 1 }),
  };

  // --- Feature toggles -----------------------------------------------------
  const features = {
    map: optionalBool('FEATURE_MAP', true),
    documentGeneration: optionalBool('FEATURE_DOCUMENT_GENERATION', true),
    timber: optionalBool('FEATURE_TIMBER', true),
  };

  // --- Operational tunables ------------------------------------------------
  const logLevel = optional('LOG_LEVEL', 'info');
  const rateLimitWindowMs = optionalInt('RATE_LIMIT_WINDOW_MS', 900000, { min: 1000 });
  const rateLimitMax = optionalInt('RATE_LIMIT_MAX', 300, { min: 1 });
  const authRateLimitMax = optionalInt('AUTH_RATE_LIMIT_MAX', 10, { min: 1 });
  const registerRateLimitMax = optionalInt('REGISTER_RATE_LIMIT_MAX', 5, { min: 1 });

  if (problems.length) throw new EnvValidationError(problems);

  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    port,
    apiBaseUrl,
    db: Object.freeze({ uri: mongoUri, name: mongoDbName }),
    clientUrl,
    corsOrigins,
    auth: Object.freeze({
      defaultRole,
      minPasswordLength,
      allowRegistration,
      jwt: Object.freeze({
        secret: jwtSecret,
        refreshSecret: jwtRefreshSecret,
        expiresIn: jwtExpiresIn,
        refreshExpiresIn: jwtRefreshExpiresIn,
        issuer: jwtIssuer,
        audience: jwtAudience,
      }),
      saltRounds,
    }),
    storage: Object.freeze(storage),
    documents: Object.freeze(documents),
    numbering: Object.freeze(numbering),
    intake: Object.freeze(intake),
    gis: Object.freeze(gis),
    connectors: Object.freeze(connectors),
    scheduler: Object.freeze(scheduler),
    reporting: Object.freeze(reporting),
    features: Object.freeze(features),
    logLevel,
    rateLimit: Object.freeze({
      windowMs: rateLimitWindowMs,
      max: rateLimitMax,
      authMax: authRateLimitMax,
      registerMax: registerRateLimitMax,
    }),
    defaultsApplied: Object.freeze([...defaulted]),
  });
}

loadDotEnv();

let config;
try {
  config = build();
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
  throw error;
}

export { EnvValidationError };
export default config;

/* Allow `node src/config/env.js --check` as a pre-flight check. */
if (process.argv.includes('--check')) {
  console.log('Environment OK.');
  console.log(`  NODE_ENV        ${config.nodeEnv}`);
  console.log(`  PORT            ${config.port}`);
  console.log(`  MONGODB_URI     ${config.db.uri.replace(/\/\/[^@]*@/, '//***:***@')}`);
  console.log(`  MONGODB_DB_NAME ${config.db.name}`);
  console.log(`  CLIENT_URL      ${config.clientUrl}`);
  console.log(`  CORS_ORIGINS    ${config.corsOrigins.join(', ')}`);
  console.log(`  REGISTRATION    ${config.auth.allowRegistration ? 'open' : 'closed'}`);
  console.log(`  STORAGE         ${config.storage.provider} (${config.storage.localPath})`);
  const on = Object.entries(config.connectors)
    .filter(([, connector]) => connector.enabled)
    .map(([name]) => name);
  console.log(`  CONNECTORS ON   ${on.length ? on.join(', ') : '(none)'}`);
  console.log(`  SCHEDULER       ${config.scheduler.enabled ? `on (${config.scheduler.timezone})` : 'off'}`);
  console.log(`  defaults used   ${config.defaultsApplied.length} setting(s) not set in .env`);
}
