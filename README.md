# LAMS — Land Acquisition and Management Software Solution

A complete working system for how the District handles land: buying it, taking
care of it, and eventually selling or transferring it — with the paperwork,
mapping, reporting and system connections that go around all three.

**Stack:** MongoDB · Express · React (Vite) · Node.js · MUI

Two independent projects, each with its own dependencies and its own `.env`:

| Folder | What it is | Runs on |
|---|---|---|
| [`server/`](server/) | The API, the database models, and the one-time data tools | Node.js, port 4000 |
| [`client/`](client/) | The React screens | Vite, port 5173 |

They are not linked by a workspace or a build step — the client simply calls the
API over HTTP, which means each can be deployed on its own.

**Before go-live:** read [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) — what still needs
confirming with the District, and who needs to answer it.

---

## Ground rule: nothing is hard-coded

Every value comes from the environment. Only the settings that genuinely cannot
be guessed are required:

| Project | Required | Everything else |
|---|---|---|
| `server/` | `MONGODB_URI`, `JWT_SECRET`, `JWT_REFRESH_SECRET` | Has a working default |
| `client/` | `VITE_API_BASE_URL` | Has a working default |

Miss one and the server refuses to start, naming it:

```
LAMS cannot start: the environment is incomplete.

1 problem found in your environment:
  • MONGODB_URI — is required but not set. MongoDB connection string, e.g. ...
```

Every default that gets applied is counted in the startup log and listed by
`npm run env:check`, so a default is never a silent substitution. Both
`.env.example` files document every setting with its default.

`npm run secrets:check` (in `server/`) confirms nothing sensitive was written
into the code or into anything that would be committed, across both projects.

---

## Getting started

**Prerequisites:** Node.js 20+, and a reachable MongoDB — either a local
`mongod`, or a free MongoDB Atlas cluster. Tests need neither; they start their
own in-memory MongoDB.

Open two terminals.

**Terminal 1 — the API**

```bash
cd server
cp .env.example .env        # then set MONGODB_URI and the two JWT secrets
npm install
npm run env:check           # confirms the settings before starting anything
npm run migrate             # create the database indexes
npm run dev                 # http://localhost:4000
```

Generate the two signing keys with `openssl rand -base64 48`, run twice. They
must differ from each other.

**Terminal 2 — the screens**

```bash
cd client
cp .env.example .env        # the default points at http://localhost:4000/api
npm install
npm run dev                 # http://localhost:5173
```

Then open http://localhost:5173 and **Create an account**. The first account —
like every self-created account — is read-only. To get an administrator:

```bash
cd server
SEED_ADMIN_EMAIL=you@example.gov SEED_ADMIN_PASSWORD='a-long-passphrase' \
  SEED_ADMIN_FIRST_NAME=Ada SEED_ADMIN_LAST_NAME=Lovelace npm run seed
```

### Deploying

The two folders deploy as two separate services — a Node web service for
`server/`, and a static site for `client/` (its `npm run build` output in
`client/dist`). Three settings tie them together:

| Where | Setting | Value |
|---|---|---|
| `client` | `VITE_API_BASE_URL` | The API's public address **+ `/api`** |
| `server` | `CORS_ORIGINS` | The client's public address, comma-separated for several |
| `server` | `NODE_ENV` | `production` |

`VITE_*` values are compiled into the JavaScript at build time, so changing one
means rebuilding the client — restarting is not enough. The API exposes
`/api/health` for a platform health check.

Documents and generated reports are written to disk (`server/uploads`,
`server/reports`), so a host with an ephemeral filesystem needs a persistent disk
mounted there — or `STORAGE_PROVIDER=s3`.

---

## What is in it

### The three modules

**Acquisition** — a queue of applications to sell land to the District, each
given a file number automatically on arrival. A prospectus builder (site
inspection, program plan, rough cost estimate) built from a reusable template. A
weighted scoring sheet that produces a ranked list, and one click that turns it
into a real Word memo for the committee. A pre-closing checklist covering
appraisals, environmental assessments, surveys and contracts. A **Move this
along** button that carries a completed purchase into Land Management.

