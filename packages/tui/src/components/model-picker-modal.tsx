import {
  type AgentProvider,
  detectInstalledProvidersAsync,
  detectProvider,
  listOpenCodeModels,
} from '@losina/agent-runtime';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useState } from 'react';
import { ACCENT, MODAL_BG, SELECTION_CURSOR } from '../theme.js';
import { PROMPT_BOX_MAX_WIDTH } from './prompt-box.js';

interface ModelPickerModalProps {
  currentValue: string;
  columns: number;
  rows: number;
  onSelect: (model: string) => void;
  onCancel: () => void;
}

interface ProviderDef {
  key: 'claude' | 'codex' | 'opencode' | 'opencode-zen';
  label: string;
  models: string[];
}

// Same three CLIs @losina/agent-runtime's detectProvider routes to, plus a UI-only split of
// OpenCode into its generic upstream-provider models and OpenCode Zen's own hosted catalog —
// both dispatch through the same `opencode` binary (detectProvider only knows 'opencode'), so
// the split exists purely to let Zen models show up without needing a live `opencode models`
// fetch. Claude/Codex's lists are a handful of known ids plus a "Custom…" escape hatch — GPT ids
// ship often, so that list can never be exhaustive either. Generic OpenCode's placeholder model
// here is only the loading-state fallback: its real list is fetched live via `listOpenCodeModels`
// since "provider/model" ids depend entirely on which upstream provider the user has
// authenticated. Zen's list is curated by hand since its models are stable and don't require the
// live fetch (see https://opencode.ai/docs/zen/) — handy when the CLI is authenticated only via
// `{env:OPENCODE_API_KEY}` in opencode.json (e.g. on a headless EC2/Fargate box) rather than
// through an interactive `opencode auth login`, where the live fetch may not have run yet.
const ALL_PROVIDERS: ProviderDef[] = [
  {
    key: 'claude',
    label: 'Claude Code',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-haiku-4-5-20251001'],
  },
  {
    key: 'codex',
    label: 'Codex',
    models: ['gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-mini'],
  },
  {
    key: 'opencode',
    label: 'OpenCode',
    models: ['github-copilot/gpt-4.1'],
  },
  {
    key: 'opencode-zen',
    label: 'OpenCode Zen',
    models: [
      'opencode/grok-code',
      'opencode/kimi-k2',
      'opencode/glm-4.6',
      'opencode/qwen3-coder',
      'opencode/gpt-oss-120b',
    ],
  },
];

// The Zen namespace ("opencode/<model>") is reserved by OpenCode's own hosted catalog, so it's an
// unambiguous split from every other "provider/model" id detectProvider also routes to 'opencode'.
const OPENCODE_ZEN_PREFIX = 'opencode/';

type Provider = ProviderDef;
type ProviderKey = Provider['key'];
type Stage = 'provider' | 'model' | 'custom';

// Mirrors detectProvider, but further splits its single 'opencode' result into the two rows this
// modal shows. Used only for picking which row a model id "belongs to" (home highlighting,
// filtering) — actual dispatch still goes through detectProvider, which doesn't need the split.
function uiProviderKeyFor(model: string): ProviderKey {
  const provider = detectProvider(model);
  if (provider !== 'opencode') return provider;
  return model.startsWith(OPENCODE_ZEN_PREFIX) ? 'opencode-zen' : 'opencode';
}

const CUSTOM = 'Custom…';

// Only offers CLIs actually installed on this machine — but always keeps the model's own
// provider in the list even when undetected, so a configured-but-uninstalled provider stays
// visible and editable instead of vanishing from under the current selection. OpenCode's models
// are swapped for the live-detected list whenever that fetch found any.
// installed is keyed by AgentProvider (detectInstalledProvidersAsync only knows the three CLI
// binaries) — 'opencode-zen' rides on the same 'opencode' binary, so it's installed exactly when
// that binary is.
function isInstalled(installed: Set<AgentProvider>, key: ProviderKey): boolean {
  return key === 'opencode-zen' ? installed.has('opencode') : installed.has(key);
}

