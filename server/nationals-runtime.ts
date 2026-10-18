export const serviceSource = String.raw`import { createHash } from 'node:crypto';

export function createEngine(db) {
  const tokens = { 'practice-alpha': { team: 1, admin: false }, 'practice-beta': { team: 2, admin: false }, 'practice-admin': { team: 3, admin: true } };
  const all = (sql, ...args) => db.prepare(sql).all(...args).map(row => ({ ...row }));
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const execute = (sql, ...args) => db.prepare(sql).run(...args);
  const abort = (status, message) => { throw Object.assign(new Error(message), { status }); };
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function audit(action, actor, entity) {
    execute('INSERT INTO audit(action,team_id,entity_id) VALUES (?,?,?)', action, actor.team, entity);
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) abort(400, 'Expected a timezone-qualified timestamp on a minute boundary');
    const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/).map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59) abort(400, 'Invalid calendar date');
    const result = Date.parse(value);
    if (!Number.isFinite(result)) abort(400, 'Invalid timestamp');
    return result;
  }
  function hasCapacity(resource, start, end, units) {
    const events = [[start, units], [end, -units]];
    for (const row of all("SELECT * FROM allocations WHERE resource_id=? AND status='active' AND start_ms < ? AND end_ms > ?", resource.id, end, start)) {
      events.push([row.start_ms, row.units], [row.end_ms, -row.units]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let used = 0;
    for (const [, delta] of events) { used += delta; if (used > resource.capacity) return false; }
    return true;
  }
  const visible = (actor, row) => actor.admin || row.team_id === actor.team;
  const record = row => ({ id: row.id, resource_id: row.resource_id, team_id: row.team_id, start_at: new Date(row.start_ms).toISOString(), end_at: new Date(row.end_ms).toISOString(), units: row.units, external_ref: row.external_ref, status: row.status, revision: row.revision });
  function csvRows(text) {
    const rows = []; let row = [], cell = '', quoted = false, closed = false;
    const emitCell = () => { row.push(cell); cell = ''; closed = false; };
    const emitRow = () => { emitCell(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (char === '"') { quoted = false; closed = true; }
        else cell += char;
      } else if (char === '"') {
        if (cell || closed) abort(400, 'Unexpected quote');
        quoted = true;
      } else if (char === ';') emitCell();
      else if (char === '\n') emitRow();
      else { if (closed) abort(400, 'Text after closing quote'); cell += char; }
    }
    if (quoted || row.length || cell.length || closed) abort(400, 'Unterminated CSV row');
    return rows;
  }
  function parseImport(raw) {
    const normal = raw.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
    const match = /^DFX1\n([\s\S]+)\n#rows=(\d+);sha256=([a-f0-9]{64})\n?$/.exec(normal);
    if (!match) abort(400, 'Invalid DFX envelope');
    const csv = match[1] + '\n';
    const digest = createHash('sha256').update(csv, 'utf8').digest('hex');
    if (digest !== match[3]) abort(400, 'Checksum mismatch');
    const rows = csvRows(csv);
    if (rows.shift()?.join(';') !== 'id;label;capacity;enabled' || rows.length !== Number(match[2])) abort(400, 'Header or row count mismatch');
    const seen = new Set();
    return rows.map(cells => {
      if (cells.length !== 4 || !/^[1-9]\d*$/.test(cells[0]) || !/^[1-9]\d*$/.test(cells[2]) || !/^[01]$/.test(cells[3])) abort(400, 'Invalid resource columns');
      const id = Number(cells[0]), capacity = Number(cells[2]), label = cells[1].trim();
      if (!Number.isSafeInteger(id) || capacity > 1000 || !label || label.length > 120 || seen.has(id)) abort(400, 'Invalid or duplicate resource');
      seen.add(id); return { id, label, capacity, enabled: Number(cells[3]) };
    });
  }
  function handle({ method, path, headers = {}, raw = '' }) {
    const h = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const ok = (status, body) => ({ status, body });
    try {
      const token = /^Bearer ([^ ]+)$/.exec(h.authorization || '')?.[1] || '';
      const actor = Object.hasOwn(tokens, token) ? tokens[token] : null;
      if (!actor) abort(401, 'Use a supplied practice token');
      const url = new URL(path, 'http://localhost'), route = url.pathname;
      const json = () => { let value; try { value = JSON.parse(raw); } catch { abort(400, 'Invalid JSON'); } if (!value || Array.isArray(value) || typeof value !== 'object') abort(400, 'Expected an object'); return value; };
      if (method === 'GET' && route === '/api/resources') return ok(200, all('SELECT * FROM resources ORDER BY id'));
      if (method === 'GET' && route === '/api/allocations') {
        const rows = all('SELECT * FROM allocations ORDER BY id').filter(row => visible(actor, row));
        return ok(200, rows.map(record));
      }
      const item = /^\/api\/allocations\/([1-9]\d*)$/.exec(route);
      if (item && (method === 'GET' || method === 'DELETE')) {
        const row = one('SELECT * FROM allocations WHERE id=?', Number(item[1]));
        if (!row || !visible(actor, row)) abort(404, 'Allocation not found');
        if (method === 'GET') return ok(200, record(row));
        if (!h['if-match']) abort(428, 'If-Match revision required');
        if (h['if-match'] !== String(row.revision)) abort(412, 'Revision is stale');
        return transaction(() => {
          if (row.status !== 'cancelled') { execute("UPDATE allocations SET status='cancelled',revision=revision+1 WHERE id=?", row.id); audit('cancelled', actor, row.id); }
          return ok(204);
        });
      }
      if (method === 'POST' && route === '/api/allocations') {
        const body = json(), key = h['idempotency-key'];
        if (!key || key.length > 80) abort(400, 'Idempotency-Key of 1–80 characters required');
        const start = timestamp(body.start_at), end = timestamp(body.end_at);
        if (!Number.isSafeInteger(body.resource_id) || !Number.isInteger(body.units) || body.units < 1 || body.units > 1000 || end <= start || end - start > 8 * 3600000 || typeof body.external_ref !== 'string' || !body.external_ref.trim() || body.external_ref.trim().length > 80) abort(400, 'Invalid allocation fields');
        const fingerprint = JSON.stringify([body.resource_id, start, end, body.units, body.external_ref.trim()]);
        return transaction(() => {
          const replay = one('SELECT * FROM idempotency WHERE team_id=? AND key=?', actor.team, key);
          if (replay) { if (replay.fingerprint !== fingerprint) abort(409, 'Idempotency key reused with different input'); return ok(201, JSON.parse(replay.response)); }
          const resource = one('SELECT * FROM resources WHERE id=?', body.resource_id);
          if (!resource) abort(404, 'Resource not found');
          if (!resource.enabled) abort(409, 'Resource disabled');
          if (one('SELECT id FROM allocations WHERE team_id=? AND external_ref=?', actor.team, body.external_ref.trim())) abort(409, 'External reference already exists');
          if (!hasCapacity(resource, start, end, body.units)) abort(409, 'Capacity unavailable');
          const result = execute("INSERT INTO allocations(resource_id,team_id,start_ms,end_ms,units,external_ref,status,revision) VALUES (?,?,?,?,?,?,'active',1)", resource.id, actor.team, start, end, body.units, body.external_ref.trim());
          const response = record(one('SELECT * FROM allocations WHERE id=?', Number(result.lastInsertRowid)));
          execute('INSERT INTO idempotency(team_id,key,fingerprint,response) VALUES (?,?,?,?)', actor.team, key, fingerprint, JSON.stringify(response));
          audit('created', actor, response.id);
          return ok(201, response);
        });
      }
      if (method === 'POST' && route === '/api/imports') {
        if (!actor.admin) abort(403, 'Admin token required');
        const rows = parseImport(raw), dry = url.searchParams.get('dry_run') === '1';
        if (dry) { for (const row of rows) if (one('SELECT id FROM resources WHERE id=?', row.id)) abort(409, 'Resource id exists'); return ok(200, { created: rows.length, dry_run: true }); }
        return transaction(() => {
          for (const row of rows) {
            if (one('SELECT id FROM resources WHERE id=?', row.id)) abort(409, 'Resource id exists');
            execute('INSERT INTO resources(id,label,capacity,enabled) VALUES (?,?,?,?)', row.id, row.label, row.capacity, row.enabled);
          }
          audit('imported', actor, rows.length);
          return ok(201, { created: rows.length, dry_run: false });
        });
      }
      if (method === 'GET' && route === '/api/audit') {
        if (!actor.admin) abort(403, 'Admin token required');
        return ok(200, all('SELECT * FROM audit ORDER BY id'));
      }
      if (method === 'GET' && route === '/api/report') {
        if (!actor.admin) abort(403, 'Admin token required');
        return ok(200, all("SELECT r.id AS resource_id,COUNT(a.id) AS active_count,COALESCE(SUM(a.units),0) AS total_units,COALESCE(SUM(a.units*(a.end_ms-a.start_ms)/60000),0) AS unit_minutes FROM resources r LEFT JOIN allocations a ON a.resource_id=r.id AND a.status='active' GROUP BY r.id ORDER BY r.id"));
      }
      abort(404, 'Route not found');
    } catch (error) { return ok(error.status || 500, { error: error.status ? error.message : 'Database operation failed' }); }
  }
  return { handle };
}
`;

