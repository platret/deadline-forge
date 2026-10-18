export const modes = ['fullstack', 'frontend', 'backend', 'database', 'debugging', 'testing'] as const;
export const difficulties = ['foundation', 'competition', 'stretch', 'nationals'] as const;
export type Mode = typeof modes[number];
export type Difficulty = typeof difficulties[number];
export type GenerateOptions = {
  mode: Mode;
  difficulty: Difficulty;
  minutes: number;
  seed: string;
  scenario?: string;
};
export type Criterion = { id: string; title: string; detail: string; points: number; category: string };
export type Endpoint = { method: string; path: string; description: string; request?: unknown; response: unknown; status: number };
export type SmokeCase = { name: string; method: string; path: string; body?: unknown; status: number; equals?: Record<string, unknown>; contains?: Record<string, unknown>; length?: number };
export type FileAsset = { name: string; content: string };
export type Challenge = GenerateOptions & {
  id: string;
  version: number;
  title: string;
  scenario: string;
  client: string;
  city: string;
  summary: string;
  brief: string[];
  focus: string[];
  criteria: Criterion[];
  endpoints: Endpoint[];
  fixtures: Record<string, unknown[]>;
  sql: string;
  tests: SmokeCase[];
  files: FileAsset[];
  twist: string;
  deliverables: string[];
  modules?: { name: string; minutes: number; description: string }[];
};
export type Session = {
  id: string;
  challenge: Challenge;
  strict: boolean;
  status: 'running' | 'paused' | 'completed' | 'timed_out';
  elapsedSeconds: number;
  remainingSeconds: number;
  startedAt: number;
  completedAt: number | null;
  checked: string[];
  notes: string;
  serverNow: number;
};
export const modeLabels: Record<Mode, string> = {
  fullstack: 'Full stack', frontend: 'Frontend', backend: 'Backend / API',
  database: 'SQLite', debugging: 'Debugging', testing: 'Testing',
};
export const difficultyLabels: Record<Difficulty, string> = {
  foundation: 'Foundation', competition: 'Competition', stretch: 'Stretch', nationals: 'Nationals',
};
