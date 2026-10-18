import { beforeAll, afterAll, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import JSZip from 'jszip';
import type { Challenge, Session } from '../shared/types';

const app = createApp(':memory:');
let base: string;
beforeAll(async () => {
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(resolve => app.server.close(() => resolve())); app.store.close(); });
const post = (path: string, body: unknown, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const options = { mode: 'backend', difficulty: 'stretch', minutes: 60, seed: 'integration', scenario: 'inventory' };

it('generates a brief, exports its exact kit and saves a complete session lifecycle', async () => {
  const response = await post('/api/challenges', options);
  expect(response.status).toBe(201);
  const c = await response.json() as Challenge;
  const kit = await post('/api/kits', options);
  expect(kit.headers.get('content-type')).toBe('application/zip');
  const zip = await JSZip.loadAsync(await kit.arrayBuffer());
  expect(await zip.file('seed.sql')!.async('string')).toBe(c.sql);
  expect(JSON.parse(await zip.file('challenge.json')!.async('string')).id).toBe(c.id);
  const start = await post('/api/sessions', { options, strict: false });
  expect(start.status).toBe(201);
  const session = await start.json() as Session;
  const savedKit = await fetch(base + `/api/kits/${session.id}`);
  expect(savedKit.status).toBe(200);
  const savedZip = await JSZip.loadAsync(await savedKit.arrayBuffer());
  expect(await savedZip.file('BRIEF.md')!.async('string')).toBe(c.files.find(f => f.name === 'BRIEF.md')!.content);
  expect((await post('/api/sessions', { options, strict: false })).status).toBe(409);
  const updated = await post(`/api/sessions/${session.id}`, { action: 'progress', checked: [c.criteria[0].id], notes: 'Review transactions' }, 'PATCH');
  expect((await updated.json()).notes).toBe('Review transactions');
  expect((await (await post(`/api/sessions/${session.id}`, { action: 'pause' }, 'PATCH')).json()).status).toBe('paused');
  expect((await (await post(`/api/sessions/${session.id}`, { action: 'resume' }, 'PATCH')).json()).status).toBe('running');
  expect((await (await post(`/api/sessions/${session.id}`, { action: 'finish' }, 'PATCH')).json()).status).toBe('completed');
  const list = await (await fetch(base + '/api/sessions')).json() as Session[];
  expect(list[0].checked).toEqual([c.criteria[0].id]);
  expect(list[0].challenge.id).toBe(c.id);
});
it('returns clear failures for bad requests, missing records and foreign origins', async () => {
  expect((await post('/api/challenges', { ...options, minutes: 0 })).status).toBe(400);
  expect((await fetch(base + '/api/sessions/missing')).status).toBe(404);
  expect((await fetch(base + '/api/challenges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status).toBe(400);
  expect((await fetch(base + '/api/challenges', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415);
  expect((await fetch(base + '/api/sessions', { headers: { Origin: 'https://example.com' } })).status).toBe(403);
  expect((await fetch(base + '/api/unknown')).status).toBe(404);
});
