export interface HomeCommand {
  name: string;
  description: string;
}

export const HOME_COMMANDS: HomeCommand[] = [
  { name: 'runs', description: 'Browse existing runs' },
  { name: 'settings', description: 'Edit agent mesh settings' },
  { name: 'help', description: 'List available commands' },
  { name: 'quit', description: 'Exit ARCH' },
  { name: 'close-all', description: 'Force-quit ARCH, stopping the daemon even mid-run' },
];

export type HomeInput =
  | { kind: 'empty' }
  | { kind: 'run'; prompt: string }
  | { kind: 'command'; name: string; args: string; known: boolean };

/**
 * Plain text is always a new run. Anything starting with `/` is a command —
 * the sole way to reach every other action from the home screen.
 */
export function parseHomeInput(raw: string): HomeInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  if (trimmed.startsWith('/')) {
    const [name, ...rest] = trimmed.slice(1).split(/\s+/);
    const known = HOME_COMMANDS.some((command) => command.name === name);
    return { kind: 'command', name, args: rest.join(' '), known };
  }

  return { kind: 'run', prompt: trimmed };
}

/**
 * Commands whose name starts with what's typed so far, for a live suggestions
 * dropdown. Empty once the input has moved past the command name (a space) or
 * doesn't start with `/` at all.
 */
export function matchHomeCommands(raw: string): HomeCommand[] {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) return [];

  const query = trimmed.slice(1).toLowerCase();
  return HOME_COMMANDS.filter((command) => command.name.startsWith(query));
}
