import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { auth, clearDatabase, createUser, setupTestApp, teardownTestApp } from './helpers/harness.js';

let app;

describe('Authentication', () => {
  before(async () => {
    app = await setupTestApp();
  });
  after(teardownTestApp);
  beforeEach(clearDatabase);

  it('signs in with the correct password and returns the role and capabilities', async () => {
    const { password } = await createUser({ email: 'reader@district.gov', role: 'read_only' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reader@district.gov', password })
      .expect(200);

    assert.ok(res.body.accessToken, 'an access token is issued');
    assert.equal(res.body.user.role, 'read_only');
    assert.equal(res.body.capabilities.roleLabel, 'Read Only');
    assert.equal(res.body.capabilities.modules.acquisition.create, false);
    assert.equal(res.body.user.passwordHash, undefined, 'the password hash never leaves the server');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    await createUser({ email: 'reader@district.gov' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reader@district.gov', password: 'not-the-password' })
      .expect(401);

    const noSuchUser = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@district.gov', password: 'not-the-password' })
      .expect(401);

    assert.equal(wrongPassword.body.error.message, noSuchUser.body.error.message);
  });

  it('refuses a deactivated account', async () => {
    const { password } = await createUser({ email: 'former@district.gov', isActive: false });

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'former@district.gov', password })
      .expect(403);
  });

  it('requires a token on protected routes', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/dashboard/summary').expect(401);
    await request(app).get('/api/parcels').expect(401);
  });

  it('rejects a token that was not signed by this server', async () => {
    const forged =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiI2NTAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJyb2xlIjoiYWRtaW4iLCJ0eXAiOiJhY2Nlc3MifQ.' +
      'not-a-real-signature';

    await request(app).get('/api/auth/me').set(auth(forged)).expect(401);
  });

  it('reads the role from the database, so a stale token cannot keep old rights', async () => {
    const { user, token } = await createUser({ email: 'demoted@district.gov', role: 'admin' });

    // The token still says "admin"; the account no longer is.
    user.role = 'read_only';
    user.modules = [];
    await user.save();

    const res = await request(app).get('/api/auth/me').set(auth(token)).expect(200);
    assert.equal(res.body.user.role, 'read_only');
    assert.equal(res.body.capabilities.canManageUsers, false);
  });

  it('blocks a token belonging to an account that was deactivated after sign-in', async () => {
    const { user, token } = await createUser({ email: 'revoked@district.gov', role: 'admin' });

    user.isActive = false;
    await user.save();

    await request(app).get('/api/auth/me').set(auth(token)).expect(403);
  });

  it('records successful and failed sign-ins in the activity log', async () => {
    const { password } = await createUser({ email: 'audited@district.gov' });
    const { ActivityLog } = await import('../src/models/index.js');

    await request(app).post('/api/auth/login').send({ email: 'audited@district.gov', password }).expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'audited@district.gov', password: 'wrong' })
      .expect(401);

    assert.equal(await ActivityLog.countDocuments({ action: 'login', success: true }), 1);
    assert.equal(await ActivityLog.countDocuments({ action: 'login_failed', success: false }), 1);
  });

  it('reports the enabled sign-in methods from the environment', async () => {
    const res = await request(app).get('/api/auth/config').expect(200);
    assert.deepEqual(res.body.providers, ['local']);
    assert.equal(res.body.azureEnabled, false);
  });
});
