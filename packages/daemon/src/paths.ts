import { fileURLToPath } from 'node:url';

export const DAEMON_BIN_PATH = fileURLToPath(new URL('./bin.js', import.meta.url));
