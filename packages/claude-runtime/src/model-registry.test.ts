import { describe, expect, it } from 'vitest';
import { resolveModelId } from './model-registry.js';

describe('resolveModelId', () => {
  it('resolves a short alias to its full model id', () => {
    expect(resolveModelId('sonnet')).toBe('claude-sonnet-5');
    expect(resolveModelId('opus')).toBe('claude-opus-5');
    expect(resolveModelId('fable')).toBe('claude-fable-5');
    expect(resolveModelId('haiku')).toBe('claude-haiku-4-5-20251001');
  });

  it('is idempotent for a full model id', () => {
    expect(resolveModelId('claude-sonnet-5')).toBe('claude-sonnet-5');
  });

  it('passes through an unknown model id unchanged, for forward compatibility', () => {
    expect(resolveModelId('claude-future-model')).toBe('claude-future-model');
  });
});
