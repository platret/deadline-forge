import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Challenge, Session } from '../shared/types';

type Row = {
  id: string; challenge: string; strict: number; status: Session['status']; elapsed_ms: number;
  run_started_at: number | null; started_at: number; completed_at: number | null; checked: string; notes: string;
};
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, challenge TEXT NOT NULL, strict INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','paused','completed','timed_out')),
        elapsed_ms INTEGER NOT NULL DEFAULT 0, run_started_at INTEGER, started_at INTEGER NOT NULL,
        completed_at INTEGER, checked TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT ''
      );`);
  }
  close() { this.db.close(); }
  private row(id: string): Row {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as Row;
    if (!row) throw Object.assign(new Error('Session not found'), { status: 404 });
    return row;
  }
  get(id: string, now = Date.now()): Session {
    let row = this.row(id);
    const challenge = JSON.parse(row.challenge) as Challenge;
    const duration = challenge.minutes * 60000;
    let elapsed = row.elapsed_ms + (row.status === 'running' && row.run_started_at !== null ? Math.max(0, now - row.run_started_at) : 0);
    if (row.status === 'running' && elapsed >= duration) {
      const deadline = (row.run_started_at ?? now) + Math.max(0, duration - row.elapsed_ms);
      this.db.prepare("UPDATE sessions SET status='timed_out', elapsed_ms=?, run_started_at=NULL, completed_at=? WHERE id=?").run(duration, deadline, id);
      row = this.row(id); elapsed = duration;
    }
    return {
      id, challenge, strict: Boolean(row.strict), status: row.status,
      elapsedSeconds: Math.floor(elapsed / 1000), remainingSeconds: Math.max(0, Math.ceil((duration - elapsed) / 1000)),
      startedAt: row.started_at, completedAt: row.completed_at, checked: JSON.parse(row.checked), notes: row.notes, serverNow: now,
    };
  }
  list(now = Date.now()) {
    return (this.db.prepare('SELECT id FROM sessions ORDER BY started_at DESC, rowid DESC LIMIT 200').all() as { id: string }[]).map(r => this.get(r.id, now));
  }
  start(challenge: Challenge, strict: boolean, now = Date.now()) {
    const active = this.list(now).find(s => s.status === 'running' || s.status === 'paused');
    if (active) throw Object.assign(new Error('Finish your active session before starting another.'), { status: 409 });
    const id = randomUUID();
    this.db.prepare('INSERT INTO sessions (id,challenge,strict,status,run_started_at,started_at) VALUES (?,?,?,\'running\',?,?)').run(id, JSON.stringify(challenge), strict ? 1 : 0, now, now);
    return this.get(id, now);
  }
  update(id: string, input: { action: string; checked?: unknown; notes?: unknown }, now = Date.now()) {
    const session = this.get(id, now);
    const row = this.row(id);
    const elapsed = row.elapsed_ms + (row.status === 'running' && row.run_started_at !== null ? Math.max(0, now - row.run_started_at) : 0);
    if (input.action === 'progress') {
      if (input.notes !== undefined && (typeof input.notes !== 'string' || input.notes.length > 12000)) throw Object.assign(new Error('Notes must be at most 12,000 characters'), { status: 400 });
      if (input.checked !== undefined) {
        if (!Array.isArray(input.checked) || !input.checked.every(c => typeof c === 'string' && session.challenge.criteria.some(x => x.id === c))) throw Object.assign(new Error('Invalid checklist'), { status: 400 });
        this.db.prepare('UPDATE sessions SET checked=? WHERE id=?').run(JSON.stringify([...new Set(input.checked)]), id);
      }
      if (input.notes !== undefined) {
        this.db.prepare('UPDATE sessions SET notes=? WHERE id=?').run(input.notes as string, id);
      }
    } else if (input.action === 'pause') {
      if (session.strict) throw Object.assign(new Error('Exam sessions cannot be paused.'), { status: 409 });
      if (session.status !== 'running') throw Object.assign(new Error('Only a running session can be paused.'), { status: 409 });
      this.db.prepare("UPDATE sessions SET status='paused',elapsed_ms=?,run_started_at=NULL WHERE id=?").run(elapsed, id);
    } else if (input.action === 'resume') {
      if (session.status !== 'paused') throw Object.assign(new Error('Only a paused session can be resumed.'), { status: 409 });
      this.db.prepare("UPDATE sessions SET status='running',run_started_at=? WHERE id=?").run(now, id);
    } else if (input.action === 'finish') {
      if (session.status === 'completed' || session.status === 'timed_out') return session;
      this.db.prepare("UPDATE sessions SET status='completed',elapsed_ms=?,run_started_at=NULL,completed_at=? WHERE id=?").run(elapsed, now, id);
    } else throw Object.assign(new Error('Unknown session action'), { status: 400 });
    return this.get(id, now);
  }
}
