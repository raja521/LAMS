# Before this goes live — things that still need confirming with the District

This is the honest list. Everything below is **built and working against the
assumptions written here**, but each assumption was made without access to the
District's actual system, and needs a real-world check before go-live. Nothing in
this list is a gap in the code; it is a gap in what could be verified.

Nothing here blocks the application from running. All of it is configuration and
confirmation work, and each item names exactly who needs to answer it.

---

## 1. AccuFund — the financial system

**What was assumed.** A live, always-on API was not confirmed to be available, so
this was built as a **scheduled file transfer**: LAMS writes a CSV of purchase-order
activity into an outbound directory on a cron schedule, and reads response files
the finance team drops into an inbound directory.

**What needs confirming — with the District's finance team:**

- Is a file exchange actually how they want to work, or does AccuFund expose an
  API after all? If an API exists, the connector's `runExport`/`runImport` are the
  only two methods that change; nothing else in LAMS is affected.
- **The column layout of the export is a guess.** LAMS currently writes
  `FUND_CODE, PO_NUMBER, CONTRACT_NUMBER, VENDOR, PARCEL_ID, DESCRIPTION, STATUS,
  AMOUNT, AMOUNT_INVOICED, AMOUNT_PAID, ISSUED_ON, DUE_ON, LAMS_ID`. AccuFund's
  actual import format needs to be supplied and the column list matched to it.
- What value belongs in `ACCUFUND_FUND_CODE`? It is currently blank.
- Where do the two directories live — a shared drive, an SFTP mount, something
  else? The paths are configuration, but the mount has to exist and be writable
  by the account LAMS runs as.
- Is 2am/3am the right time, and the right timezone? (`ACCUFUND_EXPORT_SCHEDULE`,
  `ACCUFUND_IMPORT_SCHEDULE`, `ACCUFUND_TIMEZONE`.)
- The status words AccuFund sends back are mapped onto the LAMS purchase-order
  states in `accufund.connector.js`. That mapping needs checking against their
  real vocabulary.

**Until this is confirmed:** the connector stays off
(`CONNECTOR_ACCUFUND_ENABLED=false`) and the admin screen reports it as switched
off. No financial figures flow either way.

---

## 2. ArcGIS — the mapping system

**What was assumed.** A standard ArcGIS REST feature service, queried with a
token, with the District's parcel identifier in an attribute named by
`ARCGIS_PARCEL_ID_FIELD`.

**What needs confirming — with whoever administers the District's GIS:**

- The feature service URL, and a token or API key for LAMS to use.
- Which attribute holds the parcel identifier that matches what LAMS stores.
- **Whether LAMS should be permitted to write labels back at all.** It is off by
  default (`ARCGIS_ALLOW_ATTRIBUTE_WRITE=false`). If it is allowed, the exact
  field names LAMS may write must be confirmed and listed in
  `ARCGIS_WRITABLE_FIELDS`. LAMS will never write geometry — that is enforced in
  code, not configuration, and cannot be turned on.
- Whether the service needs a named account rather than an API key, and whether
  it sits behind a firewall the application server can reach.

**Until this is confirmed:** the map runs on the sample GeoJSON in
`server/sample-data/parcels.geojson` and says so on screen. Switching over is
`CONNECTOR_ARCGIS_ENABLED=true` plus the `ARCGIS_*` settings — no code change.

---

## 3. CivicPlus — the online application intake

**What was assumed.** A REST API with `GET /forms/{id}` and
`GET /forms/{id}/submissions?since=…`, bearer-token authentication, and
submissions carrying a stable `id`.

**What needs confirming — with the District's web team or CivicPlus:**

- The base URL, an API key, and the form id for the land-sale application form.
- The real endpoint shapes. If they differ, the change is contained to
  `civicplus.connector.js`.
- **The field mapping is a guess and will almost certainly need editing.**
  `server/templates/connectors/civicplus-field-map.json` maps form fields onto
  LAMS application fields; the current names (`applicant_name`, `property_acres`,
  and so on) are placeholders. This is a text file — no developer needed — but
  someone has to supply the real field names.
- Does CivicPlus support webhooks? If so, pushing is better than polling every
  15 minutes; the webhook endpoint already exists at
  `POST /api/acquisition/intake/webhook` and is HMAC-verified.

**Until this is confirmed:** applications are created by hand or through the
simulator (`INTAKE_SOURCE=simulated`).

---

## 4. PaperVision — document storage

**What was assumed.** A searchable REST endpoint, and a URL pattern that opens a
document in a browser given its id.

**What needs confirming — with whoever administers PaperVision:**

- The base URL, an API key, and the search endpoint path.
- **The click-through URL pattern** (`PAPERVISION_DOCUMENT_URL_TEMPLATE`). The
  placeholder is `https://papervision.example.gov/view?docid={documentId}`.
- Whether staff opening a link will already be signed in to PaperVision, or
  whether they will hit a login prompt each time.

