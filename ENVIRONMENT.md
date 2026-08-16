# Environment settings

Every value LAMS uses comes from the environment. Nothing is hard-coded — there is
no fallback for a required setting anywhere in the application.

**This file is generated from `.env.example`.** Run `npm run docs:env` after
changing that file rather than editing this one.

## How to set this up

```bash
cp .env.example .env          # start from the template
openssl rand -base64 48       # → JWT_SECRET
openssl rand -base64 48       # → JWT_REFRESH_SECRET  (must differ)
npm run env:check             # confirms the environment is complete before starting
```

If a required setting is missing, the server refuses to start and names it:

```
LAMS cannot start: the environment is incomplete.

2 problems found in your environment:
  • MONGODB_URI — is required but not set. MongoDB connection string, e.g. ...
  • JWT_SECRET — is required but not set. Signing key for access tokens. ...
```

## Rules that apply throughout

| Rule | Why |
|---|---|
| `.env` is git-ignored; `.env.example` is committed | The list of settings travels with the project; the values never do. |
| Anything prefixed `VITE_` is compiled into the browser bundle | **Never put a secret behind `VITE_`** — it ships to every visitor. |
| Each connector is off unless its `CONNECTOR_*_ENABLED` flag says otherwise | Nothing assumes a connection to the District's systems is available. |
| Switching a connector on makes its own settings required | A half-configured connection is refused at boot rather than failing later. |
| `npm run secrets:check` must pass before release | Confirms nothing sensitive was written into code or committed. |

## Legend

- **Required** — the application will not start without it.
- **Conditional** — required only when the feature or connector it belongs to is switched on.
- **Optional** — has a documented default, which is reported in the startup log when applied.


**134 settings across 23 groups.**

---

## Runtime  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `NODE_ENV` | Required | development \| test \| production | `development` |
| `PORT` | Required | Port the Express API listens on. | `4000` |
| `API_BASE_URL` | Required | Public base URL of this API, used to build absolute links (e.g. OIDC redirects). | `http://localhost:4000` |

---

## Database  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `MONGODB_URI` | Required | MongoDB connection string. Local:   mongodb://127.0.0.1:27017/lams Atlas:   mongodb+srv://USER:PASSWORD@cluster0.example.mongodb.net/lams?retryWrites=true&w=majority | `mongodb://127.0.0.1:27017/lams` |
| `MONGODB_DB_NAME` | Required | Name of the database to use. Overrides any database in MONGODB_URI. | `lams` |

---

## Front end  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `CLIENT_URL` | Required | Where the React app is served from. Used for CORS and post-login redirects. | `http://localhost:5173` |
| `CORS_ORIGINS` | Required | Comma-separated list of origins allowed to call the API. | `http://localhost:5173` |
| `VITE_APP_NAME` | Required | --- Values exposed to the browser bundle (Vite only inlines VITE_* names) --- Never put a secret behind a VITE_ prefix: it ships to every visitor. | `LAMS` |
| `VITE_API_BASE_URL` | Required | — | `http://localhost:4000/api` |
| `VITE_AUTH_PROVIDER` | Required | — | `local` |
| `VITE_ORG_NAME` | Required | — | `District of Example` |
| `VITE_AZURE_AD_CLIENT_ID` | Required | — | `00000000-0000-0000-0000-000000000000` |
| `VITE_AZURE_AD_TENANT_ID` | Required | — | `00000000-0000-0000-0000-000000000000` |

---

## Session security  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `JWT_SECRET` | Required | Secret used to sign access tokens. Must be at least 32 characters. Generate one with:  openssl rand -base64 48 | `replace-me-with-a-long-random-string-at-least-32-chars` |
| `JWT_REFRESH_SECRET` | Required | — | `replace-me-with-a-different-long-random-string-32` |
| `JWT_EXPIRES_IN` | Required | — | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | Required | — | `7d` |
| `JWT_ISSUER` | Required | — | `lams-api` |
| `JWT_AUDIENCE` | Required | — | `lams-client` |
| `BCRYPT_SALT_ROUNDS` | Required | Work factor for password hashing (10-14 is the usual range). | `12` |

