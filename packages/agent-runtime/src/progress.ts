import { basename, isAbsolute, relative } from 'node:path';
import type { ClaudeContentBlock, ClaudeJsonlEvent } from '@losina/claude-runtime';
import type { CodexJsonlEvent, CodexJsonlItem } from '@losina/codex-runtime';
import type { OpencodeJsonlEvent } from '@losina/opencode-runtime';

/** Provider-neutral, display-safe progress emitted while a headless agent turn is running. */
export interface AgentProgressEvent {
  state: 'thinking' | 'using-tool';
  /** Human-readable activity summary. Must never contain raw prompts, tool output, or secrets. */
  detail?: string;
  /** Stable tool category/name for clients that want to render it separately. */
  tool?: string;
  /** Repo-relative path when one can be identified safely; otherwise only the basename. */
  file?: string;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : undefined;
}

function firstString(record: UnknownRecord | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function safeFile(value: unknown, cwd: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const clean = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim();
  if (!clean) return undefined;

  if (isAbsolute(clean)) {
    const fromCwd = relative(cwd, clean);
    if (fromCwd && !fromCwd.startsWith('..') && !isAbsolute(fromCwd)) {
      // `relative()` returns OS-native separators (backslashes on Windows) — normalize so this
      // repo-relative path always looks the same regardless of the host platform.
      return fromCwd.replaceAll('\\', '/').slice(0, 120);
    }
    return basename(clean).slice(0, 120) || undefined;
  }

  const normalized = clean.replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('../')) return basename(normalized).slice(0, 120) || undefined;
  return normalized.slice(0, 120);
}

function fileFromInput(input: unknown, cwd: string): string | undefined {
  const record = asRecord(input);
  return safeFile(
    firstString(record, ['file_path', 'filePath', 'path', 'notebook_path', 'notebookPath']),
    cwd,
  );
}

function commandFromInput(input: unknown): string | undefined {
  const record = asRecord(input);
  return firstString(record, ['command', 'cmd']);
}

function commandDetail(command: unknown): string {
  if (typeof command !== 'string') return 'Running command';
  const normalized = command.toLowerCase();

  if (/\b(?:rg|grep|find|fd|ls|tree|sed|cat|head|tail)\b/.test(normalized)) {
    return 'Searching files';
  }
  if (
    /\b(?:vitest|jest|pytest|rspec|phpunit)\b|\b(?:cargo|go|dotnet)\s+test\b|\btest\b/.test(
      normalized,
    )
  ) {
    return 'Running tests';
  }
  if (/\b(?:typecheck|tsc|mypy|pyright)\b/.test(normalized)) return 'Checking types';
  if (/\b(?:lint|eslint|biome|ruff|shellcheck)\b/.test(normalized)) return 'Linting code';
  if (/\b(?:build|compile)\b/.test(normalized)) return 'Building project';
  if (
    /\b(?:install|add)\b/.test(normalized) &&
    /\b(?:npm|pnpm|yarn|bun|pip|uv|cargo)\b/.test(normalized)
  ) {
    return 'Installing dependencies';
  }
  if (/\bgit\s+(?:status|diff|log|show|branch|rev-parse)\b/.test(normalized)) {
    return 'Inspecting repository';
  }
  if (/\bgit\b/.test(normalized)) return 'Using Git';
  return 'Running command';
}

function safeToolName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 48);
  return clean || undefined;
}

function toolProgress(name: unknown, input: unknown, cwd: string): AgentProgressEvent {
  const safeName = safeToolName(name);
  const normalized = safeName?.toLowerCase() ?? '';
  const file = fileFromInput(input, cwd);

  if (/^(?:bash|shell|exec|command|terminal)$/.test(normalized)) {
    return {
      state: 'using-tool',
      tool: safeName ?? 'Shell',
      detail: commandDetail(commandFromInput(input)),
    };
  }
  if (/^(?:read|readfile|open)$/.test(normalized)) {
    return { state: 'using-tool', tool: safeName ?? 'Read', detail: 'Reading file', file };
  }
  if (/^(?:write|edit|multiedit|apply_patch|notebookedit|patch)$/.test(normalized)) {
    return { state: 'using-tool', tool: safeName ?? 'Edit', detail: 'Editing file', file };
  }
  if (/^(?:glob|grep|search|list|listfiles|codesearch)$/.test(normalized)) {
    return { state: 'using-tool', tool: safeName ?? 'Search', detail: 'Searching files', file };
  }
  if (/^(?:websearch|webfetch|web_search|fetch)$/.test(normalized)) {
    return { state: 'using-tool', tool: safeName ?? 'Web', detail: 'Searching web' };
  }
  if (/^(?:todowrite|todoread|todo|update_plan|plan)$/.test(normalized)) {
    return { state: 'using-tool', tool: safeName ?? 'Plan', detail: 'Updating plan' };
  }
  if (/^(?:task|agent|subagent)$/.test(normalized)) {
    return { state: 'using-tool', tool: safeName ?? 'Agent', detail: 'Running subagent' };
  }
  if (normalized.startsWith('mcp__') || normalized.startsWith('mcp.')) {
    return { state: 'using-tool', tool: 'MCP', detail: 'Using MCP tool' };
  }
  return {
    state: 'using-tool',
    tool: safeName ?? 'Tool',
    detail: safeName ? `Using ${safeName}` : 'Using tool',
    file,
  };
}

