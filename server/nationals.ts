import { createHash } from 'node:crypto';
import type { Challenge, FileAsset, GenerateOptions } from '../shared/types';
import type { Scenario } from './scenarios';
import { serviceSource, mutateService, faultPatches, serverSource } from './nationals-runtime';
import { adversarialTestSource, mutationRunnerSource } from './nationals-tests';

export const nationalsSchema = `CREATE TABLE teams(id INTEGER PRIMARY KEY,label TEXT NOT NULL);
CREATE TABLE resources(id INTEGER PRIMARY KEY,label TEXT NOT NULL,capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 1000),enabled INTEGER NOT NULL CHECK(enabled IN (0,1)));
CREATE TABLE allocations(id INTEGER PRIMARY KEY AUTOINCREMENT,resource_id INTEGER NOT NULL REFERENCES resources(id),team_id INTEGER NOT NULL REFERENCES teams(id),start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,units INTEGER NOT NULL CHECK(units>0),external_ref TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','cancelled')),revision INTEGER NOT NULL CHECK(revision>0),CHECK(start_ms<end_ms),UNIQUE(team_id,external_ref));
CREATE INDEX allocation_capacity ON allocations(resource_id,status,start_ms,end_ms);
CREATE INDEX allocation_team ON allocations(team_id,id);
CREATE TABLE idempotency(team_id INTEGER NOT NULL REFERENCES teams(id),key TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(team_id,key));
CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,team_id INTEGER NOT NULL REFERENCES teams(id),entity_id INTEGER NOT NULL);`;

