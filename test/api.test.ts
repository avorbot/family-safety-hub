import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

const DAY = '2026-11-06';
let now: Date;
let app: Express;

beforeEach(() => {
  now = new Date(`${DAY}T15:00:00Z`);
  app = createApp({ db: openDatabase(':memory:'), now: () => now });
});

async function signUp(email = 'sam@example.com') {
  const agent = request.agent(app);
  await agent
    .post('/api/auth/register')
    .send({ name: 'Sam', email, password: 'correct horse battery' })
    .expect(201);
  return agent;
}

async function addChild(agent: ReturnType<typeof request.agent>, dailyLimitMinutes = 60) {
  const res = await agent.post('/api/children').send({ name: 'Alex', dailyLimitMinutes }).expect(201);
  return res.body.child.id as number;
}

/** Creates a device for the child, pairs it, and acknowledges the notice. Returns the device token. */
async function pairDevice(agent: ReturnType<typeof request.agent>, childId: number, acknowledge = true) {
  const created = await agent.post(`/api/children/${childId}/devices`).send({ name: 'Tablet' }).expect(201);
  const paired = await request(app)
    .post('/api/device/pair')
    .send({ code: created.body.pairingCode.toLowerCase() })
    .expect(201);
  const token = paired.body.token as string;
  if (acknowledge) {
    await request(app).post('/api/device/acknowledge').set('Authorization', `Bearer ${token}`).expect(200);
  }
  return { token, deviceId: created.body.device.id as number, pairingCode: created.body.pairingCode as string, paired };
}

describe('parent accounts', () => {
  it('registers, reads the session, logs out and logs back in', async () => {
    const agent = await signUp();
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.parent).toMatchObject({ name: 'Sam', email: 'sam@example.com' });

    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);

    await agent.post('/api/auth/login').send({ email: 'SAM@example.com', password: 'wrong password' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'SAM@example.com', password: 'correct horse battery' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  it('sets an HttpOnly, SameSite session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sam', email: 'sam@example.com', password: 'correct horse battery' })
      .expect(201);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/fsh_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects short passwords, duplicate emails and bad JSON', async () => {
    await request(app).post('/api/auth/register').send({ name: 'Sam', email: 'sam@example.com', password: 'short' }).expect(400);
    await signUp();
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Sam', email: 'sam@example.com', password: 'another long password' })
      .expect(409);
    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{nope').expect(400);
    expect(bad.body.error).toBe('Invalid JSON body');
  });

  it("does not let one parent see another parent's child", async () => {
    const sam = await signUp('sam@example.com');
    const childId = await addChild(sam);
    const robin = await signUp('robin@example.com');
    await robin.get(`/api/children/${childId}/summary`).expect(404);
    await robin.patch(`/api/children/${childId}`).send({ dailyLimitMinutes: 999 }).expect(404);
    await robin.post(`/api/children/${childId}/devices`).send({ name: 'Sneaky' }).expect(404);
    const list = await robin.get('/api/children').expect(200);
    expect(list.body.children).toEqual([]);
  });

  it('updates rules and normalises blocked domains', async () => {
    const agent = await signUp();
    const childId = await addChild(agent);
    const updated = await agent
      .patch(`/api/children/${childId}`)
      .send({ dailyLimitMinutes: 90, bedtimeStart: '21:00', bedtimeEnd: '07:00' })
      .expect(200);
    expect(updated.body.child).toMatchObject({ dailyLimitMinutes: 90, bedtimeStart: '21:00', bedtimeEnd: '07:00' });
    await agent.patch(`/api/children/${childId}`).send({ bedtimeStart: '25:00' }).expect(400);

    const sites = await agent
      .post(`/api/children/${childId}/blocked-sites`)
      .send({ domain: 'https://www.Example.com/some/page?x=1' })
      .expect(201);
    expect(sites.body.blockedSites.map((s: { domain: string }) => s.domain)).toEqual(['example.com']);
    await agent.post(`/api/children/${childId}/blocked-sites`).send({ domain: 'not a domain' }).expect(400);
  });
});

