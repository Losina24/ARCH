// Canonical model ids plus a few short aliases, mirroring @losina/claude-runtime's
// model-registry. Unlike that registry, an unknown alias is *expected* here too — new GPT
// model ids ship often, so resolveCodexModelId falls back to passing the input straight through.
export const KNOWN_CODEX_MODELS = {
  'gpt-5.6': 'gpt-5.6-sol',
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex-spark',
  o3: 'o3',
  gpt5: 'gpt-5.6-sol',
  codex: 'gpt-5.6-sol',
  'codex-mini': 'gpt-5.6-luna',
} as const;

export type KnownCodexModelAlias = keyof typeof KNOWN_CODEX_MODELS;

export function resolveCodexModelId(alias: string): string {
  return KNOWN_CODEX_MODELS[alias as KnownCodexModelAlias] ?? alias;
}