export const nationalsContract = `# Nationals laboratory contract

UNOFFICIAL TRAINING. This is an original, deliberately difficult connected exercise, not an official paper or prediction. All tokens below are public, fake fixture identities.

## Authentication and isolation

Every /api route requires Authorization: Bearer <token>. Tokens: practice-alpha (team 1), practice-beta (team 2), practice-admin (team 3, administrator). Missing or unknown token: 401. Admin-only route used by a team token: 403. Resource catalogues are shared. Allocation lists/items include only the caller's team; admin sees all teams. Another team's id returns 404, including on cancellation.

## Allocation rules

POST /api/allocations accepts {resource_id,start_at,end_at,units,external_ref}. resource_id is an integer referring to an existing enabled resource. units is an integer 1–1000. external_ref is a trimmed, non-empty string of at most 80 characters, unique per team for the lifetime of a record, including after cancellation. Do not trust a team_id supplied in the request; derive ownership from the token.

Timestamps must be valid RFC 3339 calendar dates with Z or an explicit offset, seconds 00 and optional .000. Reject timezone-less dates and impossible dates. start < end, maximum duration 8 hours. Normalise response dates to UTC using the .000Z form. Explicit offsets, including across a Europe/Zurich DST change, describe absolute instants; do not infer a timezone from the machine.

Allocations occupy half-open intervals [start,end). At every instant, the SUM of units across ALL teams' active allocations must not exceed resource capacity. Touching boundaries are free. Use peak concurrency, not the sum of all rows that overlap a new interval. Missing resource: 404. Disabled resource, capacity conflict or duplicate external_ref: 409. Invalid fields: 400.

## Atomic retries

POST /api/allocations requires Idempotency-Key (1–80 characters). Scope it by team. Create the allocation, save the original response, claim the key and add the audit record in ONE transaction. Repeating the same key with semantically equal fields returns the same status 201 and record id, even under concurrent requests or after cancellation/restart. Compare normalised selected fields, not raw JSON key order. Same key with different selected fields: 409 with no write. The same key/reference in different teams is independent.

## Endpoints

- GET /api/resources: 200 JSON array [{id,label,capacity,enabled}], ordered by id.
- GET /api/allocations: 200 JSON array of visible records (active AND cancelled), ordered by id.
- GET /api/allocations/:id: 200 visible record or 404.
- POST /api/allocations: 201 persisted record. All records contain id,resource_id,team_id,start_at,end_at,units,external_ref,status,revision. A new record starts active, revision 1.
- DELETE /api/allocations/:id: cancellation using a plain integer If-Match header. Missing header: 428. Stale revision: 412. On success: 204, empty body; preserve the row as cancelled, increment revision once and release capacity. A repeat using the current revision is a 204 no-op. Never append another cancellation audit record for a no-op.
- GET /api/audit: admin only, 200 array [{id,action,team_id,entity_id}] ordered by increasing id. Actions: created (allocation id), cancelled (allocation id), imported (number of resources inserted). Exactly one row per successful logical operation. No rows for failures, retries, dry runs or no-op cancellations.
- GET /api/report: admin only, 200 array [{resource_id,active_count,total_units,unit_minutes}], including unused/disabled resources, ordered by resource_id. unit_minutes = sum(units * elapsed minutes) for ACTIVE rows only. total_units sums active rows' units (it is not peak concurrency).
- POST /api/imports and /api/imports?dry_run=1: admin-only DFX resource import described below. Content-Type: text/plain. Dry run returns 200 {created:N,dry_run:true} without any write. Commit returns 201 {created:N,dry_run:false}. Existing ids: 409, rolling back the ENTIRE batch. Invalid file: 400. No partial success.

All error responses are JSON {error:string}; all successful non-204 responses are JSON. Unknown routes return 404. Identifiers are never interpreted as SQL.

## DFX1 legacy exchange format

Normalise CRLF to LF and remove one optional UTF-8 BOM at the very start BEFORE parsing and verifying the checksum. Bare CR is not a line terminator. The file is:

    DFX1
    id;label;capacity;enabled
    <semicolon-delimited CSV rows>
    #rows=<decimal count>;sha256=<64 lowercase hex characters>

The checksum is SHA-256 of the normalised UTF-8 CSV payload: the header through the final data row, each terminated by LF. It excludes DFX1 and the trailer. One final LF after the trailer is optional. CSV uses doubled quotes, quoted semicolons and quoted embedded LF characters. A label may contain Unicode. Trim labels, require 1–120 characters. id is a positive safe integer; capacity is an integer 1–1000; enabled is 0 or 1. Require exactly four columns per row, no duplicate ids within the file, a matching row count and matching checksum. Validate and insert atomically; malformed quoting must never be silently repaired.

## Frontend evidence (frontend/full stack)

Build resource, allocation, import-preview and audit/report views. Handle a stale cancellation (412) by refetching and explaining the conflict. Preserve a failed form, disable double-submit while pending, offer an explicit retry with the SAME key, and generate a NEW key for a changed operation. Prevent late search/filter responses from replacing newer intent. Use accessible keyboard controls, loading/empty/forbidden/error states and Europe/Zurich date display. Use the real API for full stack; the supplied correct mock for frontend only. Automated HTTP checks do not grade UI behaviour.

## Evidence beyond the public suite

Add your own integrity, restart, transaction rollback and concurrent-request tests. Run two independent application processes against the SAME file to expose unsafe read-then-write implementations; document busy/retry handling. Replay a committed request after restarting both processes. Package startup, migration, seed and test commands and rehearse from a clean folder. No public suite can prove all concurrency or UI properties.
`;

