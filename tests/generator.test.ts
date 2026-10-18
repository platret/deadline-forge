import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { generateChallenge, scenarioOptions } from '../server/generator';
import { modes, difficulties } from '../shared/types';
import { validateOptions } from '../server/app';

const options = { mode: 'fullstack', difficulty: 'competition', minutes: 180, seed: 'bern-2027' } as const;
describe('versioned challenge generation', () => {
  it('is deterministic and replays an automatically selected scenario with the same identity', () => {
    const a = generateChallenge(options);
    expect(generateChallenge(options)).toEqual(a);
    expect(generateChallenge({ ...options, scenario: a.scenario })).toEqual(a);
    expect(generateChallenge({ ...options, seed: 'other-seed' }).id).not.toBe(a.id);
  });
  it('varies fixture parameters, clients, scenario and extensions across seeds', () => {
    const samples = Array.from({ length: 50 }, (_, i) => generateChallenge({ ...options, seed: `seed-${i}` }));
    expect(new Set(samples.map(c => c.scenario)).size).toBe(4);
    expect(new Set(samples.map(c => c.city)).size).toBe(8);
    expect(new Set(samples.map(c => c.twist)).size).toBe(4);
    expect(new Set(samples.map(c => JSON.stringify(c.fixtures))).size).toBeGreaterThan(10);
  });
  for (const scenario of scenarioOptions) for (const mode of modes) for (const difficulty of difficulties) {
    it(`${scenario.id} / ${mode} / ${difficulty} has coherent SQL, scoring and helper files`, () => {
      const c = generateChallenge({ ...options, mode, difficulty, scenario: scenario.id });
      expect(c.criteria.reduce((sum, criterion) => sum + criterion.points, 0)).toBe(100);
      expect(new Set(c.criteria.map(x => x.id)).size).toBe(c.criteria.length);
      expect(new Set(c.files.map(x => x.name)).size).toBe(c.files.length);
      expect(c.files.find(f => f.name === 'BRIEF.md')?.content).toContain('UNOFFICIAL');
      const db = new DatabaseSync(':memory:');
      try {
        db.exec(c.sql);
        for (const [table, rows] of Object.entries(c.fixtures)) expect(db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(r => ({ ...r }))).toEqual(rows);
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally { db.close(); }
      if (mode === 'frontend') expect(c.files.some(f => f.name === (difficulty === 'nationals' ? 'server.mjs' : 'mock-server.mjs'))).toBe(true);
      if (mode === 'database') expect(c.files.some(f => f.name === 'database.test.mjs')).toBe(true);
      if (mode === 'testing') expect(c.files.some(f => f.name === 'mutation-check.mjs')).toBe(true);
      if (mode === 'debugging') expect(c.files.some(f => f.name === (difficulty === 'nationals' ? 'nationals.test.mjs' : 'regression.test.mjs'))).toBe(true);
      if (difficulty === 'nationals') expect(c.modules!.reduce((sum, m) => sum + m.minutes, 0)).toBe(c.minutes);
    });
  }
});

describe('request validation', () => {
  it('normalises blank seeds, trims explicit seeds and accepts a seven-hour session', () => {
    expect(validateOptions({ ...options, seed: '  replay  ', minutes: 420 }).seed).toBe('replay');
    expect(validateOptions({ ...options, seed: '' }).seed).not.toBe('');
  });
  it.each([{ mode: 'wrong' }, { difficulty: 'wrong' }, { minutes: -1 }, { minutes: 500 }, { minutes: 30.5 }, { seed: 'a'.repeat(81) }, { scenario: 'wrong' }])('rejects invalid options %j', override => {
    expect(() => validateOptions({ ...options, ...override })).toThrow();
  });
});
