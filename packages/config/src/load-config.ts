import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type AgentMeshConfig, AgentMeshConfigSchema } from '@arch/schemas';
import { getArchPaths } from './arch-paths.js';
import { DEFAULT_CONFIG } from './default-config.js';

export async function loadConfig(cwd: string): Promise<AgentMeshConfig> {
  const { configPath } = getArchPaths(cwd);
  try {
    const raw = await readFile(configPath, 'utf-8');
    return AgentMeshConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    throw error;
  }
}

export async function saveConfig(cwd: string, config: AgentMeshConfig): Promise<void> {
  const { configPath } = getArchPaths(cwd);
  const validated = AgentMeshConfigSchema.parse(config);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf-8');
}
