export const KNOWN_MODELS = {
  'claude-opus-5': 'claude-opus-5',
  'claude-sonnet-5': 'claude-sonnet-5',
  'claude-fable-5': 'claude-fable-5',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  opus: 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  fable: 'claude-fable-5',
  haiku: 'claude-haiku-4-5-20251001',
} as const;

export type KnownModelAlias = keyof typeof KNOWN_MODELS;

export function resolveModelId(alias: string): string {
  return KNOWN_MODELS[alias as KnownModelAlias] ?? alias;
}
