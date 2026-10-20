import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../app.js';
import { Event, Project, Session, User } from '../models/index.js';
import { csvCell } from '../services/export.js';
import { seedDemo } from '../seed.js';
import { cleanUrl } from '../services/ingestion.js';

let mongo;
let app;
let owner;
let outsider;
let project;
const origin = 'https://shop.example.com';

before(
  async () => {
    mongo = await MongoMemoryServer.create({
      binary: { downloadDir: path.resolve('.cache/mongodb-binaries') },
    });
    await mongoose.connect(mongo.getUri());
    await Promise.all([User.init(), Session.init(), Project.init(), Event.init()]);
    app = createApp({ clientOrigin: 'http://localhost:5173', production: false });
    owner = request.agent(app);
    outsider = request.agent(app);
  },
  { timeout: 600000 },
);

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('accounts use hashed passwords and persisted HttpOnly sessions', async () => {
  await request(app).post('/api/auth/register').expect(400);
  await request(app)
    .post('/api/auth/login')
    .type('form')
    .send({ email: 'missing-parser@example.com' })
    .expect(400);
  await request(app).post('/api/auth/register').send([]).expect(400);
  await request(app).post('/api/ingest').expect(400);
  await request(app).get('/api/auth/me').expect(401);
  const registered = await owner
    .post('/api/auth/register')
    .send({ name: 'Taylor', email: 'TAYLOR@example.com', password: 'GoodPass123!' })
    .expect(201);
  assert.equal(registered.body.user.email, 'taylor@example.com');
  assert.equal(registered.body.user.passwordHash, undefined);
  const cookie = registered.headers['set-cookie'].find((value) =>
    value.startsWith('rum_session='),
  );
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = cookie.split(';')[0].split('=')[1];
  const session = await Session.findOne();
  assert.notEqual(session.tokenHash, token);
  const user = await User.findOne().select('+passwordHash');
  assert.notEqual(user.passwordHash, 'GoodPass123!');
  assert.equal((await owner.get('/api/auth/me').expect(200)).body.user.name, 'Taylor');
  await request(app)
    .post('/api/auth/login')
    .send({ email: 'taylor@example.com', password: 'WrongPass123!' })
    .expect(401);
  await request(app)
    .post('/api/auth/register')
    .send({ name: 'Other', email: 'taylor@example.com', password: 'GoodPass123!' })
    .expect(409);
});

test('project creation validates origins and account isolation covers reads, edits and analytics', async () => {
  await owner
    .post('/api/projects')
    .send({ name: 'Invalid', origin: 'javascript:alert(1)' })
    .expect(400);
  project = (
    await owner
      .post('/api/projects')
      .send({ name: 'Store', origin: `${origin}/products?private=1` })
      .expect(201)
  ).body.project;
  assert.equal(project.origin, origin);
  assert.match(project.key, /^rum_/);
  await outsider
    .post('/api/auth/register')
    .send({ name: 'Other user', email: 'other@example.com', password: 'OtherPass123!' })
    .expect(201);
  assert.deepEqual((await outsider.get('/api/projects').expect(200)).body.projects, []);
  await outsider.get(`/api/projects/${project.id}`).expect(404);
  await outsider.patch(`/api/projects/${project.id}`).send({ name: 'Changed' }).expect(404);
  await outsider.get(`/api/projects/${project.id}/analytics`).expect(404);
  await outsider.delete(`/api/projects/${project.id}`).expect(404);
});

test('dashboard rejects cross-origin mutations and responds to the configured frontend preflight', async () => {
  await owner
    .patch(`/api/projects/${project.id}`)
    .set('Origin', 'https://attacker.example')
    .send({ name: 'Changed' })
    .expect(403);
  const result = await owner
    .options('/api/projects')
    .set('Origin', 'http://localhost:5173')
    .set('Access-Control-Request-Method', 'POST')
    .expect(204);
  assert.equal(result.headers['access-control-allow-credentials'], 'true');
  await owner
    .patch(`/api/projects/${project.id}`)
    .set('Origin', 'http://localhost:5173')
    .set('Sec-Fetch-Site', 'same-site')
    .send({ name: 'Store' })
    .expect(200);
});