function codexItemProgress(item: CodexJsonlItem, cwd: string): AgentProgressEvent | undefined {
  switch (item.type) {
    case 'command_execution':
      return {
        state: 'using-tool',
        tool: 'Shell',
        detail: commandDetail(item.command),
      };
    case 'file_change': {
      const file = safeFile(item.changes?.find((change) => change.path)?.path ?? item.path, cwd);
      return { state: 'using-tool', tool: 'Edit', detail: 'Editing files', file };
    }
    case 'mcp_tool_call':
      return toolProgress(item.tool ?? item.name ?? 'MCP', item.arguments, cwd);
    case 'web_search':
      return { state: 'using-tool', tool: 'WebSearch', detail: 'Searching web' };
    case 'todo_list':
    case 'plan':
      return { state: 'using-tool', tool: 'Plan', detail: 'Updating plan' };
    case 'reasoning':
      return { state: 'thinking', detail: 'Analyzing' };
    case 'agent_message':
      return { state: 'thinking', detail: 'Preparing response' };
    default:
      return undefined;
  }
}

export function progressFromCodexEvent(
  event: CodexJsonlEvent,
  cwd: string,
): AgentProgressEvent | undefined {
  if (event.type === 'turn.started') return { state: 'thinking', detail: 'Analyzing' };
  if (event.type === 'item.started' && event.item) return codexItemProgress(event.item, cwd);
  if (event.type === 'item.completed' && event.item?.type !== 'agent_message') {
    return { state: 'thinking', detail: 'Analyzing results' };
  }
  return undefined;
}

function claudeBlocks(event: ClaudeJsonlEvent): ClaudeContentBlock[] {
  if (!event.message || !Array.isArray(event.message.content)) return [];
  return event.message.content;
}

export function progressFromClaudeEvent(
  event: ClaudeJsonlEvent,
  cwd: string,
): AgentProgressEvent | undefined {
  if (event.type === 'system' && event.subtype === 'api_retry') {
    const attempt = typeof event.attempt === 'number' ? event.attempt : undefined;
    const maximum = typeof event.max_retries === 'number' ? event.max_retries : undefined;
    const suffix =
      attempt === undefined ? '' : ` (${attempt}${maximum === undefined ? '' : `/${maximum}`})`;
    return { state: 'using-tool', tool: 'API', detail: `Retrying connection${suffix}` };
  }
  if (event.type === 'system' && event.subtype === 'init') {
    return { state: 'thinking', detail: 'Starting session' };
  }
  if (event.type === 'assistant') {
    const blocks = claudeBlocks(event);
    const toolUse = blocks.find((block) => block.type === 'tool_use');
    if (toolUse) return toolProgress(toolUse.name, toolUse.input, cwd);
    if (blocks.some((block) => block.type === 'text')) {
      return { state: 'thinking', detail: 'Preparing response' };
    }
  }
  if (event.type === 'user' && claudeBlocks(event).some((block) => block.type === 'tool_result')) {
    return { state: 'thinking', detail: 'Analyzing results' };
  }
  if (
    event.type === 'stream_event' &&
    event.event?.type === 'content_block_start' &&
    event.event.content_block?.type === 'tool_use'
  ) {
    const block = event.event.content_block;
    return toolProgress(block.name, block.input, cwd);
  }
  return undefined;
}

function completedToolDetail(progress: AgentProgressEvent): string {
  switch (progress.detail) {
    case 'Running tests':
      return 'Tests completed';
    case 'Checking types':
      return 'Type check completed';
    case 'Linting code':
      return 'Lint completed';
    case 'Building project':
      return 'Build completed';
    case 'Installing dependencies':
      return 'Dependencies installed';
    case 'Reading file':
      return 'File read';
    case 'Editing file':
      return 'File updated';
    case 'Searching files':
      return 'File search completed';
    case 'Searching web':
      return 'Web search completed';
    case 'Updating plan':
      return 'Plan updated';
    case 'Running subagent':
      return 'Subagent completed';
    default:
      return 'Tool completed';
  }
}

export function progressFromOpencodeEvent(
  event: OpencodeJsonlEvent,
  cwd: string,
): AgentProgressEvent | undefined {
  if (event.type === 'step_start') return { state: 'thinking', detail: 'Analyzing next step' };
  if (event.type === 'text') return { state: 'thinking', detail: 'Preparing response' };
  if (event.type !== 'tool_use' || !event.part) return undefined;

  const progress = toolProgress(event.part.tool, event.part.state?.input, cwd);
  if (event.part.state?.status === 'error') {
    return { state: 'thinking', detail: 'Reviewing tool error', file: progress.file };
  }
  // `opencode run --format json` currently emits tool_use after a tool completes. Preserve that
  // provider limitation honestly instead of claiming that a finished command is still running.
  return {
    state: 'thinking',
    detail: completedToolDetail(progress),
    file: progress.file,
  };
}
