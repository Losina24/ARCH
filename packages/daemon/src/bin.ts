import { startDaemon } from './main.js';

const cwd = process.argv[2] ?? process.cwd();
await startDaemon(cwd);
