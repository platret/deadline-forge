import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const project = fileURLToPath(new URL('../', import.meta.url));
const dbPath = process.env.DATABASE_PATH || resolve(project, 'data/practice.sqlite');
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const port = Number(process.env.PORT || 3001);
const { server, store } = createApp(dbPath, resolve(project, 'dist'));
server.listen(port, '127.0.0.1', () => console.log(`Deadline Forge API + built app: http://127.0.0.1:${port}`));
server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
