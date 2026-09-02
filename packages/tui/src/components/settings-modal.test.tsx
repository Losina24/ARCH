import type { ArchClient } from '@losina/daemon-client';
import type { AgentMeshConfig } from '@losina/schemas';
import { Box } from 'ink';
import type { Stdin } from 'ink-testing-library';
import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { detectInstalledProvidersAsync, listCodexModels, listOpenCodeModels } = vi.hoisted(() => ({
  detectInstalledProvidersAsync: vi.fn(),
  listCodexModels: vi.fn(),
  listOpenCodeModels: vi.fn(),
}));
vi.mock('@losina/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@losina/agent-runtime')>();
  return { ...actual, detectInstalledProvidersAsync, listCodexModels, listOpenCodeModels };
});

const { SettingsModal } = await import('./settings-modal.js');

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

function renderModal(client: ArchClient, onClose = vi.fn(), onConfigChange = vi.fn()) {
  return render(
    <Box position="relative" width={100} height={30}>
      <SettingsModal
        client={client}
        columns={100}
        rows={30}
        onConfigChange={onConfigChange}
        onClose={onClose}
      />
    </Box>,
  );
}

describe('SettingsModal', () => {
  beforeEach(() => {
    detectInstalledProvidersAsync
      .mockReset()
      .mockResolvedValue(new Set(['claude', 'codex', 'opencode']));
    listCodexModels.mockReset().mockResolvedValue([]);
    listOpenCodeModels.mockReset().mockResolvedValue([]);
  });

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

  it('edits a model field through the provider/model picker modal', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\r'); // opens the picker on the provider step
    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure

    await press(stdin, '\r'); // confirms "Claude Code", moves to the model step
    expect(lastFrame()).toContain('Select model — Claude Code');

    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r'); // confirms "claude-fable-5"

    expect(lastFrame()).toContain('claude-fable-5');
  });

  it('picks an OpenCode model as provider/model and stores the canonical id', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B'); // moves selection down to "OpenCode"
    await press(stdin, '\r');
    expect(lastFrame()).toContain('Select model — OpenCode');

    await press(stdin, '\r'); // confirms the only listed OpenCode model

    expect(lastFrame()).toContain('github-copilot/gpt-4.1');
  });

  it('cancels the model picker on escape without changing the value', async () => {
    const client = mockClient();
    const { lastFrame, stdin } = renderModal(client);

    await vi.waitFor(() => expect(lastFrame()).toContain('claude-opus-5'));
    await press(stdin, '\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\r');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b'); // back to the provider step
    expect(lastFrame()).toContain('Select provider');

    await press(stdin, '\x1b'); // cancels entirely

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
    const onConfigChange = vi.fn();
    const { lastFrame, stdin } = renderModal(client, vi.fn(), onConfigChange);

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
    expect(onConfigChange).toHaveBeenCalledWith(updated);
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
