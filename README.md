# LAMS — Land Acquisition and Management Software Solution

A complete working system for how the District handles land: buying it, taking
care of it, and eventually selling or transferring it — with the paperwork,
mapping, reporting and system connections that go around all three.

**Stack:** MongoDB · Express · React (Vite) · Node.js · MUI

**Companion documents**

| Document | What it is |
|---|---|
| [ENVIRONMENT.md](ENVIRONMENT.md) | Every one of the 134 settings, what it is for, and whether it is required. Generated from `.env.example`. |
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | **Read before go-live.** What still needs confirming with the District, and who needs to answer it. |

---

## Ground rule: nothing is hard-coded

Every value comes from the environment. Required settings have no fallback — the
server refuses to start and names what is missing:

```
LAMS cannot start: the environment is incomplete.

2 problems found in your environment:
  • MONGODB_URI — is required but not set. MongoDB connection string, e.g. ...
  • JWT_SECRET — is required but not set. Signing key for access tokens. ...

No default is applied for these settings by design.
```

The browser bundle does the same for its `VITE_*` values, at build time and at
runtime. Only four operational tunables carry defaults, and each is reported in
the startup log when applied — never a silent substitution.

`npm run secrets:check` confirms nothing sensitive was written into the code or
into anything that would be committed. It is expected to pass before release.

---

## Getting started

**Prerequisites:** Node.js 20+, and a reachable MongoDB (local or Atlas).

```bash
cp .env.example .env
openssl rand -base64 48      # → JWT_SECRET
openssl rand -base64 48      # → JWT_REFRESH_SECRET (must differ)

npm install
npm run env:check            # confirms the environment is complete
npm run migrate              # creates the indexes
npm run seed                 # creates the first administrator
npm run dev                  # API and front end together
```

There is no built-in default account. `npm run seed` reads `SEED_ADMIN_EMAIL`,
`SEED_ADMIN_PASSWORD`, `SEED_ADMIN_FIRST_NAME` and `SEED_ADMIN_LAST_NAME`, and
refuses to run without them.

### Deploying

Either hosting model works — cloud or the District's own server.

```bash
npm run build && npm start   # one Node process serves the API and the screens
# or
docker compose up -d         # see docker-compose.yml
```

Set `SCHEDULER_ENABLED=false` on all but one instance if you run more than one,
so the nightly transfers and monthly reports run exactly once.

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

A separate, one-time tool in `migrations/import/` — deliberately not part of the
everyday application.

```bash
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
- Field mapping is a JSON file (`migrations/import/mappings/`) — matching the
  District's real column names is a text edit, not a code change.
- A row with the wrong number of columns is rejected and reported, rather than
  shifting every later value into the wrong field.

---

## Sign-in and permissions

Exactly the three levels the District asked for.

| Level | Read | Create / edit / delete | Manage users |
|---|---|---|---|
| **Read Only** | Everything | Nothing | No |
| **Module Editor** | Everything | Only in their assigned modules | No |
| **Administrator** | Everything | Everywhere | Yes |

- **The server is the authority.** Every route is guarded; for an existing record
  the module is read from the record itself. The client's greyed-out buttons are a
  courtesy — editing them in the browser changes what is drawn and nothing else.
- **Roles are re-read on every request**, so a role change or a deactivation takes
  effect immediately rather than at token expiry.
- The sign-in screen is a Microsoft-style organizational login. Which methods it
  offers comes from `AUTH_PROVIDER` — local password, Microsoft Entra ID, or both.
- Every create, edit, delete, sign-in, failed sign-in and refused attempt is
  written to the activity log automatically by middleware, so a route handler
  cannot forget to log.

---

## Tests

```bash
npm test      # 91 tests
```

| Area | What is covered |
|---|---|
| Login | Wrong passwords, deactivated accounts, forged and stale tokens, identical responses whether or not an address exists |
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
├── client/                React front end (Vite + MUI)
│   └── src/{api,auth,components,config,layouts,pages}
├── server/
│   ├── src/
│   │   ├── config/        environment contract, permissions, database
│   │   ├── connectors/    one self-contained file per external system
│   │   ├── middleware/    authentication, permission gates, audit, errors
│   │   ├── models/        Mongoose schemas
│   │   ├── routes/        auth, the three modules, documents, gis, reports, integrations
│   │   ├── services/      documents, spreadsheets, scoring, checklists, scheduling, GIS
│   │   └── utils/
│   ├── templates/         EDITABLE CONFIG — documents, checklists, scoring, prospectus, reports
│   ├── sample-data/       sample GeoJSON, used until ArcGIS is connected
│   └── tests/
├── migrations/
│   ├── scripts/           schema migrations
│   └── import/            the one-time data migration tool
├── scripts/               secret check, environment doc generator
├── .env.example           every setting, with placeholders
└── ENVIRONMENT.md         the generated settings checklist
```

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | API and front end together |
| `npm run env:check` | Validate the environment without starting anything |
| `npm test` | The full test suite |
| `npm run build` / `npm start` | Build the front end / run in production |
| `npm run migrate` · `npm run migrate:status` | Schema migrations |
| `npm run seed` | Create the first administrator |
| `npm run import:dry-run` · `npm run import:apply` | The one-time data migration |
| `npm run secrets:check` | Confirm nothing sensitive is in the code |
| `npm run docs:env` | Regenerate `ENVIRONMENT.md` from `.env.example` |
