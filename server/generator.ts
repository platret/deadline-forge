import { createHash } from 'node:crypto';
import type { Challenge, Criterion, GenerateOptions } from '../shared/types';
import { modeLabels } from '../shared/types';
import { research } from '../shared/research';
import { makeScenarios, type Scenario } from './scenarios';
import { makeNationals } from './nationals';

export const GENERATOR_VERSION = 2;
export const scenarioOptions = [
  { id: 'booking', title: 'Workspace booking' }, { id: 'inventory', title: 'Workshop stock control' },
  { id: 'tickets', title: 'Repair desk workflow' }, { id: 'events', title: 'Workshop registrations' },
];

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function sqlValue(value: unknown) {
  if (typeof value === 'number') return String(value);
  if (value === null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
function seedSql(scenario: Scenario) {
  let sql = `PRAGMA foreign_keys = ON;\nBEGIN;\n${scenario.schema}\n`;
  for (const [table, rows] of Object.entries(scenario.fixtures)) {
    for (const row of rows) sql += `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(sqlValue).join(', ')});\n`;
  }
  return sql + 'COMMIT;\n';
}

export function generateChallenge(options: GenerateOptions): Challenge {
  const digest = hash(`${GENERATOR_VERSION}:${options.seed}`);
  const n = parseInt(digest.slice(0, 8), 16);
  const cities = ['Bern', 'Luzern', 'Zürich', 'Basel', 'Winterthur', 'St. Gallen', 'Lausanne', 'Chur'];
  const city = cities[n % cities.length];
  const scenarios = makeScenarios(n, city);
  const scenario = options.scenario ? scenarios.find(s => s.id === options.scenario) : scenarios[(n >>> 4) % scenarios.length];
  if (!scenario) throw new Error('Unknown scenario');
  if (options.difficulty === 'nationals') return makeNationals(options, scenario, n, GENERATOR_VERSION, briefMarkdown, city);
  for (const test of scenario.tests) {
    if (test.method === 'GET' && test.length) {
      const table = test.path.split('/').at(-1)!;
      const first = scenario.fixtures[table]?.[0];
      if (first) test.contains = { ...first };
    }
  }
  if (scenario.id === 'inventory') scenario.tests.push({ name: 'Stock change is visible after the movement', method: 'GET', path: '/api/products', status: 200, length: 3, contains: { id: 1, stock: Number(scenario.fixtures.products[0].stock) - 2 } });
  if (scenario.id === 'tickets') scenario.tests.push({ name: 'Transition is visible in the queue', method: 'GET', path: '/api/tickets', status: 200, length: 4, contains: { id: 1, status: 'in_progress' } });
  const twists = [
    'Provide a CSV export of the primary collection with a header row, RFC 4180 quoting and UTF-8 encoding. Neutralise spreadsheet cells beginning with =, +, - or @. Verify with a value containing a comma and a quote.',
    'Add server-side pagination to the primary collection: ?page=1&limit=2, with a default limit of 20 and a maximum of 100. Keep the response a JSON array; include X-Total-Count. No query parameters must still return all seeded rows for the supplied tests.',
    'Add an audit log for every successful mutation, recording UTC timestamp, action and entity id. Rejected operations must leave no audit entry. Show the log in a separate view.',
    'Support idempotency on POST using an Idempotency-Key header. Repeating the same key and body returns the original response without another write; reusing the key with a different body returns 409.',
  ];
  const twist = twists[(n >>> 8) % twists.length];
  const { mode, difficulty } = options;
  const pureContracts: Record<string, string> = {
    booking: 'evaluate(start, end, existingStart, existingEnd) returns a boolean indicating overlap. All four inputs are finite numbers; both input intervals are valid (start < end). Intervals are half-open, so touching endpoints do not overlap. Input parsing/validation is outside this pure function.',
    inventory: 'evaluate(stock, delta) returns true only when stock is a non-negative integer, delta is a nonzero integer and stock + delta >= 0. It returns false for every other numeric input.',
    tickets: 'evaluate(from, to) returns true only for open → in_progress and in_progress → resolved. Every other pair of strings, including unknown statuses and no-op transitions, returns false.',
    events: 'evaluate(capacity, count, emails, email) returns true only for integer capacity/count, non-negative count below capacity, and no duplicate of email in emails after trimming and case normalisation. The emails argument is an array of syntactically valid addresses; email is a syntactically valid address. Syntax validation and seat writes are outside this pure function.',
  };
  const criteria: Criterion[] = [];
  const add = (id: string, title: string, detail: string, points: number, category: string) => criteria.push({ id, title, detail, points, category });
  if (mode === 'fullstack') {
    add('flow', 'Complete the main workflow', `Build a React list and create form for ${scenario.collection}. Load real API data, validate inputs, and update the screen after successful writes.`, 25, 'Frontend');
    add('rule', 'Enforce the business rule', scenario.rule, 25, 'Backend');
    add('contract', 'Meet the API contract', 'Implement every listed endpoint. Return JSON records with the documented fields; errors use {"error":"human readable message"}. Validate before writing.', 15, 'Backend');
    add('storage', 'Persist across a restart', 'Use the supplied SQLite schema and data. Restart the server and verify created records remain. Every multi-write operation must be atomic.', 15, 'Database');
    add('tests', 'Show regression evidence', 'Pass the supplied API tests against your solution and add one regression test for a boundary case. The tests cover a subset of the brief.', 10, 'Testing');
    add('handoff', 'Deliver a reproducible hand-in', 'Include source, exact install/run commands, a seed/reset command, test evidence and any assumptions. Rehearse from a clean folder.', 10, 'Delivery');
  } else if (mode === 'frontend') {
    add('flow', 'Build the primary screens', `Build an accessible React list, a create form and a detail view for ${scenario.collection}. Use the supplied mock API on port 4100.`, 30, 'Frontend');
    add('feedback', 'Handle every UI state', 'Show initial loading, an empty list, an API failure, field validation and pending submissions. Retain input after a failed request and prevent accidental double submits.', 25, 'Frontend');
    add('a11y', 'Make the workflow accessible', 'Use associated labels, visible focus, semantic controls and an aria-live error message. Complete the main workflow with a keyboard at a 390px viewport.', 20, 'Frontend');
    add('rule', 'Explain domain failures', `${scenario.rule} The mock handles the rule; present its errors clearly and refresh after successful mutations.`, 15, 'Frontend');
    add('handoff', 'Prove the interaction', 'Record manual or browser-test evidence for create, failure and keyboard navigation. Document how to run your frontend and the mock.', 10, 'Delivery');
  } else if (mode === 'backend') {
    add('contract', 'Implement every endpoint', 'Meet the listed method, path, response and status contracts. Order collection arrays by id. Return JSON errors shaped {"error":"message"}.', 30, 'Backend');
    add('rule', 'Protect domain invariants', scenario.rule, 30, 'Backend');
    add('storage', 'Use durable SQLite transactions', 'Initialise from seed.sql; use parameterised SQL and atomic writes. Prove records survive process restart. Do not reset data at every startup.', 20, 'Database');
    add('tests', 'Pass and extend the API checks', 'Run the exported tests against a freshly seeded solution. Add malformed JSON, unknown-id and boundary-value coverage.', 15, 'Testing');
    add('handoff', 'Provide the runbook', 'Document startup, reset, assumptions and the test command.', 5, 'Delivery');
  } else if (mode === 'database') {
    add('queries', 'Solve the report queries', 'Fill each SQL value in queries.json. Return exactly the specified columns, values and ordering. Run node --test database.test.mjs.', 40, 'Database');
    add('rule', 'Enforce the data rules', `Review seed.sql constraints. Write an SQL transaction demonstrating this invariant: ${scenario.rule}`, 25, 'Database');
    add('integrity', 'Demonstrate rollback', 'Add integrity.test.mjs proving a failed foreign key/constraint write rolls back without partial changes. Include an empty result and NULL-handling case.', 20, 'Testing');
    add('plan', 'Inspect a query plan', 'Use EXPLAIN QUERY PLAN on your most selective query. Explain your chosen index and show that the query still returns the same results.', 10, 'Database');
    add('handoff', 'Document the migration', 'Explain how to create a fresh database and run the tests without absolute paths.', 5, 'Delivery');
  } else if (mode === 'debugging') {
    add('reproduce', 'Reproduce before editing', 'Run node --test regression.test.mjs against engine.mjs. Record one failing input and the expected behaviour in notes.md.', 20, 'Debugging');
    add('rule', 'Repair the domain function', `Fix evaluate() in engine.mjs with the smallest correct change. ${scenario.rule} The exported function tests the numeric/state/duplicate rule only; API parsing is out of scope.`, 40, 'Debugging');
    add('regressions', 'Pass the regression suite', 'Make every supplied regression test pass. Add at least two further cases; avoid hardcoding the sample inputs.', 25, 'Testing');
    add('explain', 'Explain the root cause', 'Record why the original implementation failed, why your fix is sufficient and which related failure you checked.', 15, 'Delivery');
  } else {
    add('baseline', 'Keep correct behaviour passing', 'The supplied engine.mjs contains a correct rule implementation. Extend regression.test.mjs; keep the baseline passing without editing engine.mjs.', 20, 'Testing');
    add('boundaries', 'Cover boundaries and failures', `Write meaningful tests for evaluate(). ${scenario.rule} Only the pure function contract is in scope, not HTTP validation.`, 35, 'Testing');
    add('mutation', 'Kill all supplied mutants', 'Run node mutation-check.mjs. Your suite must pass for the baseline and fail for all three deliberately broken implementations. Do not special-case CANDIDATE_MODULE.', 30, 'Testing');
    add('explain', 'Explain what the suite misses', 'Describe one risk your pure-function suite cannot catch and one integration test you would add in a production app.', 15, 'Delivery');
  }
  if (difficulty === 'competition') {
    const last = criteria[criteria.length - 1];
    last.detail += ' Reserve the last 10% of the time limit for the hand-in rehearsal.';
  }
  if (difficulty !== 'foundation') {
    const shift = Math.min(10, criteria[0].points - 5);
    criteria[0].points -= shift;
    const detail = mode === 'fullstack' || mode === 'frontend'
      ? `Add a summary view computed from current data: ${sReport(scenario)} Refresh it after successful mutations.`
      : mode === 'backend'
        ? `Add GET /api/report returning this report as a JSON array: ${sReport(scenario)} Include a regression test and recalculate after mutations.`
        : mode === 'database'
          ? 'Repeat both reports after inserting a new row inside a transaction. Check their updated expected values and roll back. Show that the original report values are restored.'
          : 'Add at least two additional boundary or invalid-state tests beyond the supplied example cases and explain which fault each detects.';
    add('independent', 'Go beyond the supplied checks', detail, shift, mode === 'database' ? 'Database' : 'Testing');
  }
  if (difficulty === 'stretch') {
    for (const c of criteria) c.points = Math.floor(c.points * 0.8);
    const remaining = 100 - criteria.reduce((sum, c) => sum + c.points, 0);
    const detail = ['fullstack', 'backend', 'frontend'].includes(mode) ? twist
      : mode === 'database' ? 'Add a non-destructive schema migration and test it twice against an existing database. Include rollback evidence and preserve every seeded row.'
      : 'Add a seeded property-based loop of at least 200 cases to test the rule. State the invariant; show that the suite catches a new mutant you write yourself.';
    add('stretch', 'Handle the extra constraint', detail, remaining, 'Extension');
  }
  if (mode === 'debugging' || mode === 'testing') {
    const ruleCriterion = criteria.find(c => c.id === (mode === 'debugging' ? 'rule' : 'boundaries'))!;
    ruleCriterion.detail = `${pureContracts[scenario.id]} ${mode === 'debugging' ? 'Make the smallest correct repair; keep the function name and signature.' : 'Design tests from this contract and keep correct behaviour passing.'}`;
  }
  const focus = mode === 'fullstack' ? ['React', 'TypeScript', 'API', 'SQLite'] : {
    frontend: ['React', 'Accessibility', 'API states'], backend: ['HTTP contracts', 'Validation', 'SQLite'],
    database: ['SQLite', 'Transactions', 'Query plans'], debugging: ['Reproduction', 'Boundary cases', 'Regression'], testing: ['Node tests', 'Mutation testing', 'Invariants'],
  }[mode];
  const id = hash(JSON.stringify({ mode: options.mode, difficulty: options.difficulty, minutes: options.minutes, seed: options.seed, scenario: scenario.id, version: GENERATOR_VERSION })).slice(0, 12);
  const scope = {
    fullstack: 'Build the complete vertical slice: React/TypeScript frontend, an HTTP API and SQLite persistence. Use the contract below as your hand-in interface.',
    frontend: 'Build only the React/TypeScript client. A working in-memory mock API is included in the kit. It resets on restart and is practice support, not your persistence solution.',
    backend: 'Build only the HTTP API and SQLite layer. Use TypeScript or translate the brief to Java/.NET for national-stack practice. No frontend is required.',
    database: 'Work directly in SQLite. Implement the two specified report queries and demonstrate constraints and transactions. No frontend or API is required.',
    debugging: 'Repair a deliberately defective pure business-rule function. The kit includes a runnable failing test suite. No full app is required.',
    testing: 'Design a regression suite for a supplied pure business-rule function. Use the included mutation runner to measure whether your suite detects known faults.',
  }[mode];
  const challenge: Challenge = {
    ...options, scenario: scenario.id, version: GENERATOR_VERSION, id, title: scenario.title, client: scenario.client, city,
    summary: scenario.summary, focus, criteria, fixtures: scenario.fixtures, sql: seedSql(scenario),
    endpoints: ['fullstack', 'backend', 'frontend'].includes(mode) ? [
      ...scenario.endpoints,
      ...(mode === 'backend' && difficulty !== 'foundation' ? [{ method: 'GET', path: '/api/report', description: `${sReport(scenario)} Compute from current stored data.`, response: scenario.queries[0].expected, status: 200 }] : []),
    ] : [],
    tests: ['fullstack', 'backend', 'frontend'].includes(mode) ? scenario.tests : [],
    brief: [scope, `Client: ${scenario.client}, ${city}, Switzerland. ${scenario.summary}`, `Core rule: ${scenario.rule}`, `Input contract: ${mode === 'debugging' || mode === 'testing' ? pureContracts[scenario.id] : scenario.fields + '. Unknown ids are not silently created.'}`,
      difficulty === 'foundation' ? 'Foundation scope: use the core workflow and fixed fixtures. Prioritise correctness and a clean hand-in; no stretch feature is required.' : difficulty === 'competition' ? 'Competition scope: work independently against the clock, prioritise by points and leave time to test the submitted version.' : 'Stretch scope: complete the core and the extra constraint. The exported tests are a starting suite; add evidence for the extension yourself.' ],
    twist, deliverables: mode === 'debugging' || mode === 'testing' ? ['Your edited source and test files', 'Test output and a short notes.md', 'A repeatable run command'] : mode === 'database' ? ['queries.json with completed SQL', 'Transaction/migration SQL and integrity tests', 'Test evidence and a short runbook'] : ['Runnable source with pinned dependencies', 'Database schema and seeded data (backend/full stack)', 'Test evidence and startup/reset instructions', 'A brief note of assumptions and incomplete criteria'], files: [],
  };
  challenge.files = kitFiles(challenge, scenario);
  return challenge;
}

export function briefMarkdown(c: Challenge) {
  const modules = c.modules?.length ? '\n## Connected modules (suggested budget)\n\n' + c.modules.map((m, i) => `${i + 1}. ${m.name} — ${m.minutes} minutes. ${m.description}`).join('\n') + '\n' : '';
  return `# ${c.title}\n\n**UNOFFICIAL PRACTICE — not an official competition task.**\n\nSeed: ${c.seed} | Generator v${c.version} | ${modeLabels[c.mode]} | ${c.difficulty} | ${c.minutes} minutes\n\n${c.brief.map(p => p + '\n').join('\n')}${modules}\n## Acceptance criteria (self-assessed, 100 points)\n\n${c.criteria.map(x => `- [ ] ${x.title} (${x.points}): ${x.detail}`).join('\n')}\n\n## Deliverables\n\n${c.deliverables.map(x => '- ' + x).join('\n')}\n\n## Important competition context\n\n${research.stack}\n\n${research.disclaimer}\n\nSources checked ${research.checked}:\n${research.sources.map(s => `- [${s.title}](${s.url}) — ${s.findings}`).join('\n')}\n\n${research.unknown}\n`;
}

function kitFiles(c: Challenge, s: Scenario) {
  const files = [
    { name: 'BRIEF.md', content: briefMarkdown(c) },
    { name: 'challenge.json', content: JSON.stringify({ ...c, files: undefined }, null, 2) },
    { name: 'seed.sql', content: c.sql },
    { name: 'fixtures.json', content: JSON.stringify(c.fixtures, null, 2) },
  ];
  let commands = '';
  if (c.mode === 'database') {
    files.push(
      { name: 'queries.json', content: JSON.stringify(Object.fromEntries(s.queries.map(q => [q.name, ''])), null, 2) },
      { name: 'query-specs.json', content: JSON.stringify(s.queries, null, 2) },
      { name: 'database.test.mjs', content: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { DatabaseSync } from 'node:sqlite';\nimport { readFileSync } from 'node:fs';\nconst db = new DatabaseSync(':memory:');\ndb.exec(readFileSync(new URL('./seed.sql', import.meta.url), 'utf8'));\nconst queries = JSON.parse(readFileSync(new URL('./queries.json', import.meta.url), 'utf8'));\nconst specs = JSON.parse(readFileSync(new URL('./query-specs.json', import.meta.url), 'utf8'));\nfor (const spec of specs) test(spec.name, () => {\n  assert.ok(queries[spec.name]?.trim(), 'Fill the SQL query in queries.json');\n  const actual = db.prepare(queries[spec.name]).all().map(row => ({ ...row }));\n  assert.deepEqual(actual, spec.expected);\n});\n` },
    );
    commands = 'Fill queries.json with SQL, then run:\n\n    node --test database.test.mjs\n\nThe tests create an isolated in-memory database. Add integrity.test.mjs for transaction/constraint evidence.';
  } else if (c.mode === 'debugging' || c.mode === 'testing') {
    const tests = c.mode === 'testing' ? s.unitTests.slice(0, 1) : c.difficulty === 'foundation' ? s.unitTests.slice(0, 3) : s.unitTests;
    files.push(
      { name: 'engine.mjs', content: c.mode === 'debugging' ? s.bug : s.correct },
      { name: 'test-cases.json', content: JSON.stringify(s.unitTests, null, 2) },
      { name: 'regression.test.mjs', content: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nconst { evaluate } = await import(new URL(process.env.CANDIDATE_MODULE || './engine.mjs', import.meta.url));\n\n${tests.map(t => `test(${JSON.stringify(t.name)}, () => {\n  assert.equal(evaluate(...${JSON.stringify(t.input)}), ${JSON.stringify(t.expected)});\n});`).join('\n\n')}\n` },
    );
    if (c.mode === 'testing') files.push(
      { name: 'mutants/boundary.mjs', content: s.bug },
      { name: 'mutants/always-true.mjs', content: 'export const evaluate = () => true;\n' },
      { name: 'mutants/always-false.mjs', content: 'export const evaluate = () => false;\n' },
      { name: 'mutation-check.mjs', content: `import { spawnSync } from 'node:child_process';\nconst run = file => spawnSync(process.execPath, ['--test', 'regression.test.mjs'], { cwd: new URL('.', import.meta.url), env: { ...process.env, CANDIDATE_MODULE: file }, encoding: 'utf8', timeout: 30000 });\nconst baseline = run('./engine.mjs');\nif (baseline.status !== 0) { console.error('Baseline must pass.\\n', baseline.stdout, baseline.stderr); process.exit(1); }\nlet killed = 0;\nfor (const file of ['boundary', 'always-true', 'always-false']) {\n  const result = run('./mutants/' + file + '.mjs');\n  if (result.error || result.signal) { console.error('Runner failed for ' + file, result.error || result.signal); process.exit(1); }\n  if (result.status !== 0) { killed++; console.log('KILLED ' + file); } else console.log('SURVIVED ' + file);\n}\nconsole.log(killed + '/3 mutants killed');\nif (killed < 3) process.exitCode = 1;\n` },
    );
    commands = `Run the ${c.mode === 'debugging' ? 'intentionally failing' : 'starter'} suite:\n\n    node --test regression.test.mjs\n\n${c.mode === 'debugging' ? 'Fix engine.mjs. Add your own cases to regression.test.mjs.' : 'Expand regression.test.mjs, then run node mutation-check.mjs. The starter intentionally misses mutants; 3/3 is your target.'}\n\nThe function contract is in BRIEF.md and engine.mjs. test-cases.json provides examples; do not hardcode them. seed.sql and fixtures.json are context for optional integration work.`;
  } else {
    files.push(
      { name: 'api-contract.json', content: JSON.stringify(c.endpoints, null, 2) },
      { name: 'api-cases.json', content: JSON.stringify(c.tests, null, 2) },
      { name: 'api.test.mjs', content: `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nconst base = process.env.BASE_URL || 'http://127.0.0.1:4100';\nconst cases = JSON.parse(readFileSync(new URL('./api-cases.json', import.meta.url), 'utf8'));\ntest('API contract (run against freshly seeded solution)', async t => {\n  for (const spec of cases) await t.test(spec.name, async () => {\n    const response = await fetch(base + spec.path, { method: spec.method, headers: { 'Content-Type': 'application/json' }, body: spec.body === undefined ? undefined : JSON.stringify(spec.body), signal: AbortSignal.timeout(5000) });\n    assert.equal(response.status, spec.status, spec.name);\n    if (spec.status === 204) { assert.equal(await response.text(), ''); return; }\n    assert.match(response.headers.get('content-type') || '', /application\\/json/);\n    const data = await response.json();\n    if (spec.status >= 400) assert.equal(typeof data.error, 'string');\n    if (spec.length !== undefined) { assert.ok(Array.isArray(data)); assert.equal(data.length, spec.length); }\n    if (spec.contains) { assert.ok(Array.isArray(data)); assert.ok(data.some(row => Object.entries(spec.contains).every(([key, value]) => JSON.stringify(row[key]) === JSON.stringify(value))), 'Expected a matching record in response'); }\n    for (const [key, value] of Object.entries(spec.equals || {})) assert.deepEqual(data[key], value);\n  });\n});\n` },
    );
    commands = 'Implement the API contract in your own solution (or use the frontend mock below). Initialise a FRESH database from seed.sql before each test run; the suite makes sequential writes. Then run:\n\n    BASE_URL=http://127.0.0.1:4100 node --test api.test.mjs\n\nOn PowerShell: $env:BASE_URL="http://127.0.0.1:4100"; node --test api.test.mjs\n\nThese tests cover core API cases only. They do not assess your frontend, durability, concurrency or stretch constraint. The checklist is self-assessment, not an automated judge.';
    if (c.mode === 'frontend') {
      files.push({ name: 'mock-server.mjs', content: mockServer(s.id) });
      commands += '\n\nFrontend support: run node mock-server.mjs in this folder. It serves the documented API at http://127.0.0.1:4100 using fixtures.json in memory. Restart to reset. Configure your Vite /api proxy to that address. Build the React client yourself. The mock has no disk persistence and does not implement stretch extensions.';
    }
  }
  files.push({ name: 'START-HERE.md', content: `# Practice kit\n\nUNOFFICIAL. Node.js 24 or newer is required for the supplied helpers; no npm packages are required. The actual solution is yours to build.\n\nRead BRIEF.md first.\n\n${commands}\n\nSeed ${c.seed} · generator v${c.version} · id ${c.id}\n\nDo not point test scripts at a production service; they create and delete fixture records.\n` });
  return files;
}

function mockServer(scenario: string) {
  return `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const scenario = ${JSON.stringify(scenario)};
const server = createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(status === 204 ? undefined : JSON.stringify(body)); };
  const error = (status, message) => send(status, { error: message });
  try {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const table = parts[1];
    const id = Number(parts[2]);
    if (parts[0] !== 'api' || !Object.hasOwn(data, table)) return error(404, 'Not found');
    if (req.method === 'GET' && parts.length === 2) return send(200, data[table]);
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 16000) return error(413, 'Body too large'); }
    let body; try { body = raw ? JSON.parse(raw) : {}; } catch { return error(400, 'Invalid JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error(400, 'Expected an object');
    const rows = data[table];
    if (req.method === 'DELETE' && parts.length === 3 && ['bookings','registrations'].includes(table)) {
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) return error(404, 'Record not found');
      rows.splice(index, 1); return send(204);
    }
    const nextId = Math.max(0, ...rows.map(row => row.id)) + 1;
    if (scenario === 'tickets' && table === 'tickets' && req.method === 'PATCH' && parts.length === 3) {
      if (!['open','in_progress','resolved'].includes(body.status)) return error(400, 'Invalid status');
      const row = rows.find(row => row.id === id);
      if (!row) return error(404, 'Ticket not found');
      if (!((row.status === 'open' && body.status === 'in_progress') || (row.status === 'in_progress' && body.status === 'resolved'))) return error(409, 'Transition not allowed');
      row.status = body.status; return send(200, row);
    }
    if (req.method !== 'POST' || parts.length !== 2) return error(405, 'Method not allowed');
    let record;
    const text = value => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80;
    if (scenario === 'booking' && table === 'bookings') {
      const start = Date.parse(body.starts_at), end = Date.parse(body.ends_at);
      if (!Number.isInteger(body.room_id) || !text(body.organiser) || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) return error(400, 'Invalid booking');
      if (!data.rooms.some(row => row.id === body.room_id)) return error(404, 'Room not found');
      if (rows.some(row => row.room_id === body.room_id && start < Date.parse(row.ends_at) && end > Date.parse(row.starts_at))) return error(409, 'Room already booked');
      record = { id: nextId, room_id: body.room_id, starts_at: body.starts_at, ends_at: body.ends_at, organiser: body.organiser.trim() };
    } else if (scenario === 'inventory' && table === 'movements') {
      if (!Number.isInteger(body.product_id) || !Number.isInteger(body.delta) || body.delta === 0 || !text(body.reason)) return error(400, 'Invalid movement');
      const product = data.products.find(row => row.id === body.product_id);
      if (!product) return error(404, 'Product not found');
      if (product.stock + body.delta < 0) return error(409, 'Insufficient stock');
      product.stock += body.delta;
      record = { id: nextId, product_id: body.product_id, delta: body.delta, reason: body.reason.trim() };
    } else if (scenario === 'tickets' && table === 'tickets') {
      if (!text(body.title) || !Number.isInteger(body.priority) || body.priority < 1 || body.priority > 3) return error(400, 'Invalid ticket');
      record = { id: nextId, title: body.title.trim(), priority: body.priority, status: 'open' };
    } else if (scenario === 'events' && table === 'registrations') {
      if (!Number.isInteger(body.event_id) || typeof body.email !== 'string' || body.email.trim().length > 120 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(body.email.trim())) return error(400, 'Invalid registration');
      const event = data.events.find(row => row.id === body.event_id);
      if (!event) return error(404, 'Event not found');
      const email = body.email.trim().toLowerCase();
      if (rows.filter(row => row.event_id === event.id).length >= event.capacity || rows.some(row => row.event_id === event.id && row.email === email)) return error(409, 'Full event or duplicate email');
      record = { id: nextId, event_id: event.id, email };
    } else return error(405, 'Method not allowed');
    rows.push(record); return send(201, record);
  } catch { return error(500, 'Mock error'); }
});
server.listen(Number(process.env.PORT || 4100), '127.0.0.1', () => console.log('Practice mock: http://127.0.0.1:' + server.address().port + ' (restart to reset)'));
`;
}

function sReport(scenario: Scenario) { return scenario.queries[0].description; }
