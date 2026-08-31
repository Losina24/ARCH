import { KNOWN_CODEX_MODELS } from '@losina/codex-runtime';

export type AgentProvider = 'claude' | 'codex' | 'opencode';

// Fallback for a model id that isn't one of the known aliases (KNOWN_CODEX_MODELS only
// covers a handful of short names) — a GPT/o-series/Codex-branded id always belongs to Codex
// regardless of whether it's been added to that alias table yet.
const CODEX_MODEL_PREFIXES = ['gpt-', 'o1', 'o3', 'o4', 'codex'];

/**
 * Decides which CLI runs a given model. Defaults to 'claude' when the model doesn't look like
 * a Codex or OpenCode model at all — this keeps every existing config (bare "sonnet",
 * "claude-opus-5", or any string nobody has taught this function about) routed exactly where it
 * always went.
 */
export function detectProvider(model: string): AgentProvider {
  // OpenCode is the only one of the three whose CLI requires a "provider/model" id (see
  // `opencode models`) — that slash is a strong, unambiguous signal, so check it before the
  // Codex heuristics below (which only match a bare prefix and would never false-positive on
  // an OpenCode id like "github-copilot/gpt-4.1" anyway, but checking first keeps the intent
  // explicit).
  if (model.includes('/')) return 'opencode';
  if (model in KNOWN_CODEX_MODELS) return 'codex';
  const lower = model.toLowerCase();
  if (CODEX_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix))) return 'codex';
  return 'claude';
}
