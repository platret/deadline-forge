import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { generateChallenge, scenarioOptions } from '../server/generator';
import { serviceSource } from '../server/nationals-runtime';
import { adversarialTestSource } from '../server/nationals-tests';
import type { Challenge } from '../shared/types';

function writeKit(c: Challenge) {
  const dir = mkdtempSync(join(tmpdir(), 'deadline-forge-nationals-'));
  for (const f of c.files) { const path = join(dir, f.name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, f.content); }
  return dir;
}
async function withServer(dir: string, work: (url: string) => Promise<void>, database = ':memory:') {
  const child = spawn(process.execPath, ['server.mjs'], { cwd: dir, env: { ...process.env, PORT: '0', DATABASE_PATH: database, CANDIDATE_MODULE: './engine.mjs' }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Nationals service did not start')), 5000);
      child.stdout.on('data', buffer => { const match = String(buffer).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.stderr.on('data', buffer => { if (/Error|SyntaxError/.test(String(buffer))) { clearTimeout(timeout); reject(new Error(String(buffer))); } });
    });
    await work(url);
  } finally { child.kill(); await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); }); }
}
function suite(dir: string, url: string) {
  return spawnSync(process.execPath, ['--test', 'nationals.test.mjs'], { cwd: dir, env: { ...process.env, BASE_URL: url }, encoding: 'utf8', timeout: 20000 });
}
const options = { difficulty: 'nationals', minutes: 420, seed: 'nationals-check' } as const;
for (const scenario of scenarioOptions) it(`${scenario.id}: correct Nationals mock passes the complete adversarial suite`, async () => {
  const dir = writeKit(generateChallenge({ ...options, mode: 'frontend', scenario: scenario.id }));
  try { await withServer(dir, async url => { const result = suite(dir, url); expect(result.status, result.stdout + result.stderr).toBe(0); }); }
  finally { rmSync(dir, { recursive: true }); }
}, 30000);

it('the Nationals debug kit fails as supplied and passes after repairs', async () => {
  const dir = writeKit(generateChallenge({ ...options, mode: 'debugging', scenario: 'booking' }));
  try {
    await withServer(dir, async url => { expect(suite(dir, url).status).toBe(1); });
    writeFileSync(join(dir, 'engine.mjs'), serviceSource);
    await withServer(dir, async url => { const result = suite(dir, url); expect(result.status, result.stdout + result.stderr).toBe(0); });
  } finally { rmSync(dir, { recursive: true }); }
}, 30000);

it('the Nationals mutation runner rejects the starter and all eight faults are detectable', () => {
  const dir = writeKit(generateChallenge({ ...options, mode: 'testing', scenario: 'booking' }));
  try {
    const run = () => spawnSync(process.execPath, ['mutation-check.mjs'], { cwd: dir, encoding: 'utf8', timeout: 45000 });
    const starter = run();
    expect(starter.status, starter.stdout + starter.stderr).toBe(1);
    expect(starter.stdout).toContain('0/8 mutants killed');
    writeFileSync(join(dir, 'submission.test.mjs'), adversarialTestSource);
    const complete = run();
    expect(complete.status, complete.stdout + complete.stderr).toBe(0);
    expect(complete.stdout).toContain('8/8 mutants killed');
  } finally { rmSync(dir, { recursive: true }); }
}, 60000);

it('persists allocations and semantic retry responses across a restart', async () => {
  const dir = writeKit(generateChallenge({ ...options, mode: 'frontend', scenario: 'booking' }));
  const database = join(dir, 'persistent.sqlite');
  const body = { resource_id: 1, start_at: '2027-02-08T14:00:00Z', end_at: '2027-02-08T15:00:00Z', units: 1, external_ref: 'persist' };
  const headers = { Authorization: 'Bearer practice-alpha', 'Content-Type': 'application/json', 'Idempotency-Key': 'persist' };
  let original: unknown;
  try {
    await withServer(dir, async url => { const r = await fetch(url + '/api/allocations', { method: 'POST', headers, body: JSON.stringify(body) }); expect(r.status).toBe(201); original = await r.json(); }, database);
    await withServer(dir, async url => { const r = await fetch(url + '/api/allocations', { method: 'POST', headers, body: JSON.stringify(body) }); expect(r.status).toBe(201); expect(await r.json()).toEqual(original); }, database);
  } finally { rmSync(dir, { recursive: true }); }
});