function iso(hour: number) { return Date.UTC(2027, 1, 8, hour); }
type Allocation = { id: number; resource_id: number; team_id: number; start_ms: number; end_ms: number; units: number; external_ref: string; status: string; revision: number };
type Resource = { id: number; label: string; capacity: number; enabled: number };
function baseFixtures(scenario: Scenario) {
  const labels: Record<string, string[]> = { booking: ['Shared studio', 'Quiet room', 'Closed studio'], inventory: ['Workshop rental pool', 'Service bike', 'Quarantined stock'], tickets: ['Repair bench', 'Diagnostics station', 'Closed bench'], events: ['Workshop places', 'Mentor slot', 'Cancelled workshop'] };
  return {
    teams: [{ id: 1, label: 'Team Alpha' }, { id: 2, label: 'Team Beta' }, { id: 3, label: 'Administrator' }],
    resources: labels[scenario.id].map((label, i) => ({ id: i + 1, label, capacity: i === 0 ? 2 : i === 1 ? 1 : 3, enabled: i === 2 ? 0 : 1 })),
    allocations: [
      { id: 1, resource_id: 1, team_id: 1, start_ms: iso(10), end_ms: iso(11), units: 1, external_ref: 'seed-alpha', status: 'active', revision: 1 },
      { id: 2, resource_id: 1, team_id: 2, start_ms: iso(11), end_ms: iso(12), units: 1, external_ref: 'seed-beta', status: 'active', revision: 1 },
      { id: 3, resource_id: 2, team_id: 2, start_ms: iso(10), end_ms: iso(11), units: 1, external_ref: 'seed-single', status: 'active', revision: 1 },
    ], idempotency: [], audit: [],
  };
}
function sqlFor(fixtures: Record<string, object[]>) {
  const value = (x: unknown) => typeof x === 'number' ? String(x) : `'${String(x).replaceAll("'", "''")}'`;
  return 'PRAGMA foreign_keys=ON;\nBEGIN;\n' + nationalsSchema + '\n' + Object.entries(fixtures).flatMap(([table, rows]) => rows.map(row => `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(value).join(',')});`)).join('\n') + '\nCOMMIT;\n';
}