---

## Login system / identity provider  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `AUTH_PROVIDER` | Required | Which sign-in methods are enabled. Comma-separated: local, azure-ad `local`    — email + password held in the LAMS database. `azure-ad` — Microsoft Entra ID (Azure AD) organizational sign-in. | `local` |
| `AZURE_AD_TENANT_ID` | Conditional | --- Microsoft Entra ID (Azure AD) — REQUIRED only when AUTH_PROVIDER includes azure-ad --- | `00000000-0000-0000-0000-000000000000` |
| `AZURE_AD_CLIENT_ID` | Required | — | `00000000-0000-0000-0000-000000000000` |
| `AZURE_AD_CLIENT_SECRET` | Required | — | `replace-me-with-the-client-secret-from-azure` |
| `AZURE_AD_REDIRECT_URI` | Required | — | `http://localhost:4000/api/auth/azure-ad/callback` |
| `AZURE_AD_AUTHORITY` | Required | — | `https://login.microsoftonline.com` |
| `AZURE_AD_SCOPES` | Required | — | `openid,profile,email,User.Read` |
| `AZURE_AD_ADMIN_GROUP_ID` | Required | Entra group object-id -> LAMS role. Leave blank to assign DEFAULT_USER_ROLE. | _(blank)_ |
| `AZURE_AD_EDITOR_GROUP_ID` | Required | — | _(blank)_ |
| `AZURE_AD_READONLY_GROUP_ID` | Required | — | _(blank)_ |
| `DEFAULT_USER_ROLE` | Required | Role given to a brand-new user when nothing else determines one. One of: read_only \| module_editor \| admin | `read_only` |

---

## File storage  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `STORAGE_PROVIDER` | Required | Where generated documents and parcel map files live. One of: local \| s3 | `local` |
| `STORAGE_LOCAL_PATH` | Conditional | --- REQUIRED when STORAGE_PROVIDER=local --- | `./uploads` |
| `S3_BUCKET` | Conditional | --- REQUIRED when STORAGE_PROVIDER=s3 (also works for MinIO / R2 / Wasabi) --- | `lams-documents` |
| `S3_REGION` | Required | — | `us-west-2` |
| `S3_ACCESS_KEY_ID` | Required | — | `replace-me-with-an-access-key-id` |
| `S3_SECRET_ACCESS_KEY` | Required | — | `replace-me-with-a-secret-access-key` |
| `S3_ENDPOINT` | Required | Leave blank for real AWS; set for S3-compatible services, e.g. http://localhost:9000 | _(blank)_ |
| `S3_FORCE_PATH_STYLE` | Required | — | `false` |
| `MAX_UPLOAD_BYTES` | Required | Largest upload accepted, in bytes (25 MB). | `26214400` |

---

## Document generation  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `TEMPLATE_DIR` | Required | Where the editable template files live. These are plain JSON describing the layout of each memo, letter and contract — change one and the output changes, no code edit required. | `./server/templates` |
| `DOC_ORG_NAME` | Required | Details printed in the letterhead and footer of every generated document. | `District of Example` |
| `DOC_ORG_DIVISION` | Required | — | `Land Acquisition and Management` |
| `DOC_ORG_ADDRESS` | Required | — | `100 Example Road, Example City, ST 00000` |
| `DOC_FOOTER_TEXT` | Required | — | `Generated by LAMS — Land Acquisition and Management Software Solution` |
| `DOC_LOCALE` | Required | Formatting of dates and money inside generated documents. | `en-US` |
| `DOC_CURRENCY` | Required | — | `USD` |

---

## Automatic reference numbering  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `FILE_NUMBER_PREFIX` | Required | Applications, contracts, purchase orders and documents are numbered automatically. Prefixes and width are set here so the District's own numbering convention can be matched without touching code. | `LA` |
| `CONTRACT_NUMBER_PREFIX` | Required | — | `CT` |
| `PO_NUMBER_PREFIX` | Required | — | `PO` |
| `DOCUMENT_NUMBER_PREFIX` | Required | — | `DOC` |
| `DISPOSITION_NUMBER_PREFIX` | Required | — | `LD` |
| `NUMBER_SEQUENCE_PAD` | Required | — | `5` |
| `NUMBER_SEQUENCE_SCOPE` | Required | yearly = sequence restarts each calendar year (LA-2026-00001); never = runs forever. | `yearly` |

