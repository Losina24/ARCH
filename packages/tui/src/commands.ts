export interface SlashCommand {
  name: string;
  description: string;
}

/** @deprecated Use {@link SlashCommand} — kept as an alias so existing imports don't churn. */
export type HomeCommand = SlashCommand;

export const HOME_COMMANDS: SlashCommand[] = [
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
 * Splits `"/name args"` into its command name and the rest, tolerating any
 * amount of whitespace right after the slash (`"/ quit"` behaves exactly like
 * `"/quit"`) as well as mixed case. Returns undefined for anything that isn't
 * a command at all.
 */
function splitCommand(raw: string): { name: string; args: string } | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return undefined;

  const rest = trimmed.slice(1).trimStart();
  const [name = '', ...args] = rest.split(/\s+/);
  return { name: name.toLowerCase(), args: args.join(' ') };
}

/**
 * Plain text is always a new run. Anything starting with `/` is a command —
 * the sole way to reach every other action from the home screen.
 */
export function parseHomeInput(raw: string): HomeInput {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'empty' };

  const command = splitCommand(trimmed);
  if (command) {
    const known = HOME_COMMANDS.some((candidate) => candidate.name === command.name);
    return { kind: 'command', name: command.name, args: command.args, known };
  }

  return { kind: 'run', prompt: trimmed };
}

/**
 * Commands from `list` whose name starts with what's typed so far, for a live
 * suggestions dropdown. Empty once the input has moved past the command name
 * (a space followed by anything) or doesn't start with `/` at all. Tolerates
 * whitespace right after the slash the same way {@link splitCommand} does, so
 * `"/ qu"` still suggests `/quit`.
 */
export function matchCommands(raw: string, list: SlashCommand[]): SlashCommand[] {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('/')) return [];

  const rest = trimmed.slice(1).trimStart();
  if (/\s/.test(rest)) return [];

  const query = rest.toLowerCase();
  return list.filter((command) => command.name.startsWith(query));
}

export function matchHomeCommands(raw: string): SlashCommand[] {
  return matchCommands(raw, HOME_COMMANDS);
}

/**
 * Whether `raw` is exactly the slash command `name` (optionally followed by
 * trailing args), tolerating a stray space after the slash and any case —
 * e.g. `isCommand('/ Approve now', 'approve')` is `true`. The single rule
 * every ad-hoc `=== '/approve'`-style check in the TUI should use instead of
 * comparing raw strings directly.
 */
export function isCommand(raw: string, name: string): boolean {
  return splitCommand(raw)?.name === name.replace(/^\//, '').toLowerCase();
}
