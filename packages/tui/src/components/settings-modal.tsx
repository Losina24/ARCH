import type { ArchClient } from '@losina/daemon-client';
import type { AgentMeshConfig } from '@losina/schemas';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useState } from 'react';
import { ACCENT, MODAL_BG, SELECTION_CURSOR } from '../theme.js';
import { ModelPickerModal } from './model-picker-modal.js';
import { PROMPT_BOX_MAX_WIDTH } from './prompt-box.js';

interface SettingsModalProps {
  client: ArchClient;
  columns: number;
  rows: number;
  onConfigChange: (config: AgentMeshConfig) => void;
  onClose: () => void;
}

const BOOLEAN_OPTIONS = ['true', 'false'] as const;

const FIELDS = [
  { key: 'architectModel', label: 'Architect model', kind: 'model' },
  { key: 'tlModel', label: 'TL model', kind: 'model' },
  { key: 'workerModel', label: 'Worker model', kind: 'model' },
  { key: 'maxConcurrency', label: 'Max concurrency', kind: 'text' },
  { key: 'maxRetries', label: 'Max retries', kind: 'text' },
  { key: 'useWorktrees', label: 'Use worktrees', kind: 'boolean', options: BOOLEAN_OPTIONS },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];
type Field = (typeof FIELDS)[number];

function hasOptions(field: Field): field is Field & { options: readonly string[] } {
  return 'options' in field;
}

function isModelField(field: Field): boolean {
  return field.kind === 'model';
}

const TITLE = 'Settings';
const HINT = 'enter edit · s save · esc close';
const SIDE_PADDING = 2;
const VERTICAL_PADDING = 1;
const CURSOR_WIDTH = 2;
const LABEL_WIDTH = Math.max(...FIELDS.map((field) => field.label.length)) + 2;

// At least as wide as PromptBox so the modal fully covers its border where they overlap,
// same convention as HelpModal.
const CONTENT_WIDTH = Math.max(
  TITLE.length + 2 + HINT.length,
  PROMPT_BOX_MAX_WIDTH - SIDE_PADDING * 2,
);
const WIDTH = CONTENT_WIDTH + SIDE_PADDING * 2;
const HEIGHT = FIELDS.length + 4 + VERTICAL_PADDING * 2;