---

## Application intake  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `INTAKE_SOURCE` | Required | Where new "I want to sell land to the District" applications come from. simulated = the built-in generator and manual entry used until the real online-form connection is wired up. webhook   = the form system posts to /api/acquisition/intake/webhook. | `simulated` |
| `INTAKE_WEBHOOK_SECRET` | Required | Shared secret the form system must send as the X-LAMS-Intake-Signature header. | `replace-me-with-a-shared-secret` |
| `INTAKE_FORM_SYSTEM_URL` | Conditional | REQUIRED when INTAKE_SOURCE=webhook — the form system this instance accepts. | _(blank)_ |

---

## Mapping / GIS — server side  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `GIS_PROVIDER` | Required | sample = geometry served from a local GeoJSON file (used until the District's own service is connected). arcgis = a live ArcGIS feature service. Both go through the same provider interface, so switching is a config change. | `sample` |
| `GIS_SAMPLE_DATA_PATH` | Conditional | REQUIRED when GIS_PROVIDER=sample | `./server/sample-data/parcels.geojson` |
| `GIS_FEATURE_SERVICE_URL` | Conditional | REQUIRED when GIS_PROVIDER=arcgis | _(blank)_ |
| `GIS_API_KEY` | Required | — | _(blank)_ |
| `GIS_PARCEL_ID_FIELD` | Required | — | `PARCEL_ID` |

---

## Mapping / GIS — browser side  (REQUIRED)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `VITE_MAP_PROVIDER` | Required | Which basemap tiles to draw. Any XYZ tile service works; point this at the District's own ArcGIS basemap when it is available. | `sample` |
| `VITE_MAP_BASEMAP_URL` | Required | — | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `VITE_MAP_BASEMAP_ATTRIBUTION` | Required | — | `© OpenStreetMap contributors` |
| `VITE_MAP_DEFAULT_CENTER` | Required | — | `44.9778,-93.2650` |
| `VITE_MAP_DEFAULT_ZOOM` | Required | — | `11` |
| `VITE_MAP_MAX_ZOOM` | Required | — | `19` |
| `VITE_MAP_LAYERS` | Required | Comma-separated overlay layers to offer in the layer switcher. | `parcels,boundaries` |
| `VITE_MAP_API_KEY` | Conditional | REQUIRED when VITE_MAP_PROVIDER=arcgis — never put a paid key here in a repo. | _(blank)_ |
| `VITE_MAP_FEATURE_SERVICE_URL` | Required | — | _(blank)_ |

---

## Feature toggles  (OPTIONAL — default to on)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `FEATURE_MAP` | Optional | — | `true` |
| `FEATURE_DOCUMENT_GENERATION` | Optional | — | `true` |
| `FEATURE_TIMBER` | Optional | — | `true` |
| `VITE_FEATURE_MAP` | Optional | — | `true` |
| `VITE_FEATURE_DOCUMENT_GENERATION` | Optional | — | `true` |
| `VITE_FEATURE_TIMBER` | Optional | — | `true` |

---

## CONNECTIONS TO THE DISTRICT'S OTHER SYSTEMS

Every connector is independent and OFF by default. Turning one on makes its own settings required — the server then refuses to start until they are set, rather than running with a half-configured connection. A connector that is off, or on but not reachable, is reported plainly in Administration → Integrations; nothing silently pretends the data is there.

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `CONNECTOR_ARCGIS_ENABLED` | Required | --- Master switches (REQUIRED) ---------------------------------------------- | `false` |
| `CONNECTOR_ACCUFUND_ENABLED` | Conditional | — | `false` |
| `CONNECTOR_CIVICPLUS_ENABLED` | Conditional | — | `false` |
| `CONNECTOR_PAPERVISION_ENABLED` | Conditional | — | `false` |
| `CONNECTOR_PERCH_ENABLED` | Conditional | — | `false` |
| `CONNECTOR_LEGACY_ENABLED` | Conditional | — | `false` |

