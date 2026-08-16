import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { auth, clearDatabase, createUser, setupTestApp, teardownTestApp } from './helpers/harness.js';

/**
 * The "click through the whole thing" test.
 *
 * One property walks the entire system — arriving as an application, being
 * scored, becoming a memo, moving into management, gaining work and money,
 * moving into disposition, being approved — and then a report is checked.
 *
 * If a future change breaks the join between two modules, this is the test that
 * says so first. The steps run in order and share state deliberately.
 */
let app;
let admin;
const state = {};

describe('End to end: one property through the whole system', () => {
  before(async () => {
    app = await setupTestApp();
    await clearDatabase();
    admin = await createUser({ email: 'admin@district.gov', role: 'admin', password: 'a-long-test-passphrase' });
  });
  after(teardownTestApp);

  it('1. signs in and reports the permissions that were granted', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@district.gov', password: 'a-long-test-passphrase' })
      .expect(200);

    state.token = response.body.accessToken;
    assert.ok(state.token);
    assert.equal(response.body.capabilities.canManageUsers, true);
  });

  it('2. receives an application and gives it a file number automatically', async () => {
    const response = await request(app)
      .post('/api/acquisition/intake/simulate')
      .set(auth(state.token))
      .send({ count: 1 })
      .expect(201);

    state.application = response.body.applications[0];
    assert.match(state.application.fileNumber, /^LA-\d{4}-\d{5}$/);
    assert.ok(state.application.property.county);
  });

  it('3. builds a prospectus from the template', async () => {
    const response = await request(app)
      .post(`/api/acquisition/applications/${state.application._id}/prospectus`)
      .set(auth(state.token))
      .send({})
      .expect(201);

    state.prospectus = response.body.prospectus;
    assert.ok(response.body.template.sections.length > 0);
    assert.ok(state.prospectus.costEstimate.lines.length > 0, 'cost lines are seeded from the template');
  });

  it('4. scores it and produces a ranking', async () => {
    const template = await request(app)
      .get('/api/acquisition/scoring-template/acquisition-ranking')
      .set(auth(state.token))
      .expect(200);

    const scores = template.body.criteria.map((criterion) => ({ criterionId: criterion.id, score: 4 }));
    const response = await request(app)
      .put(`/api/acquisition/applications/${state.application._id}/scores`)
      .set(auth(state.token))
      .send({ scores, recommendation: 'recommend', recommendationNotes: 'Recommended.' })
      .expect(200);

    assert.equal(response.body.rank, 1);
    assert.ok(response.body.normalizedScore > 0);
    state.evaluation = response.body;
  });

  it('5. generates a real Word memo from the ranking', async () => {
    const response = await request(app)
      .post(`/api/acquisition/applications/${state.application._id}/documents`)
      .set(auth(state.token))
      .send({ template: 'acquisition-ranking-memo' })
      .expect(201);

    state.memo = response.body;
    assert.match(state.memo.documentNumber, /^DOC-\d{4}-\d{5}$/);

    const download = await request(app)
      .get(`/api/documents/${state.memo._id}/download`)
      .set(auth(state.token))
      .expect(200)
      .buffer()
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(download.body.subarray(0, 2).toString('utf8'), 'PK');
    assert.ok(download.body.includes(Buffer.from('word/document.xml')));
  });

  it('6. works the closing checklist and moves the property into management', async () => {
    await request(app)
      .patch(`/api/acquisition/applications/${state.application._id}`)
      .set(auth(state.token))
      .send({ status: 'approved' })
      .expect(200);

    const created = await request(app)
      .post(`/api/acquisition/applications/${state.application._id}/checklists`)
      .set(auth(state.token))
      .send({})
      .expect(201);

    for (const item of created.body[0].items) {
      await request(app)
        .patch(`/api/acquisition/checklist-items/${item._id}`)
        .set(auth(state.token))
        .send({ status: item.required ? 'complete' : 'not_applicable' })
        .expect(200);
    }

    const advanced = await request(app)
      .post(`/api/acquisition/applications/${state.application._id}/advance`)
      .set(auth(state.token))
      .expect(201);

    state.parcel = advanced.body.parcel;
    assert.equal(state.parcel.status, 'management');
    assert.equal(state.parcel.county, state.application.property.county, 'nothing was retyped');
  });

  it('7. schedules work against a contract and a purchase order', async () => {
    const contract = await request(app)
      .post('/api/management/contracts')
      .set(auth(state.token))
      .send({ title: 'Stewardship', status: 'active', parcels: [state.parcel._id], value: { amount: 20000 } })
      .expect(201);

    const purchaseOrder = await request(app)
      .post('/api/management/purchase-orders')
      .set(auth(state.token))
      .send({ contract: contract.body._id, parcel: state.parcel._id, amount: { value: 8000 }, status: 'issued' })
      .expect(201);

    const task = await request(app)
      .post('/api/management/tasks')
      .set(auth(state.token))
      .send({
        title: 'Boundary maintenance',
        taskType: 'boundary_maintenance',
        parcel: state.parcel._id,
        contract: contract.body._id,
        purchaseOrder: purchaseOrder.body._id,
        scheduledStart: '2026-05-01',
        estimatedCost: 4200,
      })
      .expect(201);

    state.contract = contract.body;
    state.purchaseOrder = purchaseOrder.body;
    state.task = task.body;

    assert.match(state.contract.contractNumber, /^CT-/);
    assert.match(state.purchaseOrder.poNumber, /^PO-/);
    assert.equal(String(state.task.contract), String(state.contract._id), 'the task is joined to the money');
  });

  it('8. records timber work on the property', async () => {
    const sale = await request(app)
      .post('/api/management/timber')
      .set(auth(state.token))
      .send({
        activityType: 'timber_sale',
        title: 'Thinning',
        parcel: state.parcel._id,
        sale: { saleNumber: 'TS-1', acres: 20, estimatedVolume: 400, volumeUnit: 'cords' },
      })
      .expect(201);

    await request(app)
      .post(`/api/management/timber/${sale.body._id}/loads`)
      .set(auth(state.token))
      .send({ ticketNumber: 'T-1', haulDate: '2026-07-01', volume: 30, value: 2200 })
      .expect(201);

    const listed = await request(app)
      .get(`/api/management/timber?parcel=${state.parcel._id}`)
      .set(auth(state.token))
      .expect(200);

    assert.equal(listed.body.items[0].loads.length, 1);
  });

  it('9. moves the property into disposition, carrying its history', async () => {
    const response = await request(app)
      .post(`/api/management/parcels/${state.parcel._id}/advance`)
      .set(auth(state.token))
      .send({ reason: 'No longer serves a program.', method: 'sale' })
      .expect(201);

    state.dispositionCase = response.body.dispositionCase;
    assert.match(state.dispositionCase.caseNumber, /^LD-/);
    assert.equal(response.body.carried.contracts, 1);
    assert.equal(response.body.carried.tasks, 1);
  });

  it('10. evaluates, approves and produces the board memo', async () => {
    const template = await request(app)
      .get('/api/acquisition/scoring-template/disposition-evaluation')
      .set(auth(state.token))
      .expect(200);

    await request(app)
      .put(`/api/disposition/cases/${state.dispositionCase._id}/scores`)
      .set(auth(state.token))
      .send({
        scores: template.body.criteria.map((criterion) => ({ criterionId: criterion.id, score: 4 })),
        recommendation: 'recommend',
      })
      .expect(200);

    const approved = await request(app)
      .post(`/api/disposition/cases/${state.dispositionCase._id}/approve`)
      .set(auth(state.token))
      .send({ approved: true })
      .expect(200);

    assert.equal(approved.body.dispositionCase.status, 'approved');

    const memo = await request(app)
      .post(`/api/disposition/cases/${state.dispositionCase._id}/documents`)
      .set(auth(state.token))
      .send({ template: 'disposition-recommendation-memo' })
      .expect(201);

    assert.equal(memo.body.documentType, 'memo');
    assert.equal(memo.body.module, 'disposition');
  });

  it('11. shows the property and its work in the reports', async () => {
    const holdings = await request(app).get('/api/reports/land-holdings').set(auth(state.token)).expect(200);
    assert.ok(holdings.body.rows.some((row) => row.parcelId === state.parcel.parcelId));

    const maintenance = await request(app).get('/api/reports/maintenance-schedule').set(auth(state.token)).expect(200);
    assert.equal(maintenance.body.rowCount, 1);
    assert.equal(maintenance.body.rows[0].contractNumber, state.contract.contractNumber);
    assert.equal(maintenance.body.rows[0].poNumber, state.purchaseOrder.poNumber);

    const documents = await request(app).get('/api/reports/document-log').set(auth(state.token)).expect(200);
    assert.equal(documents.body.rowCount, 2, 'the acquisition memo and the disposition memo');

    const dispositions = await request(app).get('/api/reports/disposition-activity').set(auth(state.token)).expect(200);
    assert.equal(dispositions.body.rows[0].caseNumber, state.dispositionCase.caseNumber);
  });

  it('12. exports a report to Excel', async () => {
    const response = await request(app)
      .get('/api/reports/maintenance-schedule/export')
      .set(auth(state.token))
      .expect(200)
      .buffer()
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    assert.equal(response.body.subarray(0, 2).toString('utf8'), 'PK');
  });

  it('13. shows the whole journey on the dashboard and in the activity log', async () => {
    const summary = await request(app).get('/api/dashboard/summary').set(auth(state.token)).expect(200);
    assert.equal(summary.body.parcels.total, 1);
    assert.equal(summary.body.dispositions.open, 1);
    assert.equal(summary.body.documents.generated, 2);

    const activity = await request(app).get('/api/activity?limit=200').set(auth(state.token)).expect(200);
    const summaries = activity.body.items.map((entry) => entry.summary ?? '').join(' | ');

    assert.match(summaries, new RegExp(state.application.fileNumber), 'the application appears');
    assert.match(summaries, new RegExp(state.parcel.parcelId), 'the parcel appears');
    assert.match(summaries, /Generated/, 'document generation was recorded');
  });
});
