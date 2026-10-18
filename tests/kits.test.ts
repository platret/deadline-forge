import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { generateChallenge, scenarioOptions } from '../server/generator';
import { makeScenarios } from '../server/scenarios';
import type { Challenge } from '../shared/types';

function writeKit(c: Challenge) {
  const dir = mkdtempSync(join(tmpdir(), 'deadline-forge-kit-'));
  for (const f of c.files) { const path = join(dir, f.name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, f.content); }
  return dir;
}
function run(dir: string, file: string, env = {}) {
  return spawnSync(process.execPath, file.endsWith('.test.mjs') ? ['--test', file] : [file], { cwd: dir, encoding: 'utf8', timeout: 15000, env: { ...process.env, ...env } });
}
const referenceQueries: Record<string, Record<string, string>> = {
  booking: { 'room-occupancy': 'SELECT r.id, r.name, COUNT(b.id) AS booking_count FROM rooms r LEFT JOIN bookings b ON b.room_id=r.id GROUP BY r.id ORDER BY r.id', 'booked-minutes': 'SELECT r.id, CAST(ROUND(COALESCE(SUM((julianday(b.ends_at)-julianday(b.starts_at))*1440),0)) AS INTEGER) AS booked_minutes FROM rooms r LEFT JOIN bookings b ON r.id=b.room_id GROUP BY r.id ORDER BY r.id' },
  inventory: { 'stock-value': 'SELECT id, stock*price_cents AS value_cents FROM products ORDER BY id', 'low-stock': 'SELECT id,name,stock FROM products WHERE stock<=5 ORDER BY stock,id' },
  tickets: { 'active-queue': "SELECT id,title,status FROM tickets WHERE status<>'resolved' ORDER BY priority,id", 'status-counts': 'SELECT status,COUNT(*) AS ticket_count FROM tickets GROUP BY status ORDER BY status' },
  events: { 'available-seats': 'SELECT e.id,e.capacity-COUNT(r.id) AS remaining_seats FROM events e LEFT JOIN registrations r ON e.id=r.event_id GROUP BY e.id ORDER BY e.id', 'empty-events': 'SELECT id,title FROM events WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.event_id=events.id) ORDER BY id' },
};
for (const scenario of scenarioOptions) {
  it(`${scenario.id}: debug kit fails as delivered and passes after the correct repair`, () => {
    const c = generateChallenge({ mode: 'debugging', difficulty: 'competition', minutes: 45, seed: 'kit-check', scenario: scenario.id });
    const dir = writeKit(c);
    try {
      expect(run(dir, 'regression.test.mjs').status).toBe(1);
      const reference = makeScenarios(0, 'Bern').find(s => s.id === scenario.id)!;
      writeFileSync(join(dir, 'engine.mjs'), reference.correct);
      const fixed = run(dir, 'regression.test.mjs');
      expect(fixed.status, fixed.stdout + fixed.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it(`${scenario.id}: SQL kit rejects placeholders and validates correct reports`, () => {
    const c = generateChallenge({ mode: 'database', difficulty: 'competition', minutes: 60, seed: 'kit-check', scenario: scenario.id });
    const dir = writeKit(c);
    try {
      expect(run(dir, 'database.test.mjs').status).toBe(1);
      writeFileSync(join(dir, 'queries.json'), JSON.stringify(referenceQueries[scenario.id]));
      const result = run(dir, 'database.test.mjs');
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally { rmSync(dir, { recursive: true }); }
  });
  it(`${scenario.id}: mutation runner requires extra tests to kill every fault`, () => {
    const c = generateChallenge({ mode: 'testing', difficulty: 'competition', minutes: 45, seed: 'kit-check', scenario: scenario.id });
    const dir = writeKit(c);
    try {
      expect(run(dir, 'regression.test.mjs').status).toBe(0);
      expect(run(dir, 'mutation-check.mjs').status).toBe(1);
      writeFileSync(join(dir, 'regression.test.mjs'), `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nconst { evaluate } = await import(new URL(process.env.CANDIDATE_MODULE || './engine.mjs', import.meta.url));\nfor (const item of JSON.parse(readFileSync('test-cases.json', 'utf8'))) test(item.name, () => assert.equal(evaluate(...item.input), item.expected));`);
      const result = run(dir, 'mutation-check.mjs');
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('3/3 mutants killed');
    } finally { rmSync(dir, { recursive: true }); }
  });
  it(`${scenario.id}: frontend mock actually passes the exported HTTP suite`, async () => {
    const c = generateChallenge({ mode: 'frontend', difficulty: 'foundation', minutes: 60, seed: 'kit-check', scenario: scenario.id });
    const dir = writeKit(c);
    const child = spawn(process.execPath, ['mock-server.mjs'], { cwd: dir, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Mock did not start')), 5000);
        child.stdout.on('data', buffer => { const match = String(buffer).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
        child.on('error', error => { clearTimeout(timeout); reject(error); });
        child.stderr.on('data', buffer => { if (String(buffer).includes('SyntaxError')) { clearTimeout(timeout); reject(new Error(String(buffer))); } });
      });
      const result = run(dir, 'api.test.mjs', { BASE_URL: url });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    } finally {
      child.kill();
      await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
      rmSync(dir, { recursive: true });
    }
  });
}