---

## ArcGIS — the District's mapping system

REQUIRED when CONNECTOR_ARCGIS_ENABLED=true

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `ARCGIS_FEATURE_SERVICE_URL` | Conditional | LAMS reads location information and writes only labels/associations. It is never permitted to change the shape or boundary of a property — the District manages geometry itself. The geometry guard is enforced in code and cannot be switched on from configuration. | _(blank)_ |
| `ARCGIS_API_KEY` | Conditional | — | _(blank)_ |
| `ARCGIS_PARCEL_ID_FIELD` | Conditional | The attribute on the feature service that holds the District's parcel id. | `PARCEL_ID` |
| `ARCGIS_ALLOW_ATTRIBUTE_WRITE` | Conditional | Whether LAMS may write labels back at all. Even when true, only the fields listed below can be written, and geometry is always excluded. | `false` |
| `ARCGIS_WRITABLE_FIELDS` | Conditional | — | `LAMS_LABEL,LAMS_PARCEL_ID,LAMS_PROGRAM,LAMS_STATUS` |
| `ARCGIS_REQUEST_TIMEOUT_MS` | Conditional | — | `15000` |

---

## AccuFund — the District's financial system

REQUIRED when CONNECTOR_ACCUFUND_ENABLED=true

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `ACCUFUND_EXPORT_DIR` | Conditional | A live always-on connection is not confirmed to be available, so this is a scheduled file transfer: LAMS writes an export file on a schedule and reads any response files the finance team drops in the inbound directory. | `./integration/accufund/outbound` |
| `ACCUFUND_IMPORT_DIR` | Conditional | — | `./integration/accufund/inbound` |
| `ACCUFUND_ARCHIVE_DIR` | Conditional | — | `./integration/accufund/archive` |
| `ACCUFUND_EXPORT_SCHEDULE` | Conditional | Standard five-field cron expressions. | `0 2 * * *` |
| `ACCUFUND_IMPORT_SCHEDULE` | Conditional | — | `0 3 * * *` |
| `ACCUFUND_FILE_PREFIX` | Conditional | — | `LAMS_AF` |
| `ACCUFUND_CSV_DELIMITER` | Conditional | — | `,` |
| `ACCUFUND_FUND_CODE` | Conditional | Fund/organisation code AccuFund expects on every exported line. | _(blank)_ |
| `ACCUFUND_TIMEZONE` | Conditional | — | `America/Chicago` |

---

## CivicPlus — the online application-intake system

REQUIRED when CONNECTOR_CIVICPLUS_ENABLED=true

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `CIVICPLUS_BASE_URL` | Conditional | New land-purchase applications flow in automatically instead of being typed in. | _(blank)_ |
| `CIVICPLUS_API_KEY` | Conditional | — | _(blank)_ |
| `CIVICPLUS_FORM_ID` | Conditional | — | _(blank)_ |
| `CIVICPLUS_POLL_SCHEDULE` | Conditional | — | `*/15 * * * *` |
| `CIVICPLUS_REQUEST_TIMEOUT_MS` | Conditional | — | `15000` |
| `CIVICPLUS_FIELD_MAP_FILE` | Conditional | Maps CivicPlus form field names onto LAMS application fields. Edit this rather than the code when the District changes their form. | `./server/templates/connectors/civicplus-field-map.json` |

---

## PaperVision — the District's document storage

REQUIRED when CONNECTOR_PAPERVISION_ENABLED=true

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `PAPERVISION_BASE_URL` | Conditional | Documents are NOT copied into the LAMS database. LAMS stores a reference and a click-through link back to where the real document lives. | _(blank)_ |
| `PAPERVISION_API_KEY` | Conditional | — | _(blank)_ |
| `PAPERVISION_DOCUMENT_URL_TEMPLATE` | Conditional | {documentId} is substituted when building the click-through link. | `https://papervision.example.gov/view?docid={documentId}` |
| `PAPERVISION_SEARCH_PATH` | Conditional | — | `/api/documents/search` |
| `PAPERVISION_REQUEST_TIMEOUT_MS` | Conditional | — | `15000` |