function visibleProvidersFor(
  installed: Set<AgentProvider>,
  currentValue: string,
  opencodeModels: string[],
): Provider[] {
  const providers = ALL_PROVIDERS.map((provider) =>
    provider.key === 'opencode' && opencodeModels.length > 0
      ? { ...provider, models: opencodeModels }
      : provider,
  );
  const homeKey = uiProviderKeyFor(currentValue);
  const filtered = providers.filter(
    (provider) => isInstalled(installed, provider.key) || provider.key === homeKey,
  );
  return filtered.length > 0 ? filtered : providers;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

function providerIndexFor(providers: Provider[], model: string): number {
  const key = uiProviderKeyFor(model);
  const index = providers.findIndex((provider) => provider.key === key);
  return index === -1 ? 0 : index;
}

// Only pre-selects "Custom…" when `providerIndex` is the provider the current value actually
// belongs to *and* that value isn't one of the known models — i.e. the configured model really
// is a custom one. Landing on any other provider (the user browsing away from the current
// selection) always starts at the first known model instead of jumping straight to "Custom…".
function modelIndexFor(
  providers: Provider[],
  providerIndex: number,
  homeProviderIndex: number,
  model: string,
): number {
  const index = providers[providerIndex].models.indexOf(model);
  if (index !== -1) return index;
  return providerIndex === homeProviderIndex ? providers[providerIndex].models.length : 0;
}

const TITLE_BY_STAGE: Record<Stage, (providerLabel: string) => string> = {
  provider: () => 'Select provider',
  model: (providerLabel) => `Select model — ${providerLabel}`,
  custom: (providerLabel) => `Custom model — ${providerLabel}`,
};

const HINT_BY_STAGE: Record<Stage, string> = {
  provider: 'enter select · esc cancel',
  model: 'enter select · esc back',
  custom: 'enter confirm · esc back',
};

const SIDE_PADDING = 2;
const VERTICAL_PADDING = 1;
// 44 leaves room for real OpenCode ids fetched at runtime (e.g. "github-copilot/gemini-3.1-pro-
// preview") without truncating most of them; anything longer still gets ellipsized when rendered.
const CONTENT_WIDTH = Math.max(
  ...ALL_PROVIDERS.flatMap((provider) => [
    provider.label.length,
    ...provider.models.map((model) => model.length),
  ]),
  CUSTOM.length,
  ...Object.entries(TITLE_BY_STAGE).map(
    ([stage, title]) => title('Claude Code').length + 2 + HINT_BY_STAGE[stage as Stage].length,
  ),
  PROMPT_BOX_MAX_WIDTH - SIDE_PADDING * 2,
  44,
);
const WIDTH = CONTENT_WIDTH + SIDE_PADDING * 2;
// Fixed regardless of how many models a provider actually has — OpenCode's live-fetched list can
// run into the dozens, so the body scrolls instead of growing the modal to fit every entry.
const VISIBLE_ROWS = 8;
const LIST_ROWS = Math.max(ALL_PROVIDERS.length, VISIBLE_ROWS);
const HEIGHT = LIST_ROWS + 2 + VERTICAL_PADDING * 2;

function truncateForDisplay(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function ModelPickerModal({
  currentValue,
  columns,
  rows,
  onSelect,
  onCancel,
}: ModelPickerModalProps) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [homeProviderIndex, setHomeProviderIndex] = useState(0);
  const [stage, setStage] = useState<Stage>('provider');
  const [providerIndex, setProviderIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [customValue, setCustomValue] = useState('');
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // currentValue is intentionally excluded: detection should only run once per mount, keyed off
  // the value the modal opened with, since the parent remounts the modal rather than reusing it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above.
  useEffect(() => {
    let cancelled = false;
    Promise.all([detectInstalledProvidersAsync(), listOpenCodeModels()])
      .then(([installed, opencodeModels]) =>
        visibleProvidersFor(installed, currentValue, opencodeModels),
      )
      .catch(() => [...ALL_PROVIDERS])
      .then((resolved) => {
        if (cancelled) return;
        const home = providerIndexFor(resolved, currentValue);
        setHomeProviderIndex(home);
        setProviderIndex(home);
        setModelIndex(modelIndexFor(resolved, home, home, currentValue));
        setProviders(resolved);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (providers !== null) return;
    const interval = setInterval(() => {
      setSpinnerFrame((frame) => (frame + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [providers]);

  const provider = providers?.[providerIndex];
  const modelItems = provider ? [...provider.models, CUSTOM] : [];

  useInput((_input, key) => {
    if (providers === null) {
      if (key.escape) onCancel();
      return;
    }

    if (stage === 'custom') {
      if (key.escape) setStage('model');
      return;
    }

    if (key.escape) {
      if (stage === 'model') setStage('provider');
      else onCancel();
      return;
    }

    const itemCount = stage === 'provider' ? providers.length : modelItems.length;
    const index = stage === 'provider' ? providerIndex : modelIndex;
    const setIndex = stage === 'provider' ? setProviderIndex : setModelIndex;

    if (key.upArrow) {
      setIndex(Math.max(0, index - 1));
    } else if (key.downArrow) {
      setIndex(Math.min(itemCount - 1, index + 1));
    } else if (key.return) {
      if (stage === 'provider') {
        setModelIndex(modelIndexFor(providers, index, homeProviderIndex, currentValue));
        setStage('model');
      } else {
        const chosen = modelItems[index];
        if (chosen === CUSTOM) {
          setCustomValue(providerIndex === homeProviderIndex ? currentValue : '');
          setStage('custom');
        } else {
          onSelect(chosen);
        }
      }
    }
  });

  if (providers === null || !provider) {
    const loadingText = `${SPINNER_FRAMES[spinnerFrame]} Detecting installed providers…`;
    const loadingHeight = 1 + VERTICAL_PADDING * 2;
    const loadingMarginLeft = Math.max(0, Math.floor((columns - WIDTH) / 2));
    const loadingMarginTop = Math.max(0, Math.floor((rows - loadingHeight) / 2));
    const loadingSidePadding = ' '.repeat(SIDE_PADDING);
    const loadingBlankLine = ' '.repeat(WIDTH);

    return (
      <Box
        position="absolute"
        marginLeft={loadingMarginLeft}
        marginTop={loadingMarginTop}
        width={WIDTH}
        height={loadingHeight}
        flexDirection="column"
      >
        {Array.from({ length: VERTICAL_PADDING }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: padding rows are interchangeable blank lines
          <Text key={`top-${index}`} backgroundColor={MODAL_BG}>
            {loadingBlankLine}
          </Text>
        ))}
        <Text backgroundColor={MODAL_BG}>
          {loadingSidePadding}
          <Text color={ACCENT} backgroundColor={MODAL_BG}>
            {loadingText.padEnd(CONTENT_WIDTH)}
          </Text>
          {loadingSidePadding}
        </Text>
        {Array.from({ length: VERTICAL_PADDING }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: padding rows are interchangeable blank lines
          <Text key={`bottom-${index}`} backgroundColor={MODAL_BG}>
            {loadingBlankLine}
          </Text>
        ))}
      </Box>
    );
  }

  const marginLeft = Math.max(0, Math.floor((columns - WIDTH) / 2));
  const marginTop = Math.max(0, Math.floor((rows - HEIGHT) / 2));
  const sidePadding = ' '.repeat(SIDE_PADDING);
  const blankLine = ' '.repeat(WIDTH);
  const title = TITLE_BY_STAGE[stage](provider.label);
  const hint = HINT_BY_STAGE[stage];
  const gap = Math.max(0, CONTENT_WIDTH - title.length - hint.length);

  const items: string[] = stage === 'provider' ? providers.map((p) => p.label) : modelItems;
  const selectedIndex = stage === 'provider' ? providerIndex : modelIndex;

  // Scroll a fixed-size window instead of growing the box when a provider (namely OpenCode,
  // live-fetched) has more models than fit on screen.
  let windowStart = 0;
  let visibleItems = items;
  if (stage !== 'custom' && items.length > VISIBLE_ROWS) {
    windowStart = Math.min(
      Math.max(0, selectedIndex - Math.floor(VISIBLE_ROWS / 2)),
      items.length - VISIBLE_ROWS,
    );
    visibleItems = items.slice(windowStart, windowStart + VISIBLE_ROWS);
  }

  const bodyRows = stage === 'custom' ? 1 : visibleItems.length;
  const fillerRows = Math.max(0, LIST_ROWS - bodyRows);

  return (
    <Box
      position="absolute"
      marginLeft={marginLeft}
      marginTop={marginTop}
      width={WIDTH}
      height={HEIGHT}
      flexDirection="column"
    >
      {Array.from({ length: VERTICAL_PADDING }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: padding rows are interchangeable blank lines
        <Text key={`top-${index}`} backgroundColor={MODAL_BG}>
          {blankLine}
        </Text>
      ))}

      <Text backgroundColor={MODAL_BG}>
        {sidePadding}
        <Text bold color={ACCENT} backgroundColor={MODAL_BG}>
          {title}
        </Text>
        {' '.repeat(gap)}
        <Text dimColor backgroundColor={MODAL_BG}>
          {hint}
        </Text>
        {sidePadding}
      </Text>

      <Text backgroundColor={MODAL_BG}>{blankLine}</Text>

      {stage === 'custom' ? (
        <Box>
          <Text backgroundColor={MODAL_BG}>{sidePadding}</Text>
          <Text backgroundColor={MODAL_BG}>
            <TextInput
              value={customValue}
              onChange={setCustomValue}
              onSubmit={(value) => {
                if (value.trim()) onSelect(value.trim());
              }}
            />
          </Text>
          <Text backgroundColor={MODAL_BG}>
            {' '.repeat(Math.max(0, CONTENT_WIDTH - customValue.length))}
          </Text>
          <Text backgroundColor={MODAL_BG}>{sidePadding}</Text>
        </Box>
      ) : (
        visibleItems.map((item, index) => {
          const absoluteIndex = windowStart + index;
          return (
            <Text key={`${windowStart}-${item}`} backgroundColor={MODAL_BG}>
              {sidePadding}
              <Text
                color={absoluteIndex === selectedIndex ? ACCENT : undefined}
                backgroundColor={MODAL_BG}
              >
                {absoluteIndex === selectedIndex ? `${SELECTION_CURSOR} ` : '  '}
                {truncateForDisplay(item, CONTENT_WIDTH - 2).padEnd(CONTENT_WIDTH - 2)}
              </Text>
              {sidePadding}
            </Text>
          );
        })
      )}

      {Array.from({ length: fillerRows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: filler rows are interchangeable blank lines
        <Text key={index} backgroundColor={MODAL_BG}>
          {blankLine}
        </Text>
      ))}

      {Array.from({ length: VERTICAL_PADDING }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: padding rows are interchangeable blank lines
        <Text key={`bottom-${index}`} backgroundColor={MODAL_BG}>
          {blankLine}
        </Text>
      ))}
    </Box>
  );
}
