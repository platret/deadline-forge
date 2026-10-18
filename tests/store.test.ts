import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { generateChallenge } from '../server/generator';

const challenge = generateChallenge({ mode: 'fullstack', difficulty: 'competition', seed: 'store', minutes: 30 });
it('persists timers, checklist and reflection across database reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deadline-forge-store-'));
  let store = new Store(join(dir, 'test.sqlite'));
  try {
    const s = store.start(challenge, false, 1000);
    store.update(s.id, { action: 'progress', checked: ['flow'], notes: 'Need a restart test.' }, 2000);
    const paused = store.update(s.id, { action: 'pause' }, 12500);
    expect(paused.elapsedSeconds).toBe(11);
    expect(store.get(s.id, 100000).remainingSeconds).toBe(paused.remainingSeconds);
    store.close(); store = new Store(join(dir, 'test.sqlite'));
    expect(store.get(s.id, 100000).checked).toEqual(['flow']);
    expect(store.get(s.id, 100000).notes).toContain('restart');
    store.update(s.id, { action: 'resume' }, 100000);
    const finished = store.update(s.id, { action: 'finish' }, 110000);
    expect(finished.elapsedSeconds).toBe(21);
    expect(finished.status).toBe('completed');
    expect(store.get(s.id, 1000000).elapsedSeconds).toBe(21);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
it('disallows exam pausing and overlapping active sessions; expires on wall-clock deadline', () => {
  const store = new Store(':memory:');
  try {
    const s = store.start(challenge, true, 1000);
    expect(() => store.update(s.id, { action: 'pause' }, 2000)).toThrow('cannot be paused');
    expect(() => store.start(challenge, false, 2000)).toThrow('active session');
    const expired = store.get(s.id, 2000000);
    expect(expired.status).toBe('timed_out');
    expect(expired.remainingSeconds).toBe(0);
    expect(expired.completedAt).toBe(1801000);
    expect(store.start(challenge, false, 2000000).status).toBe('running');
    expect(() => store.update(s.id, { action: 'resume' }, 2000001)).toThrow();
  } finally { store.close(); }
});
it('rejects unknown checklist criteria and notes that are too long', () => {
  const store = new Store(':memory:');
  try {
    const s = store.start(challenge, false);
    expect(() => store.update(s.id, { action: 'progress', checked: ['made-up'] })).toThrow('Invalid checklist');
    expect(() => store.update(s.id, { action: 'progress', notes: 'a'.repeat(12001) })).toThrow();
    expect(() => store.get('missing')).toThrow('not found');
  } finally { store.close(); }
});