---

## PERCH — the environmental-tracking system

REQUIRED when CONNECTOR_PERCH_ENABLED=true

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `PERCH_BASE_URL` | Conditional | Read-only by design: LAMS looks at this information and never changes it. There is no write path in the connector at all. | _(blank)_ |
| `PERCH_API_KEY` | Conditional | — | _(blank)_ |
| `PERCH_PARCEL_QUERY_PATH` | Conditional | — | `/api/sites` |
| `PERCH_REQUEST_TIMEOUT_MS` | Conditional | — | `15000` |

---

## Legacy land-tracking spreadsheet/database

REQUIRED when CONNECTOR_LEGACY_ENABLED=true

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `LEGACY_SYSTEM_NAME` | Conditional | A one-time transfer, not a live connection. The work is done by the separate migration tool in ./migrations/import; this flag only makes the status of that transfer visible in the admin area. | `District Land Tracker` |

---

## REPORTING AND SCHEDULING

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `SCHEDULER_ENABLED` | Conditional | Master switch for every background schedule (report runs, AccuFund transfers, CivicPlus polling). Turn off on a second app instance so schedules only run once. | `true` |
| `SCHEDULER_TIMEZONE` | Conditional | — | `America/Chicago` |
| `REPORT_OUTPUT_DIR` | Conditional | Where scheduled report output is written, and how long it is kept. | `./reports` |
| `REPORT_MONTHLY_SCHEDULE` | Conditional | — | `0 6 1 * *` |
| `REPORT_RETENTION_DAYS` | Conditional | — | `365` |
| `REPORT_MAX_ROWS` | Conditional | Guard against a filter that would try to export the entire database. | `50000` |

---

## First-run seeding  (REQUIRED only when you run `npm run seed`)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `SEED_ADMIN_EMAIL` | Conditional | Creates the first Administrator so someone can sign in to a fresh database. There is no built-in default account — if these are unset, seeding refuses to run. | `admin@example.gov` |
| `SEED_ADMIN_PASSWORD` | Conditional | — | `replace-me-with-a-long-passphrase` |
| `SEED_ADMIN_FIRST_NAME` | Conditional | — | `First` |
| `SEED_ADMIN_LAST_NAME` | Conditional | — | `Last` |
| `SEED_ORG_NAME` | Conditional | — | `District of Example` |

---

## Operational  (OPTIONAL — these have documented, non-secret defaults)

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `LOG_LEVEL` | Optional | — | `info` |
| `RATE_LIMIT_WINDOW_MS` | Optional | — | `900000` |
| `RATE_LIMIT_MAX` | Optional | — | `300` |
| `AUTH_RATE_LIMIT_MAX` | Optional | — | `10` |

---

## ONE-TIME DATA MIGRATION TOOL  (./migrations/import)

Only needed when running the migration tool. The tool refuses to run without these rather than guessing — it is the one place where a wrong assumption is expensive to undo.

| Setting | Requirement | What it is for | Example |
|---|---|---|---|
| `MIGRATION_SOURCE_FILE` | Conditional | The District's export of their current records (.csv or .xlsx). | `./migrations/import/samples/legacy-export.csv` |
| `MIGRATION_MAPPING_FILE` | Conditional | Which field mapping to use. Edit the mapping file, not the code, when the District's export columns differ from what is expected. | `./migrations/import/mappings/legacy-land-tracker.json` |
| `MIGRATION_STAGING_DB_NAME` | Conditional | The practice area. A dry run writes here and NEVER touches the real database, so staff can review the comparison report before anything becomes official. | `lams_migration_staging` |
| `MIGRATION_REPORT_DIR` | Conditional | Where the comparison report is written. | `./migrations/import/reports` |
| `MIGRATION_BATCH_LABEL` | Conditional | Label stamped on every imported record so a batch can be identified or undone. | `initial-load` |

---

_Generated from `.env.example` by `npm run docs:env`._