describe('child devices', () => {
  it('reports nothing until the child acknowledges the monitoring notice', async () => {
    const agent = await signUp();
    const childId = await addChild(agent);
    const { token, paired } = await pairDevice(agent, childId, false);

    expect(paired.body.childName).toBe('Alex');
    expect(paired.body.notice.collected.length).toBeGreaterThan(0);
    expect(paired.body.notice.notCollected).toContain('Your location');

    const blocked = await request(app)
      .post('/api/device/usage')
      .set('Authorization', `Bearer ${token}`)
      .send({ day: DAY, entries: [{ label: 'Minecraft', category: 'game', minutes: 30 }] })
      .expect(403);
    expect(blocked.body.code).toBe('acknowledgement_required');
    expect(blocked.body.notice.title).toBeTruthy();

    const summary = await agent.get(`/api/children/${childId}/summary?day=${DAY}`).expect(200);
    expect(summary.body.devices[0].status).toBe('awaiting acknowledgement');
    expect(summary.body.policy.usedMinutes).toBe(0);
  });

  it('runs the full flow: usage, limits, time requests, check-ins', async () => {
    const agent = await signUp();
    const childId = await addChild(agent, 60);
    await agent.post(`/api/children/${childId}/blocked-sites`).send({ domain: 'example.com' }).expect(201);
    const { token } = await pairDevice(agent, childId);
    const device = () => ({ Authorization: `Bearer ${token}` });

    await request(app)
      .post('/api/device/usage')
      .set(device())
      .send({
        day: DAY,
        entries: [
          { label: 'Minecraft', category: 'game', minutes: 40 },
          { label: 'wikipedia.org', category: 'website', minutes: 10 },
        ],
      })
      .expect(201);
    const second = await request(app)
      .post('/api/device/usage')
      .set(device())
      .send({ day: DAY, entries: [{ label: 'Minecraft', category: 'game', minutes: 20 }] })
      .expect(201);
    expect(second.body.policy).toMatchObject({ usedMinutes: 70, remainingMinutes: 0, limitReached: true });

    const policy = await request(app).get(`/api/device/policy?day=${DAY}`).set(device()).expect(200);
    expect(policy.body.blockedDomains).toEqual(['example.com']);

    const asked = await request(app)
      .post('/api/device/time-requests')
      .set(device())
      .send({ day: DAY, minutes: 30, reason: 'Finishing a school project' })
      .expect(201);
    await request(app).post('/api/device/check-ins').set(device()).send({ message: 'Home from school' }).expect(201);

    let summary = await agent.get(`/api/children/${childId}/summary?day=${DAY}`).expect(200);
    expect(summary.body.usage[0]).toEqual({ label: 'Minecraft', category: 'game', minutes: 60 });
    expect(summary.body.timeRequests[0]).toMatchObject({ status: 'pending', minutes: 30 });
    expect(summary.body.checkIns[0].message).toBe('Home from school');
    expect(summary.body.week).toHaveLength(7);
    expect(summary.body.week.at(-1)).toEqual({ day: DAY, minutes: 70 });

    const children = await agent.get('/api/children').expect(200);
    expect(children.body.children[0].pendingRequests).toBe(1);

    await agent.post(`/api/time-requests/${asked.body.timeRequest.id}/decision`).send({ approve: true }).expect(200);
    await agent.post(`/api/time-requests/${asked.body.timeRequest.id}/decision`).send({ approve: false }).expect(409);

    summary = await agent.get(`/api/children/${childId}/summary?day=${DAY}`).expect(200);
    expect(summary.body.policy).toMatchObject({ extraMinutes: 30, usedMinutes: 70, remainingMinutes: 20, limitReached: false });

    // The child sees the same data, plus the notice.
    const me = await request(app).get(`/api/device/me?day=${DAY}`).set(device()).expect(200);
    expect(me.body.policy.remainingMinutes).toBe(20);
    expect(me.body.usage).toEqual(summary.body.usage);
    expect(me.body.notice.whoCanSee).toBeTruthy();
    expect(me.body.timeRequests[0].status).toBe('approved');
  });

  it('pairing codes are single-use and expire after 15 minutes', async () => {
    const agent = await signUp();
    const childId = await addChild(agent);
    const { pairingCode } = await pairDevice(agent, childId);
    await request(app).post('/api/device/pair').send({ code: pairingCode }).expect(400);

    const fresh = await agent.post(`/api/children/${childId}/devices`).send({ name: 'Phone' }).expect(201);
    now = new Date(now.getTime() + 16 * 60 * 1000);
    await request(app).post('/api/device/pair').send({ code: fresh.body.pairingCode }).expect(400);
    const summary = await agent.get(`/api/children/${childId}/summary`).expect(200);
    expect(summary.body.devices.map((d: { status: string }) => d.status)).toEqual(['active', 'pairing code expired']);
  });

  it('removing a device revokes its token', async () => {
    const agent = await signUp();
    const childId = await addChild(agent);
    const { token, deviceId } = await pairDevice(agent, childId);
    await request(app).get('/api/device/me').set('Authorization', `Bearer ${token}`).expect(200);
    await agent.delete(`/api/devices/${deviceId}`).expect(204);
    await request(app).get('/api/device/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app).get('/api/device/me').expect(401);
  });

  it('limits a child to three pending time requests', async () => {
    const agent = await signUp();
    const childId = await addChild(agent);
    const { token } = await pairDevice(agent, childId);
    const ask = () =>
      request(app)
        .post('/api/device/time-requests')
        .set('Authorization', `Bearer ${token}`)
        .send({ day: DAY, minutes: 15, reason: 'Please' });
    for (let i = 0; i < 3; i++) await ask().expect(201);
    await ask().expect(429);
  });
});

it('answers unknown API routes with JSON 404', async () => {
  const res = await request(app).get('/api/nope').expect(404);
  expect(res.body).toEqual({ error: 'Not found' });
  await request(app).get('/api/health').expect(200, { ok: true });
});