it('two independent processes cannot over-allocate one shared SQLite database', async () => {
  const dir = writeKit(generateChallenge({ ...options, mode: 'frontend', scenario: 'booking' }));
  const database = join(dir, 'shared.sqlite');
  const makeBody = (ref: string) => ({ resource_id: 1, start_at: '2027-02-08T14:00:00Z', end_at: '2027-02-08T15:00:00Z', units: 2, external_ref: ref });
  try {
    await withServer(dir, async first => {
      await withServer(dir, async second => {
        const results = await Promise.all([first, second].map((base, i) => fetch(base + '/api/allocations', { method: 'POST', headers: { Authorization: 'Bearer practice-alpha', 'Content-Type': 'application/json', 'Idempotency-Key': 'process-' + i }, body: JSON.stringify(makeBody('process-' + i)) })));
        expect(results.map(r => r.status).sort()).toEqual([201, 409]);
        const audit = await (await fetch(first + '/api/audit', { headers: { Authorization: 'Bearer practice-admin' } })).json() as { action: string }[];
        expect(audit.filter(r => r.action === 'created')).toHaveLength(1);
      }, database);
    }, database);
  } finally { rmSync(dir, { recursive: true }); }
});

const queries = {
  'resource-load': "SELECT r.id resource_id,COUNT(a.id) active_count,COALESCE(SUM(a.units*(a.end_ms-a.start_ms)/60000),0) unit_minutes FROM resources r LEFT JOIN allocations a ON r.id=a.resource_id AND a.status='active' GROUP BY r.id ORDER BY r.id",
  'peak-load': "WITH changes AS (SELECT resource_id,start_ms t,units d FROM allocations WHERE status='active' UNION ALL SELECT resource_id,end_ms,-units FROM allocations WHERE status='active'), combined AS (SELECT resource_id,t,SUM(d) d FROM changes GROUP BY resource_id,t), running AS (SELECT resource_id,SUM(d) OVER(PARTITION BY resource_id ORDER BY t) used FROM combined) SELECT r.id resource_id,COALESCE(MAX(used),0) peak_units FROM resources r LEFT JOIN running x ON x.resource_id=r.id GROUP BY r.id ORDER BY r.id",
  'team-leaderboard': "WITH totals AS (SELECT t.id team_id,COALESCE(SUM(a.units*(a.end_ms-a.start_ms)/60000),0) unit_minutes FROM teams t LEFT JOIN allocations a ON t.id=a.team_id AND a.status='active' GROUP BY t.id) SELECT *,DENSE_RANK() OVER(ORDER BY unit_minutes DESC) demand_rank FROM totals ORDER BY team_id",
  'capacity-violations': "WITH changes AS (SELECT resource_id,start_ms t,units d FROM allocations WHERE status='active' UNION ALL SELECT resource_id,end_ms,-units FROM allocations WHERE status='active'), combined AS (SELECT resource_id,t,SUM(d) d FROM changes GROUP BY resource_id,t), running AS (SELECT resource_id,SUM(d) OVER(PARTITION BY resource_id ORDER BY t) used FROM combined) SELECT r.id resource_id,MAX(used) peak_units,r.capacity FROM resources r JOIN running x ON x.resource_id=r.id GROUP BY r.id HAVING MAX(used)>r.capacity ORDER BY r.id",
  'maximal-idle-gaps': "WITH changes AS (SELECT resource_id,start_ms t,units d FROM allocations WHERE status='active' UNION ALL SELECT resource_id,end_ms,-units FROM allocations WHERE status='active' UNION ALL SELECT id,1802073600000,0 FROM resources UNION ALL SELECT id,1802102400000,0 FROM resources), combined AS (SELECT resource_id,t,SUM(d) d FROM changes GROUP BY resource_id,t), running AS (SELECT resource_id,t,LEAD(t) OVER(PARTITION BY resource_id ORDER BY t) finish,SUM(d) OVER(PARTITION BY resource_id ORDER BY t) used FROM combined), idle AS (SELECT resource_id,t start_ms,finish end_ms FROM running WHERE used=0 AND finish>t), flagged AS (SELECT *,CASE WHEN LAG(end_ms) OVER(PARTITION BY resource_id ORDER BY start_ms)=start_ms THEN 0 ELSE 1 END new_group FROM idle), groups AS (SELECT *,SUM(new_group) OVER(PARTITION BY resource_id ORDER BY start_ms) grp FROM flagged) SELECT resource_id,MIN(start_ms) start_ms,MAX(end_ms) end_ms,(MAX(end_ms)-MIN(start_ms))/60000 gap_minutes FROM groups GROUP BY resource_id,grp ORDER BY resource_id,start_ms",
  'latest-per-team': "WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY team_id ORDER BY start_ms DESC,id DESC) pos FROM allocations WHERE status='active') SELECT t.id team_id,a.id allocation_id FROM teams t LEFT JOIN ranked a ON a.team_id=t.id AND a.pos=1 ORDER BY t.id",
};
it('six Nationals SQL reports have consistent independently solved expected results', () => {
  const dir = writeKit(generateChallenge({ ...options, mode: 'database', scenario: 'booking' }));
  try {
    writeFileSync(join(dir, 'queries.json'), JSON.stringify(queries));
    const result = spawnSync(process.execPath, ['--test', 'database.test.mjs'], { cwd: dir, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  } finally { rmSync(dir, { recursive: true }); }
});