export function makeNationals(options: GenerateOptions, scenario: Scenario, n: number, version: number, markdown: (c: Challenge) => string, city: string): Challenge {
  const database = options.mode === 'database';
  const fixtures = database ? databaseFixtures(n) : baseFixtures(scenario);
  const skill = options.mode;
  const apiWork = skill === 'fullstack' || skill === 'backend';
  const criteria = apiWork ? [
    { id: 'core', title: 'Deliver the authenticated allocation workflow', detail: 'Implement CONTRACT.md including team-scoped reads, authoritative ownership, error shapes, disabled resources and revisions.', points: skill === 'fullstack' ? 10 : 20, category: 'Backend' },
    { id: 'capacity', title: 'Protect temporal capacity under contention', detail: 'Use a sweep-line or equivalent correct peak calculation and atomic writes. Handle adjacent intervals, spanning reservations and two processes sharing one database.', points: 20, category: 'Correctness' },
    { id: 'retry', title: 'Make concurrent retries exactly-once', detail: 'Persist team-scoped request fingerprints and responses. Pass the ten-request burst, semantic replay, key conflict and restart cases without extra rows or audit events.', points: 15, category: 'Transactions' },
    { id: 'import', title: 'Parse and atomically import DFX1', detail: 'Handle UTF-8 BOM, CRLF, checksums, quoted delimiters/newlines, duplicate ids, dry runs and full rollback when a later row conflicts.', points: 15, category: 'Data processing' },
    { id: 'evidence', title: 'Pass the public suite and add missing evidence', detail: 'Pass nationals.test.mjs, then prove restart persistence, cross-process contention and integrity after rollback. Public tests are a lower bound.', points: 15, category: 'Testing' },
    { id: 'reports', title: 'Reconcile reports and audit history', detail: 'Produce zero-inclusive reports, exclude cancelled allocations and audit each successful logical operation once, never retries or failures.', points: 10, category: 'Database' },
    { id: 'delivery', title: 'Rehearse a clean-machine hand-in', detail: 'Supply locked dependencies, build/start/reset/test commands, schema/migrations, your assumptions and exact test output. Reserve the last 30 minutes for delivery.', points: skill === 'fullstack' ? 5 : 5, category: 'Delivery' },
    ...(skill === 'fullstack' ? [{ id: 'ui', title: 'Make conflicts understandable in the UI', detail: 'Implement the frontend evidence requirements in CONTRACT.md: safe retries, 412 recovery, stale response prevention, keyboard access and import preview.', points: 10, category: 'Frontend' }] : []),
  ] : skill === 'frontend' ? [
    { id: 'workflow', title: 'Build all four connected views', detail: 'Use the correct supplied mock for resources, allocations, DFX import preview and admin reports. Keep state consistent across views and role changes.', points: 25, category: 'Frontend' },
    { id: 'conflicts', title: 'Survive concurrent edits and retries', detail: 'Demonstrate 412 recovery, an explicit retry using the original idempotency key, a changed request using a new key, preserved failed input and blocked double submits.', points: 25, category: 'State management' },
    { id: 'async', title: 'Prevent stale async state', detail: 'Create a client-side network test adapter that delays an earlier response beyond a later one. Prove that switching filters/roles rapidly never leaks prior-role rows or restores outdated results.', points: 15, category: 'Testing' },
    { id: 'import', title: 'Explain an unfamiliar import', detail: 'Validate and preview DFX files before commit; show checksum/row errors, dry-run results and an atomic conflict. Export test evidence for a quoted embedded newline.', points: 15, category: 'Data processing' },
    { id: 'accessibility', title: 'Complete the workflow without a mouse', detail: 'Test 390px and desktop layouts, labels, focus restoration, error announcements and loading/empty/forbidden states. Display dates in Europe/Zurich.', points: 10, category: 'Accessibility' },
    { id: 'delivery', title: 'Provide reproducible browser evidence', detail: 'Include browser tests for the conflict and async cases, a fresh start command and a concise runbook. HTTP tests only validate the supplied mock, not your UI.', points: 10, category: 'Delivery' },
  ] : skill === 'database' ? [
    { id: 'reports', title: 'Solve six advanced relational reports', detail: 'Complete queries.json against 24 resources and 288 legacy allocations. Handle half-open peak demand, zero-inclusive aggregates, dense ranks, capacity violations, maximal idle gaps and deterministic latest-per-team rows.', points: 45, category: 'SQL' },
    { id: 'remediation', title: 'Reconcile an overbooked legacy dataset', detail: 'Write a transaction that resolves reported violations using a documented minimal cancellation policy. Prove it fixes every violation, preserves all rows and can roll back without losing the original report.', points: 20, category: 'Transactions' },
    { id: 'migration', title: 'Migrate safely, twice', detail: 'Add a nullable legacy reference, backfill deterministically, enforce uniqueness and apply the migration twice without data loss. Test a partially migrated database and roll back on a duplicate.', points: 15, category: 'Migration' },
    { id: 'query-plan', title: 'Justify the query plan', detail: 'Use EXPLAIN QUERY PLAN for a selective resource/time lookup. Demonstrate the chosen index and explain why a full-table scan may still be reasonable for an aggregate.', points: 10, category: 'Performance' },
    { id: 'delivery', title: 'Supply independent integrity tests', detail: 'Include executable tests for report values, constraints, empty inputs, ties, migration retry and rollback. Do not alter query-specs.json to make a test pass.', points: 10, category: 'Testing' },
  ] : skill === 'debugging' ? [
    { id: 'reproduce', title: 'Triage a broken existing service', detail: 'Run nationals.test.mjs against the supplied service. Prioritise the failing business invariants and capture minimal reproducers before editing the existing code.', points: 20, category: 'Debugging' },
    { id: 'repair', title: 'Repair faults across layers', detail: 'Fix engine.mjs without changing the contract, schema or expected tests. The service contains multiple independent faults in interval ordering, access isolation, idempotency, import atomicity and checksum validation.', points: 40, category: 'Correctness' },
    { id: 'regression', title: 'Prove the repaired version', detail: 'Pass the full adversarial suite; add at least five new tests for nearby failure modes. Verify two application processes share a persistent database safely and a replay still works after restart.', points: 25, category: 'Testing' },
    { id: 'explain', title: 'Explain and hand in the repair', detail: 'For every fault, include its root cause, a regression test and the reason the fix preserves valid behaviour. Deliver the exact version you tested.', points: 15, category: 'Delivery' },
  ] : [
    { id: 'contract', title: 'Design a service-level regression suite', detail: 'Expand submission.test.mjs from CONTRACT.md. Keep the correct baseline passing, including meaningful checks on status, state and side effects; do not edit engine.mjs.', points: 25, category: 'Testing' },
    { id: 'mutations', title: 'Kill eight realistic mutants', detail: 'Run mutation-check.mjs. Your suite must reject all eight supplied broken services without inspecting filenames or CANDIDATE_MODULE. Each mutant starts from a fresh isolated database.', points: 40, category: 'Mutation testing' },
    { id: 'concurrency', title: 'Prove retries and contention', detail: 'Use simultaneous requests and verify persisted ids, catalogue state and audit counts. Include team isolation, semantic key replay and changed-body conflicts.', points: 20, category: 'Integration' },
    { id: 'limits', title: 'Document the blind spots', detail: 'Record the mutation score, the property each test protects, and which UI, restart and cross-process guarantees are outside the suite. Include a reproducible test command.', points: 15, category: 'Delivery' },
  ];
  const moduleNames = skill === 'database' ? ['Inspect & reconcile', 'Window queries', 'Migration & rollback', 'Query plans & evidence'] : skill === 'debugging' ? ['Reproduce & prioritise', 'Repair across layers', 'Regression & restart', 'Explain & deliver'] : skill === 'testing' ? ['Read the contract', 'Build the regression suite', 'Mutation & contention', 'Close the evidence gaps'] : ['Domain model & API', 'Transactions & contention', 'Legacy import & reports', skill === 'backend' ? 'Independent verification' : 'Frontend & conflict recovery', 'Hand-in rehearsal'];
  const weights = moduleNames.length === 4 ? [0.15, 0.4, 0.3, 0.15] : [0.24, 0.26, 0.21, 0.22, 0.07];
  let allocated = 0;
  const modules = moduleNames.map((name, i) => { const minutes = i === moduleNames.length - 1 ? options.minutes - allocated : Math.floor(options.minutes * weights[i]); allocated += minutes; return { name, minutes, description: i === moduleNames.length - 1 ? 'Collect evidence and verify the submitted version.' : 'Prioritise a working slice and prove its invariants before expanding.' }; });
  const id = createHash('sha256').update(JSON.stringify({ ...options, scenario: scenario.id, version })).digest('hex').slice(0, 12);
  const summary = 'Deliver a resource-allocation system used by two competing teams. Shared capacity, duplicate retries, stale edits and a legacy exchange file interact: a fix in one layer must preserve every other invariant.';
  const scope = skill === 'database' ? 'Work directly in SQLite against an imperfect legacy dataset. Six report specifications and a real test runner are supplied. Then remediate violations and deliver a repeatable migration.' : skill === 'debugging' ? 'Repair an existing multi-layer Node/SQLite service with several independent defects. A server, source code, fresh seed and full adversarial HTTP suite are supplied.' : skill === 'testing' ? 'Write integration tests for a correct Node/SQLite service and use them to kill eight realistic mutants. Only a minimal starter test is supplied; derive the rest from CONTRACT.md.' : skill === 'frontend' ? 'Build the React/TypeScript client for the complete laboratory contract. A correct runnable SQLite-backed mock service is supplied; your challenge is conflict-safe, accessible UI state and independent browser evidence.' : 'Build the complete laboratory contract with durable SQLite storage' + (skill === 'fullstack' ? ' and a React/TypeScript client.' : '. No frontend is required.') + ' You receive the specification, schema, fixtures and adversarial tests; the solution is yours to implement. Java or .NET is encouraged for national-stack rehearsal.';
  const challenge: Challenge = {
    ...options, scenario: scenario.id, version, id, title: `${scenario.title} · Nationals lab`, client: scenario.client, city, summary,
    brief: [scope, `Client: ${scenario.client}. ${summary}`, 'Core rule: At every instant, active allocations across all teams must stay within resource capacity. Preserve that invariant under concurrent requests, cancellation, semantic retries and transaction rollback.', 'Input contract: CONTRACT.md defines exact endpoints, fake practice tokens, timestamp semantics, revision rules, DFX1 grammar and required error statuses. It is part of the brief.', 'Nationals scope: the connected modules and adversarial checks are mandatory. This is a hard practice laboratory; it is not a verified official 2027 paper. The selected time limit is your budget, not a promise that every feature can be completed.'],
    focus: skill === 'database' ? ['Window functions', 'Migration', 'Integrity'] : skill === 'testing' ? ['8 mutants', 'Concurrency', 'Integration'] : ['Transactions', 'Idempotency', 'DFX1 import', 'Team isolation'],
    criteria, fixtures, sql: sqlFor(fixtures), tests: [],
    endpoints: database ? [] : [
      { method: 'GET', path: '/api/resources', description: 'Shared catalogue; any supplied token. See CONTRACT.md for exact fields.', response: fixtures.resources, status: 200 },
      { method: 'POST', path: '/api/allocations', description: 'Team-scoped, atomic and idempotent. Requires Authorization and Idempotency-Key; full temporal-capacity rules are in CONTRACT.md.', request: { resource_id: 1, start_at: '2027-02-08T10:00:00Z', end_at: '2027-02-08T12:00:00Z', units: 1, external_ref: 'job-001' }, response: { id: 4, resource_id: 1, team_id: 1, status: 'active', revision: 1, start_at: '2027-02-08T10:00:00.000Z', end_at: '2027-02-08T12:00:00.000Z', units: 1, external_ref: 'job-001' }, status: 201 },
      { method: 'GET', path: '/api/allocations', description: 'Own team only, including cancelled records; admin sees all. GET /api/allocations/:id returns a single visible record.', response: [], status: 200 },
      { method: 'DELETE', path: '/api/allocations/:id', description: 'Require If-Match revision; 428 missing, 412 stale, 404 foreign/unknown. Soft cancellation releases capacity and audits once.', response: null, status: 204 },
      { method: 'POST', path: '/api/imports', description: 'Admin-only DFX1 text import. ?dry_run=1 validates without writes. A later conflict rolls back every inserted row.', response: { created: 2, dry_run: false }, status: 201 },
      { method: 'GET', path: '/api/report', description: 'Admin-only zero-inclusive active allocation aggregates. GET /api/audit returns one event per successful logical operation.', response: [{ resource_id: 1, active_count: 2, total_units: 2, unit_minutes: 120 }], status: 200 },
    ],
    twist: 'All core invariants interact. A passing happy path is insufficient.', deliverables: ['Runnable solution or repaired source and locked dependencies', 'Schema/migrations, seed/reset command and legacy-format evidence', 'Test output, restart/concurrency evidence and a clean-machine runbook', 'A brief statement of trade-offs and unfinished acceptance criteria'], modules, files: [],
  };
  challenge.files = filesFor(challenge, markdown);
  return challenge;
}

