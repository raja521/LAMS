import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { auth, clearDatabase, createUser, setupTestApp, teardownTestApp } from './helpers/harness.js';

let app;
let admin;

const buffered = (req) =>
  req
    .buffer()
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });

describe('Connections to the District’s other systems', () => {
  before(async () => {
    app = await setupTestApp();
  });
  after(teardownTestApp);
  beforeEach(async () => {
    await clearDatabase();
    admin = await createUser({ email: 'admin@district.gov', role: 'admin' });
  });

  it('reports every connector, all switched off on a fresh install', async () => {
    const response = await request(app).get('/api/integrations').set(auth(admin.token)).expect(200);

    const ids = response.body.connectors.map((connector) => connector.id).sort();
    assert.deepEqual(ids, ['accufund', 'arcgis', 'civicplus', 'legacy', 'papervision', 'perch']);
    assert.ok(response.body.connectors.every((connector) => connector.state === 'disabled'));
    assert.equal(response.body.summary.enabled, 0);
  });

  it('says plainly what each connector is for and which way data flows', async () => {
    const response = await request(app).get('/api/integrations').set(auth(admin.token)).expect(200);
    const byId = Object.fromEntries(response.body.connectors.map((connector) => [connector.id, connector]));

    assert.equal(byId.perch.direction, 'read');
    assert.match(byId.perch.notes, /read-only/i);
    assert.match(byId.papervision.notes, /link only|never copied/i);
    assert.match(byId.arcgis.notes, /cannot change a property boundary/i);
    assert.equal(byId.legacy.direction, 'one-time');
  });

  it('refuses to use a switched-off connection rather than returning nothing', async () => {
    // An empty result would read as "there is no data", which is not the same
    // thing as "this system is not connected".
    const search = await request(app)
      .get('/api/integrations/papervision/search?q=deed')
      .set(auth(admin.token))
      .expect(400);

    assert.equal(search.body.error.code, 'CONNECTOR_DISABLED');
    assert.match(search.body.error.message, /switched off/i);
    assert.match(search.body.error.message, /CONNECTOR_PAPERVISION_ENABLED/);
  });

  it('keeps the connector admin area to administrators', async () => {
    const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });
    await request(app).get('/api/integrations').set(auth(token)).expect(403);
    await request(app).post('/api/integrations/test').set(auth(token)).expect(403);
  });

  it('reports the one-time legacy transfer as not yet done', async () => {
    const response = await request(app).post('/api/integrations/legacy/test').set(auth(admin.token)).expect(200);
    assert.match(response.body.message, /switched off/i);
  });

  it('shows which background jobs are registered', async () => {
    const response = await request(app).get('/api/integrations').set(auth(admin.token)).expect(200);
    // SCHEDULER_ENABLED is false in tests, so nothing should be registered.
    assert.equal(response.body.schedules.enabled, false);
    assert.deepEqual(response.body.schedules.jobs, []);
  });
});

describe('The map falls back honestly', () => {
  before(async () => {
    app = await setupTestApp();
  });
  after(teardownTestApp);
  beforeEach(async () => {
    await clearDatabase();
    admin = await createUser({ email: 'admin@district.gov', role: 'admin' });
  });

  it('says it is using sample data while ArcGIS is switched off', async () => {
    const response = await request(app).get('/api/gis/status').set(auth(admin.token)).expect(200);

    assert.equal(response.body.provider, 'sample');
    assert.equal(response.body.live, false);
    assert.match(response.body.message, /sample map data/i);
  });

  it('refuses a label write-back when ArcGIS is not connected', async () => {
    const { Parcel } = await import('../src/models/index.js');
    const parcel = await Parcel.create({
      parcelId: 'P-LABEL-1',
      name: 'Label Test',
      region: 'North',
      county: 'Example',
      area: { value: 10, unit: 'acres' },
      status: 'management',
    });

    const response = await request(app)
      .post(`/api/integrations/arcgis/parcels/${parcel._id}/label`)
      .set(auth(admin.token))
      .expect(400);

    assert.match(response.body.error.message, /ArcGIS connection switched on and configured/i);
  });
});