test('collector validates a whole batch, checks origin and discards untrusted geographic data', async () => {
  assert.equal(cleanUrl(`${origin}/orders/%31%32%33?secret=1`), `${origin}/orders/:id`);
  const event = {
    id: 'page-1',
    type: 'page',
    pageUrl: `${origin}/products/123?email=private@example.com#secret`,
    sessionId: 'session-1',
    lcp: 2000,
    cls: 0,
    country: 'US',
  };
  await request(app)
    .post('/api/ingest')
    .set('Origin', 'https://attacker.example')
    .send({ key: project.key, events: [event] })
    .expect(403);
  await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({ key: project.key, events: [event, { ...event, id: 'bad', lcp: -1 }] })
    .expect(400);
  await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({
      key: project.key,
      events: [{ ...event, timestamp: [new Date().toISOString()] }],
    })
    .expect(400);
  await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({
      key: project.key,
      events: Array.from({ length: 101 }, () => event),
    })
    .expect(400);
  assert.equal(await Event.countDocuments(), 0);
  const result = await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({ key: project.key, events: [event] })
    .expect(202);
  assert.equal(result.body.inserted, 1);
  const saved = await Event.findOne();
  assert.equal(saved.pageUrl, `${origin}/products/:id`);
  assert.equal(saved.country, 'Unknown');
  assert.equal(saved.cls, 0);
  await request(app)
    .get(`/api/ingest/config?key=${project.key}`)
    .set('Origin', origin)
    .expect(200);
});

test('vital updates keep one page view, preserve the first timestamp and retain previous measurements', async () => {
  const first = await Event.findOne({ eventId: 'page-1' });
  await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({
      key: project.key,
      events: [
        {
          id: 'page-1',
          type: 'page',
          pageUrl: `${origin}/products/:id`,
          sessionId: 'session-1',
          lcp: null,
          inp: 125,
        },
      ],
    })
    .expect(202);
  assert.equal(await Event.countDocuments({ type: 'page' }), 1);
  const updated = await Event.findOne({ eventId: 'page-1' });
  assert.equal(updated.lcp, 2000);
  assert.equal(updated.inp, 125);
  assert.equal(updated.timestamp.getTime(), first.timestamp.getTime());
});

test('out-of-order page revisions cannot roll back newer vitals', async () => {
  const base = {
    id: 'page-1',
    type: 'page',
    pageUrl: `${origin}/products/:id`,
    sessionId: 'session-1',
  };
  const send = (event) =>
    request(app)
      .post('/api/ingest')
      .set('Origin', origin)
      .send({ key: project.key, events: [event] })
      .expect(202);
  await send({ ...base, revision: 2, lcp: 2100, inp: 120 });
  await send({ ...base, revision: 1, lcp: 1700, inp: 80 });
  await send({ ...base, revision: 2, lcp: 1600 });
  const saved = await Event.findOne({ eventId: 'page-1' });
  assert.equal(saved.revision, 2);
  assert.equal(saved.lcp, 2100);
  assert.equal(saved.inp, 120);
  assert.equal(saved.cls, 0);
  assert.equal(await Event.countDocuments({ eventId: 'page-1' }), 1);
});

test('analytics aggregate real events, preserve nulls and zero, calculate errors and apply filters', async () => {
  const base = {
    type: 'request',
    sessionId: 'session-1',
    pageUrl: `${origin}/products/:id`,
    url: `${origin}/api/products/123?token=secret`,
    method: 'GET',
    browser: 'Chrome',
    device: 'Desktop',
  };
  await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({
      key: project.key,
      events: [
        { ...base, id: 'request-1', status: 200, duration: 100, ttfb: 0 },
        { ...base, id: 'request-2', status: 500, duration: 300, ttfb: null },
      ],
    })
    .expect(202);
  const analytics = (
    await owner.get(`/api/projects/${project.id}/analytics?range=24h`).expect(200)
  ).body;
  assert.equal(analytics.summary.pageViews, 1);
  assert.equal(analytics.summary.totalRequests, 2);
  assert.equal(analytics.summary.sessions, 1);
  assert.equal(analytics.summary.avgDuration, 200);
  assert.equal(analytics.summary.errorRate, 50);
  assert.equal(analytics.summary.cls, 0);
  assert.equal(analytics.summary.fcp, null);
  assert.equal(analytics.endpoints[0].ttfb, 0);
  assert.equal(analytics.endpoints[0].url, `${origin}/api/products/:id`);
  assert.equal(
    analytics.timeline.reduce((sum, row) => sum + row.requests, 0),
    2,
  );
  const filtered = (
    await owner.get(`/api/projects/${project.id}/analytics?browser=Chrome`).expect(200)
  ).body;
  assert.equal(filtered.summary.totalRequests, 2);
  assert.equal(filtered.summary.pageViews, 0);
  await owner.get(`/api/projects/${project.id}/analytics?range=invalid`).expect(400);
  await owner.get(`/api/projects/${project.id}/analytics?browser[$ne]=anything`).expect(200);
  await owner
    .get(`/api/projects/${project.id}/analytics?browser=Chrome&browser=Firefox`)
    .expect(400);
});