**Management** — a multi-year planning grid organised by program area and tied to
specific parcels. A task scheduler covering boundary upkeep, vegetation
management, road and ditch maintenance, invasive-species control, rare-species
monitoring and facility repairs, with every task joined to its parcel, contract
and purchase order. A dedicated timber section: pre-harvest meetings, sales,
inspections, load tickets, standing inventory and reforestation planning. The
same document engine, reused. A **Move this along** action into Disposition.

**Disposition** — an evaluation workflow with the same map overview, the same
scoring and approval shape as acquisition, the same closing-checklist engine, and
a board memo that pulls in the management history carried across with the case.

### The two features that tie it together

**Document generation** — one engine for all three modules, producing genuine,
editable `.docx` files. Templates are plain JSON under `server/templates/documents/`:
changing the wording or layout of a memo is a file edit, not a development task.

**The map** — used across all three modules. Geometry is served through one
interface with two sources behind it: a local sample file, or the District's live
ArcGIS service. Switching over is `CONNECTOR_ARCGIS_ENABLED=true` plus the
`ARCGIS_*` settings; no part of the map feature is rebuilt.

### Connections to the District's other systems

Each is self-contained and **off unless switched on**. Turning one on makes its
own settings required, so a half-configured connection is refused at boot rather
than failing quietly later. Administration → Integrations reports every one of
them plainly — off, configured, reachable, or broken — and calling into a
connector that is off raises a clear error rather than returning empty data that
would read as "there is nothing there".

| System | How it connects | Notes |
|---|---|---|
| **ArcGIS** | Live, read + label write-back | Reads geometry. Writes labels and associations only — **LAMS cannot change a property boundary**, enforced in code, not configuration. |
| **AccuFund** | Scheduled file transfer | A live API was not confirmed available, so this writes a CSV nightly and reads response files back. Schedules and directories are configuration. |
| **CivicPlus** | Scheduled pull, or webhook | New applications flow in automatically. Field mapping lives in an editable JSON file. |
| **PaperVision** | Link only | Documents are **never copied** into LAMS — only a reference and a click-through link. |
| **PERCH** | Read-only | The connector has no write path at all, so LAMS cannot alter PERCH data. |
| **Legacy land tracker** | One-time transfer | Not a live connection — see the migration tool below. |

### Reporting

Nine reports over real data, all sharing one screen and one set of filters —
property, region, county, program, status and date range. Every view has a
one-click **Export to Excel** producing a real `.xlsx`. A monthly bundle runs on a
schedule and can also be produced on demand. Report definitions are editable JSON
under `server/templates/reports/`.

### Bringing the District's existing data across

A separate, one-time tool in `server/scripts/import/` — deliberately not part of the
everyday application.

```bash
cd server
npm run import:dry-run    # writes to the practice database, produces the comparison report
npm run import:apply      # the real database, only after the report is approved
```

- The dry run **never touches the real database**.
- The comparison workbook has four tabs: a summary, a row-by-row check of every
  source row against what now exists, every issue that needs a decision, and
  every value that was adjusted on the way through (dates parsed, statuses
  translated, defaults applied).
- `--apply` **refuses to run** while any row has an error, unless `--force`.
- Every record keeps its original identifier under `legacy.id`, so anything can
  be traced back to where it came from.
- Field mapping is a JSON file (`server/scripts/import/mappings/`) — matching the
  District's real column names is a text edit, not a code change.
- A row with the wrong number of columns is rejected and reported, rather than
  shifting every later value into the wrong field.

---

## Sign-in and permissions

Anyone can create an account from the sign-in screen. A new account is always
**Read Only** — signing up grants no ability to change anything, and an
administrator promotes it afterwards. Set `ALLOW_REGISTRATION=false` to close
sign-ups entirely and create every account by hand instead.

| Level | Read | Create / edit / delete | Manage users |
|---|---|---|---|
| **Read Only** | Everything | Nothing | No |
| **Module Editor** | Everything | Only in their assigned modules | No |
| **Administrator** | Everything | Everywhere | Yes |

- **The server is the authority.** Every route is guarded; for an existing record
  the module is read from the record itself. The client's greyed-out buttons are a
  courtesy — editing them in the browser changes what is drawn and nothing else.