describe('Reporting', () => {
  before(async () => {
    app = await setupTestApp();
  });
  after(teardownTestApp);
  beforeEach(async () => {
    await clearDatabase();
    admin = await createUser({ email: 'admin@district.gov', role: 'admin' });
  });

  async function seedParcels() {
    const { Parcel } = await import('../src/models/index.js');
    await Parcel.create([
      {
        parcelId: 'P-N-1',
        name: 'North One',
        region: 'North',
        county: 'Hennepin',
        area: { value: 100, unit: 'acres' },
        status: 'management',
        acquiredOn: new Date('2026-02-01'),
      },
      {
        parcelId: 'P-S-1',
        name: 'South One',
        region: 'South',
        county: 'Dakota',
        area: { value: 50, unit: 'acres' },
        status: 'management',
        acquiredOn: new Date('2026-06-01'),
      },
    ]);
  }

  it('lists the reports and the values the filter controls should offer', async () => {
    await seedParcels();
    const response = await request(app).get('/api/reports').set(auth(admin.token)).expect(200);

    const ids = response.body.items.map((item) => item.id);
    assert.ok(ids.includes('land-holdings'));
    assert.ok(ids.includes('encumbrance-summary'));
    assert.deepEqual(response.body.filterOptions.regions.sort(), ['North', 'South']);
    assert.deepEqual(response.body.filterOptions.counties.sort(), ['Dakota', 'Hennepin']);
  });

  it('returns real figures, not placeholders', async () => {
    await seedParcels();
    const response = await request(app).get('/api/reports/land-holdings').set(auth(admin.token)).expect(200);

    assert.equal(response.body.rowCount, 2);
    assert.equal(response.body.totals.acres, 150);
    assert.equal(response.body.rows[0].parcelId, 'P-N-1');
  });

  it('filters by region, county and date range', async () => {
    await seedParcels();

    const byRegion = await request(app).get('/api/reports/land-holdings?region=North').set(auth(admin.token)).expect(200);
    assert.equal(byRegion.body.rowCount, 1);
    assert.equal(byRegion.body.totals.acres, 100);

    const byCounty = await request(app).get('/api/reports/land-holdings?county=Dakota').set(auth(admin.token)).expect(200);
    assert.equal(byCounty.body.rowCount, 1);

    const byDate = await request(app)
      .get('/api/reports/land-holdings?dateFrom=2026-05-01&dateTo=2026-12-31')
      .set(auth(admin.token))
      .expect(200);
    assert.equal(byDate.body.rowCount, 1);
    assert.equal(byDate.body.rows[0].parcelId, 'P-S-1');
  });

  it('exports a real Excel workbook', async () => {
    await seedParcels();

    const response = await buffered(
      request(app).get('/api/reports/land-holdings/export').set(auth(admin.token))
    ).expect(200);

    assert.equal(
      response.headers['content-type'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    assert.match(response.headers['content-disposition'], /\.xlsx"$/);
    assert.equal(response.body.subarray(0, 2).toString('utf8'), 'PK', 'the file is a zip package');
    assert.ok(response.body.includes(Buffer.from('xl/worksheets/sheet1.xml')), 'it contains a worksheet');
    // The filters used are written into the sheet so a printed copy explains itself.
    assert.ok(response.body.length > 3000);
  });

  it('records every export so a figure can be traced back to when it was produced', async () => {
    await seedParcels();
    await buffered(request(app).get('/api/reports/land-holdings/export?region=North').set(auth(admin.token))).expect(200);

    const runs = await request(app).get('/api/reports/runs').set(auth(admin.token)).expect(200);
    assert.equal(runs.body.items.length, 1);
    assert.equal(runs.body.items[0].reportId, 'land-holdings');
    assert.equal(runs.body.items[0].rowCount, 1);
    assert.deepEqual(runs.body.items[0].filters, { region: 'North' });
  });

  it('names an unknown report rather than returning an empty one', async () => {
    const response = await request(app).get('/api/reports/not-a-report').set(auth(admin.token)).expect(404);
    assert.match(response.body.error.message, /No reports template named "not-a-report"/i);
  });

  it('lets a Read Only user run and export reports, but not the scheduled bundle', async () => {
    await seedParcels();
    const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });

    await request(app).get('/api/reports/land-holdings').set(auth(token)).expect(200);
    await buffered(request(app).get('/api/reports/land-holdings/export').set(auth(token))).expect(200);
    await request(app).post('/api/reports/scheduled/run').set(auth(token)).expect(403);
  });

  it('requires a signed-in user', async () => {
    await request(app).get('/api/reports').expect(401);
    await request(app).get('/api/reports/land-holdings').expect(401);
  });
});
