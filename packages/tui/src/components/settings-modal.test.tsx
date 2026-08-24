import type { ArchClient } from '@losina/daemon-client';
import type { AgentMeshConfig } from '@losina/schemas';
import { Box } from 'ink';
import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './settings-modal.js';

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function press(stdin: Stdin, sequence: string): Promise<void> {
  stdin.write(sequence);
  await tick();
}

async function type(stdin: Stdin, text: string): Promise<void> {
  for (const char of text) {
    await press(stdin, char);
  }
}

const config: AgentMeshConfig = {
  models: {
    architectModel: 'claude-opus-5',
    tlModel: 'claude-sonnet-5',
    workerModel: 'claude-sonnet-5',
  },
  execution: {
    maxConcurrency: 4,
    maxRetries: 3,
    useWorktrees: true,
  },
};

function mockClient(overrides: Partial<ArchClient> = {}): ArchClient {
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    setConfig: vi.fn(),
    ...overrides,
  } as unknown as ArchClient;
}

function renderModal(client: ArchClient, onClose = vi.fn()) {
  return render(
    <Box position="relative" width={100} height={30}>
      <SettingsModal client={client} columns={100} rows={30} onClose={onClose} />
    </Box>,
  );
}

describe('SettingsModal', () => {
  it('loads and renders the current config fields as a centered overlay', async () => {
    const client = mockClient();
    const { lastFrame } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Settings');
    expect(frame).toContain('claude-sonnet-5');
    expect(frame).toContain('4');
    expect(frame).toContain('3');
    expect(frame).not.toContain('╭');
  });

  it('keeps every field row visible and unbordered while editing free text', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('╭');
    expect(frame).not.toContain('│');
    expect(frame).toContain('Architect model');
    expect(frame).toContain('TL model');
    expect(frame).toContain('Worker model');
    expect(frame).toContain('Max retries');
  });

  it('edits a model field by picking from a list of known models instead of free text', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\r');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    expect(lastFrame()).toContain('claude-fable-5');
  });

  it('cancels an in-progress model pick on escape without changing the value', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\r');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b');

    expect(lastFrame()).toContain('claude-opus-5');
  });

  it('edits a free-text field like max retries and shows the new value', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');
    await type(stdin, '9');
    await press(stdin, '\r');

    expect(lastFrame()).toContain('39');
  });

  it('cancels an in-progress free-text edit on escape without changing the value', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');
    await type(stdin, 'discarded-value');
    await press(stdin, '\x1b');

    expect(lastFrame()).toContain('3');
    expect(lastFrame()).not.toContain('discarded-value');
  });

  it('saves the config and renders the updated values', async () => {
    const updated: AgentMeshConfig = {
      models: { ...config.models, architectModel: 'claude-opus-5-updated' },
      execution: { maxConcurrency: 8, maxRetries: 5, useWorktrees: true },
    };
    const client = mockClient({ setConfig: vi.fn().mockResolvedValue(updated) });
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, 's');

    await vi.waitFor(() => expect(lastFrame()).toContain('Saved.'));
    expect(client.setConfig).toHaveBeenCalledWith({
      models: {
        architectModel: 'claude-opus-5',
        tlModel: 'claude-sonnet-5',
        workerModel: 'claude-sonnet-5',
      },
      maxConcurrency: 4,
      maxRetries: 3,
      useWorktrees: true,
    });
    expect(lastFrame()).toContain('claude-opus-5-updated');
  });

  it('toggles the useWorktrees boolean field by picking from true/false', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    expect(lastFrame()).toContain('false');
  });

  it('closes on escape when not editing', async () => {
    const onClose = vi.fn();
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client, onClose);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\x1b');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
