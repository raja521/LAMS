/**
 * Environment contract for the LAMS API.
 *
 * Ground rule: nothing in this application is configured in code. Every value
 * below comes from the environment. Required settings have NO fallback — if one
 * is missing the process refuses to start and names it. Only the handful of
 * operational tunables at the bottom carry defaults, and when one is applied it
 * is reported at boot so it is never a silent substitution.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root — the single .env shared by the server, client and migrations. */
export const ROOT_DIR = path.resolve(__dirname, '../../..');

/** Load the root .env once. Real process env always wins over the file. */
export function loadDotEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
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
        'Fix: copy .env.example to .env and set the values listed above.\n' +
        '     cp .env.example .env\n' +
        'No default is applied for these settings by design.\n'
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

/** Required only when `condition` is true — e.g. Azure settings when Azure is on. */
function requiredWhen(condition, name, opts = {}) {
  if (!condition) return raw(name);
  return required(name, opts);
}

/** An operational tunable. Applying a default is recorded and reported at boot. */
function optional(name, fallback, { parse = (v) => v } = {}) {
  const value = raw(name);
  if (value === undefined) {
    defaulted.push(`${name}=${fallback}`);
    return fallback;
  }
  return parse(value);
}

function asInt(name, value, { min, max } = {}) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fail(name, `must be a whole number (received "${value}").`);
  if (min !== undefined && parsed < min) return fail(name, `must be at least ${min} (received ${parsed}).`);
  if (max !== undefined && parsed > max) return fail(name, `must be at most ${max} (received ${parsed}).`);
  return parsed;
}

function asBool(value, fallback) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function asList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* The contract                                                               */
/* -------------------------------------------------------------------------- */

