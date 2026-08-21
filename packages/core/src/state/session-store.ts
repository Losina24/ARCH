import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type RunSessions, RunSessionsSchema } from '@arch/schemas';

const SESSIONS_FILENAME = 'sessions.json';

export async function loadRunSessions(runDir: string): Promise<RunSessions> {
  const path = join(runDir, SESSIONS_FILENAME);
  try {
    const raw = await readFile(path, 'utf-8');
    return RunSessionsSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return RunSessionsSchema.parse({});
    }
    throw error;
  }
}

export async function saveRunSessions(runDir: string, sessions: RunSessions): Promise<void> {
  const path = join(runDir, SESSIONS_FILENAME);
  const validated = RunSessionsSchema.parse(sessions);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
}