function filesFor(c: Challenge, markdown: (c: Challenge) => string): FileAsset[] {
  const files: FileAsset[] = [
    { name: 'BRIEF.md', content: markdown(c) }, { name: 'CONTRACT.md', content: nationalsContract },
    { name: 'challenge.json', content: JSON.stringify({ ...c, files: undefined }, null, 2) },
    { name: 'seed.sql', content: c.sql }, { name: 'fixtures.json', content: JSON.stringify(c.fixtures, null, 2) },
    { name: 'HAND-IN.md', content: '# Hand-in rehearsal\n\n- Install/build/start from a fresh folder.\n- Initialise a fresh database; never reset a real database implicitly.\n- Run and save the exact test output.\n- Restart and replay a committed operation.\n- Run two processes against one database and exercise contention.\n- Record assumptions, incomplete criteria and the submitted revision.\n\nPractice scores are self-assessed. Public tests are a lower bound, not a complete judge.\n' },
  ];
  let commands: string;
  if (c.mode === 'database') {
    const specs = databaseSpecs(c.fixtures as ReturnType<typeof databaseFixtures>);
    files.push(
      { name: 'query-specs.json', content: JSON.stringify(specs, null, 2) },
      { name: 'queries.json', content: JSON.stringify(Object.fromEntries(specs.map(s => [s.name, ''])), null, 2) },
      { name: 'database.test.mjs', content: String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const db=new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./seed.sql',import.meta.url),'utf8'));
const specs=JSON.parse(readFileSync(new URL('./query-specs.json',import.meta.url),'utf8'));
const queries=JSON.parse(readFileSync(new URL('./queries.json',import.meta.url),'utf8'));
for(const spec of specs)test(spec.name,()=>{
  assert.ok(queries[spec.name]?.trim(),'Fill queries.json');
  assert.deepEqual(db.prepare(queries[spec.name]).all().map(row=>({...row})),spec.expected);
});
` },
    );
    commands = 'Fill all six SQL values in queries.json, then run node --test database.test.mjs. CONTRACT.md describes the broader domain; this mode requires direct SQL, not an API. The legacy seed deliberately contains over-capacity intervals: report them before writing your remediation transaction. Add migration/integrity tests yourself.';
  } else if (c.mode === 'testing') {
    files.push(
      { name: 'engine.mjs', content: serviceSource }, { name: 'server.mjs', content: serverSource },
      { name: 'submission.test.mjs', content: String.raw`import { test } from 'node:test';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL || 'http://127.0.0.1:4100';
test('Seeded catalogue is available',async()=>{
  const response=await fetch(base+'/api/resources',{headers:{Authorization:'Bearer practice-alpha'}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).length,3);
});
` },
      { name: 'mutation-check.mjs', content: mutationRunnerSource },
      { name: 'mutations.json', content: JSON.stringify(faultPatches.map(({ id, description }) => ({ id, description })), null, 2) },
      ...faultPatches.map(p => ({ name: `mutants/${p.id}.mjs`, content: mutateService([p.id]) })),
    );
    commands = 'Write integration tests in submission.test.mjs. Run node mutation-check.mjs: it starts a fresh isolated service for the baseline and every mutant, then executes your suite. The starter deliberately misses all mutants. Target 8/8 killed while the correct baseline passes. Do not edit engine.mjs, the seed or the mutation runner to increase the score. Derive tests from CONTRACT.md.';
  } else {
    files.push({ name: 'nationals.test.mjs', content: adversarialTestSource });
    if (c.mode === 'debugging' || c.mode === 'frontend') files.push(
      { name: 'server.mjs', content: serverSource },
      { name: 'engine.mjs', content: c.mode === 'frontend' ? serviceSource : mutateService(['boundary-order', 'tenant-leak', 'retry-conflict', 'partial-import', 'checksum-ignored']) },
    );
    commands = (c.mode === 'debugging' ? 'Start the intentionally faulty service with node server.mjs. Repair engine.mjs. ' : c.mode === 'frontend' ? 'Start the correct practice mock with node server.mjs. It uses an in-memory SQLite database and resets on restart. Build your frontend separately and proxy /api to port 4100. ' : 'Implement CONTRACT.md in your own application, initialise a fresh database from seed.sql and start the API on port 4100. ') + 'Run node --test nationals.test.mjs against a FRESH seed. To use another port, set BASE_URL. The suite makes sequential writes and concurrent request bursts; restart/reset before rerunning. Add your own restart, cross-process and UI evidence. The suite does not execute your frontend.';
  }
  files.push({ name: 'START-HERE.md', content: `# Deadline Forge — Nationals laboratory\n\nUNOFFICIAL PRACTICE. Helpers require Node.js 24+ and no npm packages. The published national stack is Java or .NET; implement/translate your solution there when rehearsing that environment.\n\nRead BRIEF.md and CONTRACT.md.\n\n${commands}\n\nTo keep the supplied service on disk, set DATABASE_PATH to a NEW local SQLite path. For isolated tests leave it unset. To change its port set PORT. All tokens are public fake fixtures. Never run these destructive tests against a real service.\n\nSeed ${c.seed}; generator v${c.version}; id ${c.id}.\n` });
  return files;
}

export function databaseFixtures(n: number) {
  const teams = [{ id: 1, label: 'Team Alpha' }, { id: 2, label: 'Team Beta' }, { id: 3, label: 'Empty team' }, { id: 4, label: 'Another empty team' }];
  const resources: Resource[] = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, label: 'Resource ' + String(i + 1).padStart(2, '0'), capacity: 2 + ((i + n) % 5), enabled: i % 9 ? 1 : 0 }));
  const allocations: Allocation[] = resources.flatMap(r => Array.from({ length: 12 }, (_, i) => {
    const start = iso(8) + ((i * 30 + r.id * 7 + n % 20) % 420) * 60000;
    const cancelled = i % 4 === 0 || r.id === 24;
    return { id: (r.id - 1) * 12 + i + 1, resource_id: r.id, team_id: i % 2 + 1, start_ms: start, end_ms: Math.min(iso(16), start + (30 + (i % 3) * 30) * 60000), units: 1 + i % 3, external_ref: 'legacy-' + r.id + '-' + i, status: cancelled ? 'cancelled' : 'active', revision: cancelled ? 2 : 1 };
  }));
  return { teams, resources, allocations, idempotency: [], audit: [] };
}
export function databaseSpecs(f: ReturnType<typeof databaseFixtures>) {
  const active = f.allocations.filter(a => a.status === 'active');
  const peaks = f.resources.map(r => {
    const events = active.filter(a => a.resource_id === r.id).flatMap(a => [[a.start_ms, a.units], [a.end_ms, -a.units]]);
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let used = 0, peak = 0;
    for (const [, delta] of events) { used += delta; peak = Math.max(used, peak); }
    return { resource_id: r.id, peak_units: peak };
  });
  const loads = f.resources.map(r => { const rows = active.filter(a => a.resource_id === r.id); return { resource_id: r.id, active_count: rows.length, unit_minutes: rows.reduce((n, a) => n + a.units * (a.end_ms - a.start_ms) / 60000, 0) }; });
  const totals = f.teams.map(t => ({ team_id: t.id, unit_minutes: active.filter(a => a.team_id === t.id).reduce((n, a) => n + a.units * (a.end_ms - a.start_ms) / 60000, 0) }));
  const distinct = [...new Set(totals.map(t => t.unit_minutes))].sort((a, b) => b - a);
  const gaps: { resource_id: number; start_ms: number; end_ms: number; gap_minutes: number }[] = [];
  for (const resource of f.resources) {
    const rows = active.filter(a => a.resource_id === resource.id).sort((a, b) => a.start_ms - b.start_ms || a.id - b.id);
    let cursor = iso(8);
    for (const row of rows) { if (row.start_ms > cursor) gaps.push({ resource_id: resource.id, start_ms: cursor, end_ms: row.start_ms, gap_minutes: (row.start_ms - cursor) / 60000 }); cursor = Math.max(cursor, row.end_ms); }
    if (cursor < iso(16)) gaps.push({ resource_id: resource.id, start_ms: cursor, end_ms: iso(16), gap_minutes: (iso(16) - cursor) / 60000 });
  }
  return [
    { name: 'resource-load', description: 'Every resource, including unused/disabled: resource_id, active_count, unit_minutes for active rows only. Order by resource_id.', expected: loads },
    { name: 'peak-load', description: 'Every resource: resource_id, peak_units at any instant using half-open intervals. Coincident end/start changes must not produce a false spike. Order by resource_id.', expected: peaks },
    { name: 'team-leaderboard', description: 'Every team, including empty: team_id, unit_minutes, demand_rank. Dense rank by unit_minutes descending; order by team_id.', expected: totals.map(t => ({ ...t, demand_rank: distinct.indexOf(t.unit_minutes) + 1 })) },
    { name: 'capacity-violations', description: 'Resources whose active peak exceeds capacity: resource_id, peak_units, capacity. Order by resource_id.', expected: peaks.filter(p => p.peak_units > f.resources[p.resource_id - 1].capacity).map(p => ({ ...p, capacity: f.resources[p.resource_id - 1].capacity })) },
    { name: 'maximal-idle-gaps', description: `Maximal positive-length intervals with zero active demand, clipped to [${iso(8)},${iso(16)}). Merge overlapping AND touching active intervals before taking gaps. Columns: resource_id,start_ms,end_ms,gap_minutes. Order by resource_id,start_ms.`, expected: gaps },
    { name: 'latest-per-team', description: 'Every team: team_id,allocation_id (NULL for empty team). Choose ACTIVE row with greatest start_ms, breaking ties by greatest id. Order by team_id.', expected: f.teams.map(t => ({ team_id: t.id, allocation_id: active.filter(a => a.team_id === t.id).sort((a, b) => b.start_ms - a.start_ms || b.id - a.id)[0]?.id ?? null })) },
  ];
}
