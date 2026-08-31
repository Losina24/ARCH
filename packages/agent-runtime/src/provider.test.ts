import { describe, expect, it } from 'vitest';
import { detectProvider } from './provider.js';

describe('detectProvider', () => {
  it.each([
    ['sonnet', 'claude'],
    ['opus', 'claude'],
    ['claude-opus-5', 'claude'],
    ['claude-sonnet-5', 'claude'],
  ] as const)('routes %s to %s', (model, provider) => {
    expect(detectProvider(model)).toBe(provider);
  });

  it.each([
    ['codex', 'codex'],
    ['gpt5', 'codex'],
    ['gpt-5.1', 'codex'],
    ['gpt-5.1-codex', 'codex'],
    ['o3', 'codex'],
    ['o4-mini', 'codex'],
  ] as const)('routes %s to %s', (model, provider) => {
    expect(detectProvider(model)).toBe(provider);
  });

  it.each([
    ['github-copilot/gpt-4.1', 'opencode'],
    ['anthropic/claude-sonnet-5', 'opencode'],
    ['openai/gpt-5.1', 'opencode'],
  ] as const)('routes %s to %s', (model, provider) => {
    expect(detectProvider(model)).toBe(provider);
  });

  it('defaults an unrecognized model id to claude', () => {
    expect(detectProvider('some-future-model')).toBe('claude');
  });
});