export function SettingsModal({
  client,
  columns,
  rows,
  onConfigChange,
  onClose,
}: SettingsModalProps) {
  const [values, setValues] = useState<Record<FieldKey, string>>({
    architectModel: '',
    tlModel: '',
    workerModel: '',
    maxConcurrency: '',
    maxRetries: '',
    useWorktrees: '',
  });
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [optionIndex, setOptionIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    client.getConfig().then((config) => {
      setValues({
        architectModel: config.models.architectModel,
        tlModel: config.models.tlModel,
        workerModel: config.models.workerModel,
        maxConcurrency: String(config.execution.maxConcurrency),
        maxRetries: String(config.execution.maxRetries),
        useWorktrees: String(config.execution.useWorktrees),
      });
    });
  }, [client]);

  const save = async () => {
    setStatus('Saving…');
    const updated = await client.setConfig({
      models: {
        architectModel: values.architectModel,
        tlModel: values.tlModel,
        workerModel: values.workerModel,
      },
      maxConcurrency: Number(values.maxConcurrency),
      maxRetries: Number(values.maxRetries),
      useWorktrees: values.useWorktrees === 'true',
    });
    setValues({
      architectModel: updated.models.architectModel,
      tlModel: updated.models.tlModel,
      workerModel: updated.models.workerModel,
      maxConcurrency: String(updated.execution.maxConcurrency),
      maxRetries: String(updated.execution.maxRetries),
      useWorktrees: String(updated.execution.useWorktrees),
    });
    onConfigChange(updated);
    setStatus('Saved.');
  };

  const confirmEdit = (value: string) => {
    setValues((previous) => ({ ...previous, [FIELDS[selected].key]: value }));
    setEditing(false);
  };

  useInput((input, key) => {
    if (pickerOpen) return; // ModelPickerModal owns input while it's open

    const field = FIELDS[selected];

    if (editing && hasOptions(field)) {
      if (key.escape) {
        setEditing(false);
      } else if (key.upArrow) {
        setOptionIndex((index) => Math.max(0, index - 1));
      } else if (key.downArrow) {
        setOptionIndex((index) => Math.min(field.options.length - 1, index + 1));
      } else if (key.return) {
        confirmEdit(field.options[optionIndex]);
      }
      return;
    }

    if (editing) {
      if (key.escape) setEditing(false);
      return;
    }

    if (key.escape) {
      onClose();
    } else if (key.upArrow) {
      setSelected((index) => Math.max(0, index - 1));
    } else if (key.downArrow) {
      setSelected((index) => Math.min(FIELDS.length - 1, index + 1));
    } else if (key.return) {
      if (isModelField(field)) {
        setPickerOpen(true);
      } else if (hasOptions(field)) {
        const currentIndex = field.options.indexOf(
          values[field.key] as (typeof field.options)[number],
        );
        setOptionIndex(currentIndex === -1 ? 0 : currentIndex);
        setEditing(true);
      } else {
        setEditValue(values[field.key]);
        setEditing(true);
      }
    } else if (input === 's') {
      void save();
    }
  });

  const marginLeft = Math.max(0, Math.floor((columns - WIDTH) / 2));
  const marginTop = Math.max(0, Math.floor((rows - HEIGHT) / 2));
  const gap = Math.max(0, CONTENT_WIDTH - TITLE.length - HINT.length);
  const sidePadding = ' '.repeat(SIDE_PADDING);
  const blankLine = ' '.repeat(WIDTH);
  const valueWidth = Math.max(0, CONTENT_WIDTH - CURSOR_WIDTH - LABEL_WIDTH);

  if (pickerOpen) {
    return (
      <ModelPickerModal
        currentValue={values[FIELDS[selected].key]}
        columns={columns}
        rows={rows}
        onSelect={(model) => {
          setValues((previous) => ({ ...previous, [FIELDS[selected].key]: model }));
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    );
  }

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
          {TITLE}
        </Text>
        {' '.repeat(gap)}
        <Text dimColor backgroundColor={MODAL_BG}>
          {HINT}
        </Text>
        {sidePadding}
      </Text>

      <Text backgroundColor={MODAL_BG}>{blankLine}</Text>

      {FIELDS.map((field, index) => {
        const isEditingThis = editing && index === selected;
        let valueCell: string;
        if (isEditingThis && hasOptions(field)) {
          valueCell = `‹ ${field.options[optionIndex]} ›`.padEnd(valueWidth);
        } else if (!isEditingThis) {
          valueCell = values[field.key].padEnd(valueWidth);
        } else {
          valueCell = '';
        }

        return (
          <Box key={field.key}>
            <Text backgroundColor={MODAL_BG}>
              {sidePadding}
              <Text color={index === selected ? ACCENT : undefined} backgroundColor={MODAL_BG}>
                {index === selected ? `${SELECTION_CURSOR} ` : '  '}
                {field.label.padEnd(LABEL_WIDTH)}
              </Text>
            </Text>
            {isEditingThis && !hasOptions(field) ? (
              <>
                <Text backgroundColor={MODAL_BG}>
                  <TextInput value={editValue} onChange={setEditValue} onSubmit={confirmEdit} />
                </Text>
                <Text backgroundColor={MODAL_BG}>
                  {' '.repeat(Math.max(0, valueWidth - editValue.length - 1))}
                </Text>
              </>
            ) : (
              <Text backgroundColor={MODAL_BG} color={isEditingThis ? ACCENT : undefined}>
                {valueCell}
              </Text>
            )}
            <Text backgroundColor={MODAL_BG}>{sidePadding}</Text>
          </Box>
        );
      })}

      <Text backgroundColor={MODAL_BG}>{blankLine}</Text>
      <Text
        backgroundColor={MODAL_BG}
      >{`${sidePadding}${status.padEnd(CONTENT_WIDTH)}${sidePadding}`}</Text>

      {Array.from({ length: VERTICAL_PADDING }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: padding rows are interchangeable blank lines
        <Text key={`bottom-${index}`} backgroundColor={MODAL_BG}>
          {blankLine}
        </Text>
      ))}
    </Box>
  );
}
