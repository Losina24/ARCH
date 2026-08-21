import type { AgentMeshConfig } from '@arch/schemas';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { ModelsHint } from './models-hint.js';

function config(): AgentMeshConfig {
  return {
    models: {
      architectModel: 'claude-opus-5',
      tlModel: 'claude-sonnet-5',
      workerModel: 'claude-sonnet-5',
    },
    execution: { maxConcurrency: 3, maxRetries: 2, useWorktrees: true },
  };
}

describe('ModelsHint', () => {
  it('shows the three role labels alongside their configured model', () => {
    const { lastFrame } = render(<ModelsHint config={config()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Architect');
    expect(frame).toContain('TL');
    expect(frame).toContain('Worker');
    expect(frame).toContain('claude-opus-5');
    expect(frame).toContain('claude-sonnet-5');
  });
});
