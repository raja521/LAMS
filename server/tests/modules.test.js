import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { auth, clearDatabase, createUser, setupTestApp, teardownTestApp } from './helpers/harness.js';

let app;
let admin;

/** Walk far enough into acquisition to have something to move along. */
async function seedApplication(token) {
  const { body } = await request(app).post('/api/acquisition/intake/simulate').set(auth(token)).send({ count: 1 });
  return body.applications[0];
}

describe('The three modules', () => {
  before(async () => {
    app = await setupTestApp();
  });
  after(teardownTestApp);

  beforeEach(async () => {
    await clearDatabase();
    admin = await createUser({ email: 'admin@district.gov', role: 'admin' });
  });

  describe('Automatic reference numbering', () => {
    it('assigns a file number on arrival, in the configured format', async () => {
      const application = await seedApplication(admin.token);
      const year = new Date().getFullYear();

      assert.match(application.fileNumber, new RegExp(`^LA-${year}-\\d{5}$`));
    });

    it('never hands the same number to two simultaneous submissions', async () => {
      // Six sample features exist; request them all at once.
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(app).post('/api/acquisition/intake/simulate').set(auth(admin.token)).send({ count: 1 })
        )
      );

      const fileNumbers = responses
        .filter((r) => r.status === 201)
        .flatMap((r) => r.body.applications.map((a) => a.fileNumber));

      assert.ok(fileNumbers.length >= 2, 'several applications were created');
      assert.equal(new Set(fileNumbers).size, fileNumbers.length, 'every file number is distinct');
    });

    it('numbers contracts and purchase orders without anyone typing one', async () => {
      const contract = await request(app)
        .post('/api/management/contracts')
        .set(auth(admin.token))
        .send({ title: 'Mowing 2026', module: 'management' })
        .expect(201);

      const purchaseOrder = await request(app)
        .post('/api/management/purchase-orders')
        .set(auth(admin.token))
        .send({ contract: contract.body._id, amount: { value: 1000 } })
        .expect(201);

      assert.match(contract.body.contractNumber, /^CT-\d{4}-\d{5}$/);
      assert.match(purchaseOrder.body.poNumber, /^PO-\d{4}-\d{5}$/);
    });
  });

  describe('Document generation', () => {
    it('produces a real Word file, not a picture or a PDF', async () => {
      const application = await seedApplication(admin.token);

      const generated = await request(app)
        .post(`/api/acquisition/applications/${application._id}/documents`)
        .set(auth(admin.token))
        .send({ template: 'acquisition-ranking-memo' })
        .expect(201);

      const download = await request(app)
        .get(`/api/documents/${generated.body._id}/download`)
        .set(auth(admin.token))
        .expect(200)
        .buffer()
        .parse((res, callback) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      assert.equal(
        download.headers['content-type'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      assert.match(download.headers['content-disposition'], /\.docx"$/);

      // A .docx is a zip: it starts with "PK" and contains word/document.xml.
      assert.equal(download.body.subarray(0, 2).toString('utf8'), 'PK', 'the file is a zip package');
      assert.ok(download.body.includes(Buffer.from('word/document.xml')), 'it contains a Word document part');
      assert.ok(download.body.length > 5000, 'it has real content');
    });

    it('fills the template from the record rather than from hard-coded text', async () => {
      const application = await seedApplication(admin.token);

      const generated = await request(app)
        .post(`/api/acquisition/applications/${application._id}/documents`)
        .set(auth(admin.token))
        .send({ template: 'acquisition-ranking-memo' })
        .expect(201);

      assert.match(generated.body.title, new RegExp(application.fileNumber));
      assert.match(generated.body.documentNumber, /^DOC-\d{4}-\d{5}$/);
      assert.equal(generated.body.template, 'acquisition-ranking-memo');
      assert.equal(generated.body.module, 'acquisition');
    });

    it('refuses a template that does not exist, naming what is missing', async () => {
      const application = await seedApplication(admin.token);

      const response = await request(app)
        .post(`/api/acquisition/applications/${application._id}/documents`)
        .set(auth(admin.token))
        .send({ template: 'not-a-real-template' })
        .expect(404);

      assert.match(response.body.error.message, /no documents template named "not-a-real-template"/i);
    });

    it('lists only the templates belonging to a module', async () => {
      const response = await request(app)
        .get('/api/documents/templates?module=disposition')
        .set(auth(admin.token))
        .expect(200);

      assert.ok(response.body.items.length > 0);
      assert.ok(response.body.items.every((template) => template.module === 'disposition'));
    });
  });

  describe('Scoring and ranking', () => {
    it('rejects a criterion that is not in the template', async () => {
      const application = await seedApplication(admin.token);

      const response = await request(app)
        .put(`/api/acquisition/applications/${application._id}/scores`)
        .set(auth(admin.token))
        .send({ scores: [{ criterionId: 'invented-criterion', score: 5 }] })
        .expect(400);

      assert.match(response.body.error.message, /not a criterion/i);
    });

    it('rejects a score outside the range the criterion allows', async () => {
      const application = await seedApplication(admin.token);

      await request(app)
        .put(`/api/acquisition/applications/${application._id}/scores`)
        .set(auth(admin.token))
        .send({ scores: [{ criterionId: 'resource-value', score: 99 }] })
        .expect(400);
    });

    it('ranks properties by weighted result, highest first', async () => {
      const strong = await seedApplication(admin.token);
      const weak = await seedApplication(admin.token);

      const score = (value) => [
        { criterionId: 'resource-value', score: value },
        { criterionId: 'program-fit', score: value },
      ];

      await request(app)
        .put(`/api/acquisition/applications/${strong._id}/scores`)
        .set(auth(admin.token))
        .send({ scores: score(5) })
        .expect(200);

      await request(app)
        .put(`/api/acquisition/applications/${weak._id}/scores`)
        .set(auth(admin.token))
        .send({ scores: score(1) })
        .expect(200);

      const ranking = await request(app).get('/api/acquisition/ranking').set(auth(admin.token)).expect(200);

      assert.equal(ranking.body.items[0].application.fileNumber, strong.fileNumber);
      assert.equal(ranking.body.items[0].evaluation.rank, 1);
      assert.equal(ranking.body.items[1].evaluation.rank, 2);
      assert.ok(ranking.body.items[0].evaluation.normalizedScore > ranking.body.items[1].evaluation.normalizedScore);
    });
  });

  describe('Move this along', () => {
    it('refuses to move an application that has not been approved', async () => {
      const application = await seedApplication(admin.token);

      const response = await request(app)
        .post(`/api/acquisition/applications/${application._id}/advance`)
        .set(auth(admin.token))
        .expect(400);

      assert.match(response.body.error.message, /only an approved application/i);
    });

    it('refuses while required checklist items are outstanding', async () => {
      const application = await seedApplication(admin.token);

      await request(app)
        .patch(`/api/acquisition/applications/${application._id}`)
        .set(auth(admin.token))
        .send({ status: 'approved' })
        .expect(200);
      await request(app)
        .post(`/api/acquisition/applications/${application._id}/checklists`)
        .set(auth(admin.token))
        .send({})
        .expect(201);

      const response = await request(app)
        .post(`/api/acquisition/applications/${application._id}/advance`)
        .set(auth(admin.token))
        .expect(400);

      assert.match(response.body.error.message, /required item/i);
      assert.ok(response.body.error.details.outstanding.length > 0);
    });

    it('carries the property forward into management without retyping it', async () => {
      const application = await seedApplication(admin.token);

      await request(app)
        .patch(`/api/acquisition/applications/${application._id}`)
        .set(auth(admin.token))
        .send({ status: 'approved' })
        .expect(200);

      const created = await request(app)
        .post(`/api/acquisition/applications/${application._id}/checklists`)
        .set(auth(admin.token))
        .send({})
        .expect(201);

      for (const item of created.body[0].items) {
        await request(app)
          .patch(`/api/acquisition/checklist-items/${item._id}`)
          .set(auth(admin.token))
          .send({ status: item.required ? 'complete' : 'not_applicable' })
          .expect(200);
      }

      const advanced = await request(app)
        .post(`/api/acquisition/applications/${application._id}/advance`)
        .set(auth(admin.token))
        .expect(201);

      const { parcel } = advanced.body;
      assert.equal(parcel.county, application.property.county);
      assert.equal(parcel.area.value, application.property.acres);
      assert.equal(parcel.status, 'management');
      // The geometry reference travels with it, so the map keeps working.
      assert.equal(parcel.geometry.ref, application.property.parcelIdentifiers[0]);
      assert.equal(advanced.body.application.status, 'completed');

      // Doing it twice is refused rather than creating a duplicate parcel.
      await request(app)
        .post(`/api/acquisition/applications/${application._id}/advance`)
        .set(auth(admin.token))
        .expect(409);
    });

    it('opens a disposition case carrying the management history in', async () => {
      const { Parcel, ManagementPlan } = await import('../src/models/index.js');
      const parcel = await Parcel.create({
        parcelId: 'P-TEST-1',
        name: 'Test Holding',
        region: 'North',
        county: 'Example',
        area: { value: 40, unit: 'acres' },
        status: 'management',
      });
      await ManagementPlan.create({
        parcel: parcel._id,
        programArea: 'mowing',
        name: 'Mowing rotation',
        startYear: 2026,
        endYear: 2028,
      });

      const advanced = await request(app)
        .post(`/api/management/parcels/${parcel._id}/advance`)
        .set(auth(admin.token))
        .send({ reason: 'Isolated holding.', method: 'sale' })
        .expect(201);

      assert.match(advanced.body.dispositionCase.caseNumber, /^LD-\d{4}-\d{5}$/);
      assert.equal(advanced.body.dispositionCase.originModule, 'management');
      assert.equal(advanced.body.carried.plans, 1);
      assert.equal(advanced.body.dispositionCase.carriedForward.managementPlans.length, 1);

      // A second open case for the same parcel is refused.
      await request(app)
        .post(`/api/management/parcels/${parcel._id}/advance`)
        .set(auth(admin.token))
        .send({ reason: 'Again.' })
        .expect(409);
    });
  });

  describe('Permissions still hold across the new modules', () => {
    it('refuses Read Only every write in all three modules', async () => {
      const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });
      const application = await seedApplication(admin.token);

      await request(app).post('/api/acquisition/intake/simulate').set(auth(token)).send({ count: 1 }).expect(403);
      await request(app)
        .post(`/api/acquisition/applications/${application._id}/documents`)
        .set(auth(token))
        .send({ template: 'acquisition-ranking-memo' })
        .expect(403);
      await request(app).post('/api/management/tasks').set(auth(token)).send({ title: 'x' }).expect(403);
      await request(app).post('/api/disposition/cases').set(auth(token)).send({}).expect(403);
    });

    it('lets a Module Editor act only in their assigned module', async () => {
      const { token } = await createUser({
        email: 'editor@district.gov',
        role: 'module_editor',
        modules: ['management'],
      });

      // Assigned: allowed.
      await request(app)
        .post('/api/management/contracts')
        .set(auth(token))
        .send({ title: 'Mowing', module: 'management' })
        .expect(201);

      // Not assigned: refused, on both of the other modules.
      await request(app).post('/api/acquisition/intake/simulate').set(auth(token)).send({ count: 1 }).expect(403);
      await request(app).post('/api/disposition/cases').set(auth(token)).send({}).expect(403);

      // Reading is still fine everywhere.
      await request(app).get('/api/acquisition/applications').set(auth(token)).expect(200);
      await request(app).get('/api/disposition/cases').set(auth(token)).expect(200);
    });

    it('requires a signed-in user for the map and document endpoints', async () => {
      await request(app).get('/api/gis/features').expect(401);
      await request(app).get('/api/documents').expect(401);
      await request(app).get('/api/documents/templates').expect(401);
    });
  });

  describe('The map', () => {
    it('serves geometry through the configured provider', async () => {
      const status = await request(app).get('/api/gis/status').set(auth(admin.token)).expect(200);
      assert.equal(status.body.provider, 'sample');
      assert.equal(status.body.live, false);

      const features = await request(app).get('/api/gis/features').set(auth(admin.token)).expect(200);
      assert.equal(features.body.type, 'FeatureCollection');
      assert.ok(features.body.features.length > 0);
      assert.ok(features.body.features[0].properties.parcelId);
    });

    it('filters to the parcels asked for', async () => {
      const all = await request(app).get('/api/gis/features').set(auth(admin.token)).expect(200);
      const wanted = all.body.features[0].properties.parcelId;

      const filtered = await request(app)
        .get(`/api/gis/features?parcelIds=${wanted}`)
        .set(auth(admin.token))
        .expect(200);

      assert.equal(filtered.body.features.length, 1);
      assert.equal(filtered.body.features[0].properties.parcelId, wanted);
    });
  });

  describe('Intake from the online form system', () => {
    it('rejects a webhook post without a valid signature', async () => {
      await request(app)
        .post('/api/acquisition/intake/webhook')
        .send({ applicant: { name: 'Someone' }, property: { county: 'Example' } })
        .expect(401);

      await request(app)
        .post('/api/acquisition/intake/webhook')
        .set('x-lams-intake-signature', 'sha256=wrong')
        .send({ applicant: { name: 'Someone' }, property: { county: 'Example' } })
        .expect(401);
    });

    it('accepts a correctly signed post and assigns a file number', async () => {
      const crypto = await import('node:crypto');
      const payload = JSON.stringify({
        applicant: { name: 'Signed Applicant' },
        property: { county: 'Example', acres: 12 },
      });
      const signature = crypto
        .createHmac('sha256', process.env.INTAKE_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

      const response = await request(app)
        .post('/api/acquisition/intake/webhook')
        .set('content-type', 'application/json')
        .set('x-lams-intake-signature', signature)
        .send(payload)
        .expect(201);

      assert.match(response.body.fileNumber, /^LA-\d{4}-\d{5}$/);
    });
  });
});
