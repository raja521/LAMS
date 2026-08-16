import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { auth, clearDatabase, createUser, setupTestApp, teardownTestApp } from './helpers/harness.js';

let app;

const parcelPayload = (overrides = {}) => ({
  parcelId: 'APN-0001',
  name: 'North Ridge Tract',
  region: 'North',
  county: 'Example County',
  area: { value: 12.5, unit: 'acres' },
  status: 'acquisition',
  ...overrides,
});

async function seedParcel(status = 'acquisition') {
  const { Parcel } = await import('../src/models/index.js');
  return Parcel.create(parcelPayload({ status, parcelId: `APN-${status.toUpperCase()}` }));
}

describe('Permissions are enforced on the server', () => {
  before(async () => {
    app = await setupTestApp();
  });
  after(teardownTestApp);
  beforeEach(clearDatabase);

  describe('Read Only — can look but not touch', () => {
    it('may read parcels and the dashboard', async () => {
      const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });

      await request(app).get('/api/parcels').set(auth(token)).expect(200);
      await request(app).get('/api/dashboard/summary').set(auth(token)).expect(200);
    });

    it('is refused on create, update and delete', async () => {
      const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });
      const parcel = await seedParcel();

      const created = await request(app).post('/api/parcels').set(auth(token)).send(parcelPayload()).expect(403);
      assert.match(created.body.error.message, /Read Only/i);

      await request(app).patch(`/api/parcels/${parcel._id}`).set(auth(token)).send({ name: 'Renamed' }).expect(403);
      await request(app).delete(`/api/parcels/${parcel._id}`).set(auth(token)).expect(403);
    });

    it('leaves the data untouched after a refused write', async () => {
      const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });
      const parcel = await seedParcel();
      const { Parcel } = await import('../src/models/index.js');

      await request(app).patch(`/api/parcels/${parcel._id}`).set(auth(token)).send({ name: 'Renamed' }).expect(403);

      const after = await Parcel.findById(parcel._id);
      assert.equal(after.name, 'North Ridge Tract');
    });

    it('cannot reach the user administration area', async () => {
      const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });

      await request(app).get('/api/users').set(auth(token)).expect(403);
      await request(app).get('/api/activity').set(auth(token)).expect(403);
      await request(app)
        .post('/api/users')
        .set(auth(token))
        .send({ firstName: 'New', lastName: 'Admin', email: 'x@district.gov', role: 'admin' })
        .expect(403);
    });
  });

  describe('Module Editor — edits only within assigned areas', () => {
    it('may create in an assigned module', async () => {
      const { token } = await createUser({
        email: 'editor@district.gov',
        role: 'module_editor',
        modules: ['acquisition'],
      });

      await request(app)
        .post('/api/parcels')
        .set(auth(token))
        .send(parcelPayload({ status: 'acquisition' }))
        .expect(201);
    });

    it('is refused in a module they were not assigned', async () => {
      const { token } = await createUser({
        email: 'editor@district.gov',
        role: 'module_editor',
        modules: ['acquisition'],
      });

      const res = await request(app)
        .post('/api/parcels')
        .set(auth(token))
        .send(parcelPayload({ parcelId: 'APN-0002', status: 'disposition' }))
        .expect(403);

      assert.match(res.body.error.message, /assigned to you/i);
      assert.equal(res.body.error.details.module, 'disposition');
    });

    it('cannot edit an existing record that sits in another module', async () => {
      const { token } = await createUser({
        email: 'editor@district.gov',
        role: 'module_editor',
        modules: ['acquisition'],
      });
      const managed = await seedParcel('management');

      await request(app).patch(`/api/parcels/${managed._id}`).set(auth(token)).send({ name: 'Nope' }).expect(403);
      await request(app).delete(`/api/parcels/${managed._id}`).set(auth(token)).expect(403);
    });

    it('may still read every module', async () => {
      const { token } = await createUser({
        email: 'editor@district.gov',
        role: 'module_editor',
        modules: ['acquisition'],
      });
      const managed = await seedParcel('management');

      await request(app).get(`/api/parcels/${managed._id}`).set(auth(token)).expect(200);
    });

    it('cannot manage users or promote itself to administrator', async () => {
      const { user, token } = await createUser({
        email: 'editor@district.gov',
        role: 'module_editor',
        modules: ['acquisition'],
      });

      await request(app).patch(`/api/users/${user._id}`).set(auth(token)).send({ role: 'admin' }).expect(403);

      const { User } = await import('../src/models/index.js');
      assert.equal((await User.findById(user._id)).role, 'module_editor');
    });
  });

  describe('Administrator — may do anything', () => {
    it('creates, edits and deletes across every module', async () => {
      const { token } = await createUser({ email: 'admin@district.gov', role: 'admin' });

      const created = await request(app)
        .post('/api/parcels')
        .set(auth(token))
        .send(parcelPayload({ status: 'disposition' }))
        .expect(201);

      await request(app)
        .patch(`/api/parcels/${created.body._id}`)
        .set(auth(token))
        .send({ name: 'Renamed by admin' })
        .expect(200);

      await request(app).delete(`/api/parcels/${created.body._id}`).set(auth(token)).expect(204);
    });

    it('reaches the user administration area', async () => {
      const { token } = await createUser({ email: 'admin@district.gov', role: 'admin' });

      await request(app).get('/api/users').set(auth(token)).expect(200);
      await request(app).get('/api/activity').set(auth(token)).expect(200);
    });

    it('cannot remove its own administrator role and lock everyone out', async () => {
      const { user, token } = await createUser({ email: 'admin@district.gov', role: 'admin' });

      await request(app).patch(`/api/users/${user._id}`).set(auth(token)).send({ role: 'read_only' }).expect(400);
    });

    it('rejects a Module Editor created with no assigned modules', async () => {
      const { token } = await createUser({ email: 'admin@district.gov', role: 'admin' });

      await request(app)
        .post('/api/users')
        .set(auth(token))
        .send({
          firstName: 'Mo',
          lastName: 'Editor',
          email: 'mo@district.gov',
          role: 'module_editor',
          modules: [],
        })
        .expect(400);
    });
  });

  describe('The activity log', () => {
    it('records every refused attempt', async () => {
      const { token } = await createUser({ email: 'ro@district.gov', role: 'read_only' });
      const { ActivityLog } = await import('../src/models/index.js');

      await request(app).post('/api/parcels').set(auth(token)).send(parcelPayload()).expect(403);

      const denied = await ActivityLog.findOne({ action: 'permission_denied' });
      assert.ok(denied, 'a permission_denied entry is written');
      assert.equal(denied.success, false);
      assert.equal(denied.actorEmail, 'ro@district.gov');
      assert.equal(denied.actorRole, 'read_only');
    });

    it('records who created what, without the route handler remembering to', async () => {
      const { user, token } = await createUser({ email: 'admin@district.gov', role: 'admin' });
      const { ActivityLog } = await import('../src/models/index.js');

      await request(app).post('/api/parcels').set(auth(token)).send(parcelPayload()).expect(201);

      // The audit middleware writes on response finish.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const entry = await ActivityLog.findOne({ action: 'create', entityType: 'Parcel' });
      assert.ok(entry, 'a create entry is written');
      assert.equal(String(entry.actor), String(user._id));
      assert.equal(entry.entityLabel, 'APN-0001');
      assert.equal(entry.module, 'acquisition');
    });

    it('records the before and after values of an edit', async () => {
      const { token } = await createUser({ email: 'admin@district.gov', role: 'admin' });
      const parcel = await seedParcel();
      const { ActivityLog } = await import('../src/models/index.js');

      await request(app).patch(`/api/parcels/${parcel._id}`).set(auth(token)).send({ name: 'New Name' }).expect(200);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const entry = await ActivityLog.findOne({ action: 'update', entityType: 'Parcel' });
      assert.equal(entry.changes.name.from, 'North Ridge Tract');
      assert.equal(entry.changes.name.to, 'New Name');
    });
  });
});