**Confirmed design decision, not an open question:** LAMS stores only a reference
and a link. Document content is never copied into the LAMS database, so
PaperVision remains the single copy of record.

---

## 5. PERCH — environmental tracking

**What was assumed.** A read-only REST endpoint that accepts a parcel identifier
and returns environmental records.

**What needs confirming — with the PERCH administrator:**

- Base URL, API key, and the query path (`PERCH_PARCEL_QUERY_PATH`).
- **Whether PERCH keys on the same parcel identifier LAMS holds.** If it uses a
  different identifier, a cross-reference will be needed — this is the item most
  likely to need extra work.
- The response shape. LAMS reads `items`/`sites`/`records` and maps a handful of
  fields; the real field names need checking.

**Confirmed design decision:** the connector has no write path at all, so LAMS
cannot alter PERCH data even by mistake.

---

## 6. The old land-tracking system

**What was assumed.** An export as CSV or Excel, with one row per parcel, and the
column names in
`server/scripts/import/mappings/legacy-land-tracker.json`.

**What needs confirming — with whoever maintains the current system:**

- **A real export.** The mapping was written against a representative sample
  (`server/scripts/import/samples/legacy-export.csv`), not the District's real file.
  The column names in the mapping file will need adjusting — that is a text edit,
  not a code change, and it is the expected first step.
- Whether one row really is one parcel, or whether parcels repeat across rows.
- What their status words mean. The mapping currently translates
  `Active/Owned/Managed → management`, `Pending → acquisition`,
  `Surplus/Sold/Disposed → disposition`. Anything unrecognised is flagged in the
  comparison report rather than guessed at.
- Whether contracts, owners and vendors in the export are the authoritative list
  or a partial one.

**The process is deliberately two-stage:** `npm run import:dry-run` writes only to
a practice database and produces a comparison workbook; `npm run import:apply`
touches the real database and **refuses to run while any row has an error**
unless someone passes `--force`. District staff should review the comparison
report before anyone runs the second command.

---

## 7. Sign-in

**What was decided.** LAMS holds its own accounts: email and password, bcrypt
hashed. Anyone may create an account from the sign-in screen, and a new account
is always **Read Only** — an administrator promotes it afterwards.

Microsoft Entra ID (Azure AD) sign-in was built earlier and has since been
removed at the District's request. Nothing in the codebase depends on it.

**What needs confirming — with the District:**

- **Should sign-ups stay open?** Right now anyone who reaches the address can
  create a read-only account. That grants no ability to change anything, but it
  does let an outsider see District land records. If the system will be reachable
  from the public internet, this is the setting to think hardest about. Set
  `ALLOW_REGISTRATION=false` to close it and have administrators create every
  account by hand.
- **Password policy.** The only rule enforced today is a minimum length
  (`MIN_PASSWORD_LENGTH`, 12 by default). There is no expiry, no complexity rule
  and no reuse check. Confirm whether District policy requires more.
- **Password reset.** There is no "forgot my password" flow — an administrator
  sets a new password. If self-service reset is wanted, it needs an email
  service, which the District has not yet nominated.

**Not an open question:** sign-in, sign-up and the three permission levels are
fully covered by tests, including that a sign-up cannot grant itself a higher
role.

---

## 8. Operational questions for whoever hosts this

- **Where is it hosted?** Cloud or the District's own server both work. The only
  requirements are Node.js 20+, a reachable MongoDB, and a writable directory for
  generated documents (or S3 credentials).
- **Backups of MongoDB.** LAMS does not manage them. Generated documents live in
  `STORAGE_LOCAL_PATH` (or S3) and are equally not backed up by the application.
- **Running more than one instance?** Set `SCHEDULER_ENABLED=false` on all but
  one, or the nightly transfers and monthly reports will run more than once.
- **HTTPS and reverse proxy.** The app trusts one proxy hop (`trust proxy` is 1).
  Adjust if it sits behind more.
- **The MongoDB credentials currently in `server/.env`** were supplied during
  development and have been visible in a chat transcript. **Rotate them in Atlas
  before go-live.**
- **Document retention.** Generated documents are kept indefinitely; scheduled
  report files are pruned after `REPORT_RETENTION_DAYS` (365). Confirm both
  against the District's records-retention policy.
- **Who is the first administrator?** `npm run seed` creates them from
  `SEED_ADMIN_*`. Those values should be set at deploy time and the password
  changed immediately afterwards.

---

## What is *not* an open question

These were built, exercised and verified, and need no confirmation:

- The three modules end to end — an application becomes a parcel, becomes a
  disposition case, without anyone retyping anything.
- Word document generation. Real `.docx` files, from editable JSON templates.
- Excel export on every report.
- The three permission levels, enforced server-side and covered by tests.
- The activity log, written automatically for every create, edit, delete and
  refused attempt.
- The migration tool's dry-run/compare/apply cycle, including its refusal to
  apply rows that did not map cleanly.
- That every setting comes from the environment — `npm run secrets:check`
  confirms nothing sensitive is in the code.
