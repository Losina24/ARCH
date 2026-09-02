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

const { ModelPickerModal } = await import('./model-picker-modal.js');

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

function renderPicker(currentValue: string, onSelect = vi.fn(), onCancel = vi.fn()) {
  return {
    onSelect,
    onCancel,
    ...render(
      <Box position="relative" width={100} height={30}>
        <ModelPickerModal
          currentValue={currentValue}
          columns={100}
          rows={30}
          onSelect={onSelect}
          onCancel={onCancel}
        />
      </Box>,
    ),
  };
}

describe('ModelPickerModal', () => {
  beforeEach(() => {
    detectInstalledProvidersAsync
      .mockReset()
      .mockResolvedValue(new Set(['claude', 'codex', 'opencode']));
    listCodexModels.mockReset().mockResolvedValue([]);
    listOpenCodeModels.mockReset().mockResolvedValue([]);
  });

  it('shows a loading indicator while providers are being detected', async () => {
    let resolveDetection!: (value: Set<string>) => void;
    detectInstalledProvidersAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveDetection = resolve;
      }),
    );

    const { lastFrame } = renderPicker('claude-sonnet-5');

    expect(lastFrame()).toContain('Detecting installed providers');

    resolveDetection(new Set(['claude', 'codex', 'opencode']));
    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
  });

  it('opens on the provider step with the current model’s provider preselected', async () => {
    const { lastFrame } = renderPicker('claude-sonnet-5');
    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    expect(lastFrame()).toContain('Claude Code');
    expect(lastFrame()).toContain('Codex');
    expect(lastFrame()).toContain('OpenCode');
  });

  it('selects a model for the preselected provider in two steps', async () => {
    const onSelect = vi.fn();
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5', onSelect);

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\r'); // confirms Claude Code
    expect(lastFrame()).toContain('Select model — Claude Code');

    await press(stdin, '\x1b[B'); // claude-sonnet-5 -> claude-fable-5
    await press(stdin, '\r');

    expect(onSelect).toHaveBeenCalledWith('claude-fable-5');
  });

  it('lands on the first model, not Custom…, when browsing to a different provider', async () => {
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\x1b[B'); // Claude Code -> Codex
    await press(stdin, '\r');

    expect(lastFrame()).toContain('Select model — Codex');
    const frame = lastFrame() ?? '';
    const cursorLine = frame.split('\n').find((line) => line.includes('❯'));
    expect(cursorLine).toContain('gpt-5.6-sol');
    expect(cursorLine).not.toContain('Custom');
  });

  it('goes back a step on escape from the model list, then cancels from the provider list', async () => {
    const onCancel = vi.fn();
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5', vi.fn(), onCancel);

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\r');
    await press(stdin, '\x1b');
    expect(lastFrame()).toContain('Select provider');
    expect(onCancel).not.toHaveBeenCalled();

    await press(stdin, '\x1b');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('types a custom model id via the Custom… entry', async () => {
    const onSelect = vi.fn();
    // Starts on Codex so browsing to Claude Code's "Custom…" starts from an empty field
    // (prefill only kicks in for the model's own home provider).
    const { lastFrame, stdin } = renderPicker('gpt-5.6-sol', onSelect);

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\x1b[A'); // Codex (home provider, preselected) -> Claude Code
    await press(stdin, '\r'); // confirms Claude Code
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B'); // down to "Custom…" (4 known Claude models)
    expect(lastFrame()).toContain('Custom');
    await press(stdin, '\r');
    expect(lastFrame()).toContain('Custom model — Claude Code');

    await type(stdin, 'claude-opus-6-preview');
    await press(stdin, '\r');

    expect(onSelect).toHaveBeenCalledWith('claude-opus-6-preview');
  });

  it('prefills Custom… with the current value when it is an unknown model of its own provider', async () => {
    const { lastFrame, stdin } = renderPicker('gpt-6-experimental');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\r'); // Codex is preselected since "gpt-" routes there
    expect(lastFrame()).toContain('Select model — Codex');

    await press(stdin, '\r'); // cursor already defaults to "Custom…"
    expect(lastFrame()).toContain('gpt-6-experimental');
  });

  it('hides a provider whose CLI is not installed', async () => {
    detectInstalledProvidersAsync.mockResolvedValue(new Set(['claude']));

    const { lastFrame } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    expect(lastFrame()).toContain('Claude Code');
    expect(lastFrame()).not.toContain('Codex');
    expect(lastFrame()).not.toContain('OpenCode');
  });

  it('still lists the current model’s provider even when its CLI is not detected as installed', async () => {
    detectInstalledProvidersAsync.mockResolvedValue(new Set(['claude']));

    const { lastFrame } = renderPicker('gpt-5.6-sol');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    expect(lastFrame()).toContain('Codex');
  });

  it('falls back to listing every provider if detection itself throws', async () => {
    detectInstalledProvidersAsync.mockRejectedValue(new Error('spawn failed'));

    const { lastFrame } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    expect(lastFrame()).toContain('Claude Code');
    expect(lastFrame()).toContain('Codex');
    expect(lastFrame()).toContain('OpenCode');
  });

  it('lists the live Codex catalog instead of the static fallback', async () => {
    listCodexModels.mockResolvedValue(['gpt-5.6-sol', 'gpt-5.5']);
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\x1b[B'); // Claude Code -> Codex
    await press(stdin, '\r');

    expect(lastFrame()).toContain('Select model — Codex');
    expect(lastFrame()).toContain('gpt-5.6-sol');
    expect(lastFrame()).toContain('gpt-5.5');
    expect(lastFrame()).not.toContain('gpt-5.6-luna');
  });

  it('lists the live-detected OpenCode models instead of the static placeholder', async () => {
    listOpenCodeModels.mockResolvedValue(['anthropic/claude-opus-5', 'openai/gpt-5.1']);
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\x1b[B'); // Claude Code -> Codex
    await press(stdin, '\x1b[B'); // Codex -> OpenCode
    await press(stdin, '\r');

    expect(lastFrame()).toContain('Select model — OpenCode');
    expect(lastFrame()).toContain('anthropic/claude-opus-5');
    expect(lastFrame()).toContain('openai/gpt-5.1');
    expect(lastFrame()).not.toContain('github-copilot/gpt-4.1');
  });

  it('lists OpenCode Zen as its own provider with its curated model catalog', async () => {
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    expect(lastFrame()).toContain('OpenCode Zen');

    await press(stdin, '\x1b[B'); // Claude Code -> Codex
    await press(stdin, '\x1b[B'); // Codex -> OpenCode
    await press(stdin, '\x1b[B'); // OpenCode -> OpenCode Zen
    await press(stdin, '\r');

    expect(lastFrame()).toContain('Select model — OpenCode Zen');
    expect(lastFrame()).toContain('opencode/grok-code');
  });

  it('preselects OpenCode Zen, not generic OpenCode, when the current model is a Zen id', async () => {
    const { lastFrame, stdin } = renderPicker('opencode/grok-code');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\r'); // confirms the preselected provider

    expect(lastFrame()).toContain('Select model — OpenCode Zen');
  });

  it('scrolls a long OpenCode model list instead of showing every entry at once', async () => {
    const models = Array.from({ length: 20 }, (_, index) => `provider/model-${index}`);
    listOpenCodeModels.mockResolvedValue(models);
    const { lastFrame, stdin } = renderPicker('claude-sonnet-5');

    await vi.waitFor(() => expect(lastFrame()).toContain('Select provider'));
    await tick(); // let ink's useInput effect resubscribe with the now-loaded closure
    await press(stdin, '\x1b[B');
    await press(stdin, '\x1b[B');
    await press(stdin, '\r');

    expect(lastFrame()).toContain('Select model — OpenCode');
    expect(lastFrame()).toContain('provider/model-0');
    expect(lastFrame()).not.toContain('provider/model-19');

    for (let i = 0; i < 19; i++) {
      await press(stdin, '\x1b[B');
    }

    expect(lastFrame()).toContain('provider/model-19');
    expect(lastFrame()).not.toContain('provider/model-0');
  });
});