export const faultPatches = [
  { id: 'boundary-order', before: 'a[1] - b[1]', after: 'b[1] - a[1]', description: 'Adjacent intervals consume capacity at the same instant.' },
  { id: 'tenant-leak', before: 'actor.admin || row.team_id === actor.team', after: 'true', description: 'Another team’s allocation becomes visible.' },
  { id: 'stale-write', before: "if (h['if-match'] !== String(row.revision))", after: 'if (false)', description: 'Stale cancellation is accepted.' },
  { id: 'retry-conflict', before: 'if (replay.fingerprint !== fingerprint)', after: 'if (false)', description: 'A reused idempotency key accepts a different body.' },
  { id: 'retry-disabled', before: 'if (replay) {', after: 'if (false && replay) {', description: 'A retry executes the create path again.' },
  { id: 'cancelled-report', before: "a.resource_id=r.id AND a.status='active'", after: 'a.resource_id=r.id', description: 'Cancelled rows contaminate the report.' },
  { id: 'partial-import', before: "function transaction(work) {\n    db.exec('BEGIN IMMEDIATE');", after: "function transaction(work) { return work();\n    db.exec('BEGIN IMMEDIATE');", description: 'A failed import leaves earlier rows committed.' },
  { id: 'checksum-ignored', before: "if (digest !== match[3])", after: 'if (false)', description: 'A damaged legacy file is imported.' },
];

export function mutateService(ids: string[]) {
  return ids.reduce((source, id) => {
    const patch = faultPatches.find(p => p.id === id)!;
    if (!source.includes(patch.before)) throw new Error('Mutation anchor missing: ' + id);
    return source.replace(patch.before, patch.after);
  }, serviceSource);
}

export const serverSource = String.raw`import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const { createEngine } = await import(new URL(process.env.CANDIDATE_MODULE || './engine.mjs', import.meta.url));
const db = new DatabaseSync(process.env.DATABASE_PATH || ':memory:');
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
if (!db.prepare("SELECT name FROM sqlite_master WHERE name='resources'").get()) db.exec(readFileSync(new URL('./seed.sql', import.meta.url), 'utf8'));
const engine = createEngine(db);
const server = createServer(async (req,res) => {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1000000) { res.writeHead(413); res.end(); return; } }
  const result = await engine.handle({ method:req.method, path:req.url, headers:req.headers, raw });
  res.writeHead(result.status, { 'Content-Type':'application/json' });
  res.end(result.status === 204 ? undefined : JSON.stringify(result.body));
});
server.listen(Number(process.env.PORT || 4100), '127.0.0.1', () => console.log('Deadline Forge practice service http://127.0.0.1:' + server.address().port));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
`;