- The sign-up form fixes the new account's role in code rather than reading it
  from `DEFAULT_USER_ROLE`, so the setting can never turn the public form into a
  way of granting yourself the run of the system. A `role` sent in the request is
  ignored.
- **Roles are re-read on every request**, so a role change or a deactivation takes
  effect immediately rather than at token expiry.
- Sign-in is email and password, held by LAMS. Passwords are bcrypt-hashed and
  the hash is never returned by the API.
- Every account created, create, edit, delete, sign-in, failed sign-in and refused
  attempt is written to the activity log automatically by middleware, so a route
  handler cannot forget to log.

---

## Tests

```bash
cd server && npm test      # 99 tests
```

No database is required — the suite starts its own in-memory MongoDB.

| Area | What is covered |
|---|---|
| Login | Wrong passwords, deactivated accounts, forged and stale tokens, identical responses whether or not an address exists |
| Sign-up | A new account is created and signed in; it lands on Read Only; a request smuggling `role: admin` still produces a read-only account and is refused from the admin area; duplicate addresses and short passwords rejected |
| Permissions | Each of the three levels against each of the three modules, with data verified unchanged after a refused write |
| Document generation | That the output is a real Word file — a zip package containing `word/document.xml` — filled from the record, not hard-coded |
| Reference numbering | Format, and that concurrent submissions never receive the same number |
| Scoring and ranking | Weighted totals, rank ordering, rejection of unknown criteria and out-of-range scores |
| Move this along | Refusal when unapproved or while paperwork is outstanding; data carried across without retyping; no duplicate on a second attempt |
| The migration tool | Date and number formats found in real exports, status translation, malformed rows, missing columns, fallbacks |
| Connectors | Every one off on a fresh install; a switched-off connector refuses rather than returning empty data |
| Reporting | Real figures, filters, Excel output, and that a Read Only user can export but not run the scheduled bundle |
| **End to end** | One property walked through all three modules — application → scored → memo → parcel → contract, PO and tasks → timber → disposition case → approval → board memo → reports → dashboard |

---

## Project structure

```
LAMS/
├── client/                    React front end (Vite + MUI)
│   ├── .env.example
│   ├── package.json
│   └── src/{api,auth,components,config,layouts,pages}
│
├── server/
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── config/            environment contract, permissions, database
│   │   ├── connectors/        one self-contained file per external system
│   │   ├── middleware/        authentication, permission gates, audit, errors
│   │   ├── models/            Mongoose schemas
│   │   ├── routes/            auth, the three modules, documents, gis, reports, integrations
│   │   ├── services/          documents, spreadsheets, scoring, checklists, scheduling, GIS
│   │   └── utils/
│   ├── templates/             EDITABLE CONFIG — documents, checklists, scoring, prospectus, reports
│   ├── sample-data/           sample GeoJSON, used until ArcGIS is connected
│   ├── scripts/
│   │   ├── migrate.js         schema migration runner
│   │   ├── seed.js            create the first administrator
│   │   ├── check-secrets.js   pre-release check, covers both projects
│   │   ├── migrations/        the migration steps themselves
│   │   └── import/            the one-time legacy data tool
│   └── tests/
│
└── OPEN-QUESTIONS.md
```

Paths inside `server/.env` resolve against the `server/` folder, so they do not
depend on which directory you started node from.

---

## Commands

Run in `server/`:

| Command | Does |
|---|---|
| `npm run dev` / `npm start` | The API, with / without file watching |
| `npm run env:check` | Validate the settings without starting anything |
| `npm test` | The full test suite |
| `npm run migrate` · `npm run migrate:status` | Schema migrations |
| `npm run seed` | Create the first administrator |
| `npm run import:dry-run` · `npm run import:apply` | The one-time data migration |
| `npm run secrets:check` | Confirm nothing sensitive is in the code |

Run in `client/`:

| Command | Does |
|---|---|
| `npm run dev` | The screens, with hot reload |
| `npm run build` | Production bundle into `client/dist` |
| `npm run preview` | Serve the built bundle locally |