test('settings enforce filters and vital toggle on the server', async () => {
  await owner
    .patch(`/api/projects/${project.id}`)
    .send({ urlFilterMode: 'include', urlPatterns: ['/api/allowed'], collectVitals: false })
    .expect(200);
  const config = (await request(app).get(`/api/ingest/config?key=${project.key}`).expect(200))
    .body;
  assert.equal(config.collectVitals, false);
  const base = {
    type: 'request',
    sessionId: 'session-2',
    pageUrl: `${origin}/`,
    method: 'GET',
    status: 200,
  };
  await request(app)
    .post('/api/ingest')
    .set('Origin', origin)
    .send({
      key: project.key,
      events: [
        { ...base, id: 'filtered', url: `${origin}/api/blocked` },
        { ...base, id: 'allowed', url: `${origin}/api/allowed` },
        {
          type: 'page',
          id: 'page-2',
          sessionId: 'session-2',
          pageUrl: `${origin}/`,
          lcp: 1200,
        },
      ],
    })
    .expect(202);
  assert.equal(await Event.countDocuments({ eventId: 'filtered' }), 0);
  assert.equal(await Event.countDocuments({ eventId: 'allowed' }), 1);
  assert.equal((await Event.findOne({ eventId: 'page-2' })).lcp, null);
});

test('CSV exports are scoped, formula safe and contain only the selected event type', async () => {
  assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  assert.equal(csvCell('  +command'), '"\'  +command"');
  const csv = await owner.get(`/api/projects/${project.id}/export?kind=requests`).expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /api\/products\/:id/);
  assert.doesNotMatch(csv.text, /token=secret/);
  await outsider.get(`/api/projects/${project.id}/export`).expect(404);
  await owner.get(`/api/projects/${project.id}/export?kind=bad`).expect(400);
});

test('usage is isolated and expired sessions cannot authenticate', async () => {
  const usage = (await owner.get('/api/usage').expect(200)).body;
  assert.equal(usage.projects, 1);
  assert.equal(usage.totalEvents, 5);
  assert.equal(usage.requests, 3);
  assert.equal((await outsider.get('/api/usage').expect(200)).body.totalEvents, 0);
  const outsiderUser = await User.findOne({ email: 'other@example.com' });
  await Session.updateMany({ user: outsiderUser._id }, { expiresAt: new Date(0) });
  await outsider.get('/api/auth/me').expect(401);
});

test('key rotation invalidates the old installation and project deletion removes its events', async () => {
  const rotated = (
    await owner.post(`/api/projects/${project.id}/rotate-key`).send({}).expect(200)
  ).body.project;
  assert.notEqual(rotated.key, project.key);
  await request(app).get(`/api/ingest/config?key=${project.key}`).expect(404);
  await owner.delete(`/api/projects/${project.id}`).expect(200);
  assert.equal(await Event.countDocuments({ project: project.id }), 0);
  await owner.get(`/api/projects/${project.id}`).expect(404);
  await owner.post('/api/auth/logout').send({}).expect(200);
  await owner.get('/api/auth/me').expect(401);
});

test('explicit demo seeding is idempotent and marks all generated telemetry', async () => {
  await seedDemo();
  const firstCount = await Event.countDocuments({ demo: true });
  assert.equal(firstCount, 3750);
  const demoUser = await User.findOne({ email: 'demo@rumcore.dev' }).select('+passwordHash');
  const demoProject = await Project.findOne({ owner: demoUser._id });
  const oldDate = new Date(Date.now() - 9 * 86400000);
  await Event.updateMany({ demo: true }, { timestamp: oldDate });
  const liveEvent = await Event.create({
    project: demoProject._id,
    eventId: 'live-telemetry',
    type: 'page',
    sessionId: 'real-session',
    pageUrl: `${demoProject.origin}/real-page`,
    timestamp: oldDate,
  });
  await Project.updateOne(
    { _id: demoProject._id },
    { name: 'My custom demo project', collectVitals: false },
  );
  await User.updateOne({ _id: demoUser._id }, { name: 'My custom profile' });
  await seedDemo();
  assert.equal(await Event.countDocuments({ demo: true }), firstCount);
  assert.equal(await Event.countDocuments({ demo: true, timestamp: { $lte: oldDate } }), 0);
  assert.equal((await Event.findById(liveEvent._id)).timestamp.getTime(), oldDate.getTime());
  assert.equal((await Project.findById(demoProject._id)).name, 'My custom demo project');
  assert.equal((await Project.findById(demoProject._id)).collectVitals, false);
  const preservedUser = await User.findById(demoUser._id).select('+passwordHash');
  assert.equal(preservedUser.name, 'My custom profile');
  assert.equal(preservedUser.passwordHash, demoUser.passwordHash);
  assert.equal(
    await Project.countDocuments({
      owner: (await User.findOne({ email: 'demo@rumcore.dev' }))._id,
    }),
    2,
  );
});
