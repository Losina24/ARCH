import { describe, expect, it } from 'vitest';
import { resolveCodexModelId } from './model-registry.js';

describe('resolveCodexModelId', () => {
  it('resolves a short alias to its canonical model id', () => {
    expect(resolveCodexModelId('codex')).toBe('gpt-5.6-sol');
    expect(resolveCodexModelId('gpt5')).toBe('gpt-5.6-sol');
    expect(resolveCodexModelId('codex-mini')).toBe('gpt-5.6-luna');
  });

  it('passes an unknown model id straight through', () => {
    expect(resolveCodexModelId('gpt-6-preview')).toBe('gpt-6-preview');
  });
});