function build() {
  problems.length = 0;
  defaulted.length = 0;

  // --- Runtime -------------------------------------------------------------
  const nodeEnv = required('NODE_ENV', {
    description: 'One of: development, test, production.',
    allowed: ['development', 'test', 'production'],
  });
  const port = asInt('PORT', required('PORT', { description: 'TCP port for the API, e.g. 4000.' }), {
    min: 1,
    max: 65535,
  });
  const apiBaseUrl = required('API_BASE_URL', {
    description: 'Public base URL of this API, e.g. http://localhost:4000.',
    validate: (v) => (/^https?:\/\//.test(v) ? true : 'must start with http:// or https://.'),
  });

  // --- Database ------------------------------------------------------------
  const mongoUri = required('MONGODB_URI', {
    description: 'MongoDB connection string, e.g. mongodb://127.0.0.1:27017/lams.',
    validate: (v) => (/^mongodb(\+srv)?:\/\//.test(v) ? true : 'must start with mongodb:// or mongodb+srv://.'),
  });
  const mongoDbName = required('MONGODB_DB_NAME', { description: 'Database name, e.g. lams.' });

  // --- Front end -----------------------------------------------------------
  const clientUrl = required('CLIENT_URL', {
    description: 'Base URL of the React app, e.g. http://localhost:5173.',
    validate: (v) => (/^https?:\/\//.test(v) ? true : 'must start with http:// or https://.'),
  });
  const corsOrigins = asList(
    required('CORS_ORIGINS', { description: 'Comma-separated list of allowed browser origins.' })
  );

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
  const jwtExpiresIn = required('JWT_EXPIRES_IN', { description: 'Access token lifetime, e.g. 1h.' });
  const jwtRefreshExpiresIn = required('JWT_REFRESH_EXPIRES_IN', {
    description: 'Refresh token lifetime, e.g. 7d.',
  });
  const jwtIssuer = required('JWT_ISSUER', { description: 'Token issuer claim, e.g. lams-api.' });
  const jwtAudience = required('JWT_AUDIENCE', { description: 'Token audience claim, e.g. lams-client.' });
  const saltRounds = asInt(
    'BCRYPT_SALT_ROUNDS',
    required('BCRYPT_SALT_ROUNDS', { description: 'Password hashing work factor, 10-14 is typical.' }),
    { min: 4, max: 20 }
  );

  // --- Login system --------------------------------------------------------
  const providers = asList(
    required('AUTH_PROVIDER', { description: 'Comma-separated sign-in methods: local, azure-ad.' })
  );
  const unknownProviders = providers.filter((p) => !['local', 'azure-ad'].includes(p));
  if (unknownProviders.length) {
    fail('AUTH_PROVIDER', `contains unsupported value(s): ${unknownProviders.join(', ')}. Use local and/or azure-ad.`);
  }
  if (providers.length === 0) {
    fail('AUTH_PROVIDER', 'must enable at least one sign-in method (local and/or azure-ad).');
  }
  const azureEnabled = providers.includes('azure-ad');
  const azure = {
    enabled: azureEnabled,
    tenantId: requiredWhen(azureEnabled, 'AZURE_AD_TENANT_ID', {
      description: 'Entra ID directory (tenant) ID. Required because AUTH_PROVIDER includes azure-ad.',
    }),
    clientId: requiredWhen(azureEnabled, 'AZURE_AD_CLIENT_ID', {
      description: 'Entra ID application (client) ID. Required because AUTH_PROVIDER includes azure-ad.',
    }),
    clientSecret: requiredWhen(azureEnabled, 'AZURE_AD_CLIENT_SECRET', {
      description: 'Entra ID client secret. Required because AUTH_PROVIDER includes azure-ad.',
    }),
    redirectUri: requiredWhen(azureEnabled, 'AZURE_AD_REDIRECT_URI', {
      description: 'OIDC callback URL registered in Entra ID.',
    }),
    authority: requiredWhen(azureEnabled, 'AZURE_AD_AUTHORITY', {
      description: 'Entra ID authority host, e.g. https://login.microsoftonline.com.',
    }),
    scopes: asList(raw('AZURE_AD_SCOPES') ?? 'openid,profile,email'),
    groupRoleMap: {
      [ROLES.ADMIN]: raw('AZURE_AD_ADMIN_GROUP_ID'),
      [ROLES.MODULE_EDITOR]: raw('AZURE_AD_EDITOR_GROUP_ID'),
      [ROLES.READ_ONLY]: raw('AZURE_AD_READONLY_GROUP_ID'),
    },
  };
  const defaultRole = required('DEFAULT_USER_ROLE', {
    description: `Role for a new user. One of: ${ROLE_VALUES.join(', ')}.`,
    allowed: ROLE_VALUES,
  });

  // --- File storage --------------------------------------------------------
  const storageProvider = required('STORAGE_PROVIDER', {
    description: 'Where documents are stored. One of: local, s3.',
    allowed: ['local', 's3'],
  });
  const isS3 = storageProvider === 's3';
  const isLocalStorage = storageProvider === 'local';
  const storage = {
    provider: storageProvider,
    localPath: requiredWhen(isLocalStorage, 'STORAGE_LOCAL_PATH', {
      description: 'Directory for uploads. Required because STORAGE_PROVIDER=local.',
    }),
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
      forcePathStyle: asBool(raw('S3_FORCE_PATH_STYLE'), false),
    },
    maxUploadBytes: asInt(
      'MAX_UPLOAD_BYTES',
      required('MAX_UPLOAD_BYTES', { description: 'Maximum upload size in bytes, e.g. 26214400.' }),
      { min: 1 }
    ),
  };

  // --- Document generation -------------------------------------------------
  const templateDir = required('TEMPLATE_DIR', {
    description: 'Directory holding the editable document/checklist/scoring templates.',
  });
  const documents = {
    templateDir: templateDir ? path.resolve(ROOT_DIR, templateDir) : undefined,
    org: {
      name: required('DOC_ORG_NAME', { description: 'Organization name printed on every document.' }),
      division: required('DOC_ORG_DIVISION', { description: 'Division name printed under the organization.' }),
      address: required('DOC_ORG_ADDRESS', { description: 'Address printed in the letterhead.' }),
    },
    footerText: required('DOC_FOOTER_TEXT', { description: 'Footer line printed on every document.' }),
    locale: optional('DOC_LOCALE', 'en-US'),
    currency: optional('DOC_CURRENCY', 'USD'),
  };

  // --- Automatic reference numbering ---------------------------------------
  const numbering = {
    prefixes: {
      application: required('FILE_NUMBER_PREFIX', { description: 'Prefix for acquisition file numbers, e.g. LA.' }),
      contract: required('CONTRACT_NUMBER_PREFIX', { description: 'Prefix for contract numbers, e.g. CT.' }),
      purchaseOrder: required('PO_NUMBER_PREFIX', { description: 'Prefix for purchase order numbers, e.g. PO.' }),
      document: required('DOCUMENT_NUMBER_PREFIX', { description: 'Prefix for generated document numbers.' }),
      disposition: required('DISPOSITION_NUMBER_PREFIX', { description: 'Prefix for disposition case numbers.' }),
    },
    pad: asInt(
      'NUMBER_SEQUENCE_PAD',
      required('NUMBER_SEQUENCE_PAD', { description: 'How many digits to pad sequence numbers to, e.g. 5.' }),
      { min: 1, max: 12 }
    ),
    scope: required('NUMBER_SEQUENCE_SCOPE', {
      description: 'Whether sequences restart each year. One of: yearly, never.',
      allowed: ['yearly', 'never'],
    }),
  };

  // --- Application intake --------------------------------------------------
  const intakeSource = required('INTAKE_SOURCE', {
    description: 'Where new land applications arrive from. One of: simulated, webhook.',
    allowed: ['simulated', 'webhook'],
  });
  const intake = {
    source: intakeSource,
    webhookSecret: required('INTAKE_WEBHOOK_SECRET', {
      description: 'Shared secret the form system signs intake posts with.',
      validate: (v) => (v.length >= 8 ? true : 'must be at least 8 characters.'),
    }),
    formSystemUrl: requiredWhen(intakeSource === 'webhook', 'INTAKE_FORM_SYSTEM_URL', {
      description: 'URL of the online form system. Required because INTAKE_SOURCE=webhook.',
    }),
  };

  // --- Mapping / GIS -------------------------------------------------------
  const gisProvider = required('GIS_PROVIDER', {
    description: 'Source of parcel geometry. One of: sample, arcgis.',
    allowed: ['sample', 'arcgis'],
  });
  const isArcgis = gisProvider === 'arcgis';
  const gisSamplePath = requiredWhen(gisProvider === 'sample', 'GIS_SAMPLE_DATA_PATH', {
    description: 'Path to the sample GeoJSON file. Required because GIS_PROVIDER=sample.',
  });
  const gis = {
    provider: gisProvider,
    samplePath: gisSamplePath ? path.resolve(ROOT_DIR, gisSamplePath) : undefined,
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
  /* Each one is independent and off unless explicitly switched on. Turning a  */
  /* connector on makes its own settings required, so a half-configured        */
  /* connection is refused at boot rather than failing silently in use.        */
  /* ------------------------------------------------------------------------ */

  const connectorEnabled = (name) =>
    asBool(
      required(`CONNECTOR_${name}_ENABLED`, {
        description: `Whether the ${name} connector is switched on. true or false.`,
        allowed: ['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'],
      }),
      false
    );

  const arcgisOn = connectorEnabled('ARCGIS');
  const accufundOn = connectorEnabled('ACCUFUND');
  const civicplusOn = connectorEnabled('CIVICPLUS');
  const papervisionOn = connectorEnabled('PAPERVISION');
  const perchOn = connectorEnabled('PERCH');
  const legacyOn = connectorEnabled('LEGACY');

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
      allowAttributeWrite: asBool(raw('ARCGIS_ALLOW_ATTRIBUTE_WRITE'), false),
      writableFields: asList(raw('ARCGIS_WRITABLE_FIELDS')),
      timeoutMs: Number(raw('ARCGIS_REQUEST_TIMEOUT_MS') ?? 15000),
    },

    accufund: {
      enabled: accufundOn,
      exportDir: requiredWhen(accufundOn, 'ACCUFUND_EXPORT_DIR', {
        description: 'Directory LAMS writes AccuFund export files to.',
      }),
      importDir: requiredWhen(accufundOn, 'ACCUFUND_IMPORT_DIR', {
        description: 'Directory LAMS reads AccuFund response files from.',
      }),
      archiveDir: requiredWhen(accufundOn, 'ACCUFUND_ARCHIVE_DIR', {
        description: 'Directory processed AccuFund files are moved to.',
      }),
      exportSchedule: requiredWhen(accufundOn, 'ACCUFUND_EXPORT_SCHEDULE', {
        description: 'Cron expression for the export run, e.g. "0 2 * * *".',
      }),
      importSchedule: requiredWhen(accufundOn, 'ACCUFUND_IMPORT_SCHEDULE', {
        description: 'Cron expression for the import run, e.g. "0 3 * * *".',
      }),
      filePrefix: requiredWhen(accufundOn, 'ACCUFUND_FILE_PREFIX', {
        description: 'Prefix for exported file names.',
      }),
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
        ? path.resolve(ROOT_DIR, raw('CIVICPLUS_FIELD_MAP_FILE'))
        : path.join(templateDir ? path.resolve(ROOT_DIR, templateDir) : '', 'connectors/civicplus-field-map.json'),
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
    enabled: asBool(
      required('SCHEDULER_ENABLED', { description: 'Whether background schedules run on this instance.' }),
      true
    ),
    timezone: raw('SCHEDULER_TIMEZONE') ?? 'UTC',
  };

  const reportOutputDirRaw = required('REPORT_OUTPUT_DIR', {
    description: 'Directory scheduled report output is written to.',
  });
  const reporting = {
    outputDir: reportOutputDirRaw ? path.resolve(ROOT_DIR, reportOutputDirRaw) : undefined,
    monthlySchedule: required('REPORT_MONTHLY_SCHEDULE', {
      description: 'Cron expression for the monthly report run, e.g. "0 6 1 * *".',
    }),
    retentionDays: asInt('REPORT_RETENTION_DAYS', raw('REPORT_RETENTION_DAYS') ?? '365', { min: 1 }),
    maxRows: asInt('REPORT_MAX_ROWS', raw('REPORT_MAX_ROWS') ?? '50000', { min: 1 }),
  };

  // --- Feature toggles -----------------------------------------------------
  const features = {
    map: asBool(raw('FEATURE_MAP'), true),
    documentGeneration: asBool(raw('FEATURE_DOCUMENT_GENERATION'), true),
    timber: asBool(raw('FEATURE_TIMBER'), true),
  };

  // --- Operational tunables (documented defaults, reported at boot) ---------
  const logLevel = optional('LOG_LEVEL', 'info');
  const rateLimitWindowMs = optional('RATE_LIMIT_WINDOW_MS', 900000, { parse: Number });
  const rateLimitMax = optional('RATE_LIMIT_MAX', 300, { parse: Number });
  const authRateLimitMax = optional('AUTH_RATE_LIMIT_MAX', 10, { parse: Number });

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
      providers,
      localEnabled: providers.includes('local'),
      azure: Object.freeze(azure),
      defaultRole,
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
  console.log(`  AUTH_PROVIDER   ${config.auth.providers.join(', ')}`);
  console.log(`  STORAGE         ${config.storage.provider}`);
  const on = Object.entries(config.connectors)
    .filter(([, connector]) => connector.enabled)
    .map(([name]) => name);
  console.log(`  CONNECTORS ON   ${on.length ? on.join(', ') : '(none)'}`);
  console.log(`  SCHEDULER       ${config.scheduler.enabled ? `on (${config.scheduler.timezone})` : 'off'}`);
  if (config.defaultsApplied.length) {
    console.log(`  defaults used   ${config.defaultsApplied.join(', ')}`);
  }
}
