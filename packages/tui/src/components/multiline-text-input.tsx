import { Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';

// Pasting more than this many lines collapses the paste into a single
// "[Pasted text #N +X lines]" placeholder instead of dumping it inline.
export const PASTE_LINE_THRESHOLD = 5;

// A paste can also be "long" without containing a single newline (e.g. one
// unbroken paragraph) — collapse it too once it crosses this length, since
// dumping it inline would otherwise overflow a row with no way to shrink it.
export const PASTE_CHAR_THRESHOLD = 300;

// Real terminals sometimes deliver one paste across more than one raw stdin read
// (each read fires its own useInput call), so a multi-character chunk is buffered
// for this long, waiting for possible continuation fragments, before it's evaluated
// as a whole. Plain typing never triggers this path since each keystroke is a single
// character on its own.
//
// This has to comfortably outlast real-world inter-fragment delay, not just event-loop
// jitter: some terminals (Warp in particular) trickle a large paste into stdin across
// many small writes with noticeable gaps between them, rather than delivering it as one
// burst the way iTerm2/Terminal.app do. If the window is too tight, an early fragment
// that looks short/plain on its own gets flushed and rendered as literal text before the
// rest of the paste arrives — a visible flash of raw pasted text that only resolves into
// the placeholder once the remaining fragments land. Raising this has effectively no
// downside for normal typing: a genuine subsequent keystroke still flushes any pending
// buffer immediately (see the "any other key" handling below) rather than waiting out
// this window, so it only affects how long we wait when nothing else happens next.
export const PASTE_FLUSH_MS = 400;

// Terminals wrap a pasted block in "bracketed paste" markers (ESC[200~ ... ESC[201~).
// Ink's keypress parser doesn't recognize this sequence, so it only strips the leading
// ESC byte from an unrecognized escape code and passes the rest through as literal
// `input` text — leaving "[200~"/"[201~" embedded in what we'd otherwise treat as pasted
// content. Left unstripped, that garbage would land in the real value; worse, if the
// start marker arrives in its own short stdin fragment (common for large pastes split
// across writes), the old debounce-only logic would flush it as visible literal text
// before the real content caught up — the exact flash this exists to prevent.
function stripPasteMarkers(text: string): string {
  return text
    .split('\x1b[200~')
    .join('')
    .split('\x1b[201~')
    .join('')
    .split('[200~')
    .join('')
    .split('[201~')
    .join('');
}

function hasPasteEndMarker(text: string): boolean {
  return text.includes('\x1b[201~') || text.includes('[201~');
}

export interface PasteRange {
  start: number;
  end: number;
  label: string;
}

export function pasteLabel(index: number, lineCount: number): string {
  return `[Pasted text #${index} +${lineCount} lines]`;
}

interface EditResult {
  value: string;
  pastes: PasteRange[];
  cursor: number;
}

function insertText(
  value: string,
  pastes: PasteRange[],
  position: number,
  text: string,
): EditResult {
  const nextValue = value.slice(0, position) + text + value.slice(position);
  const delta = text.length;
  const nextPastes = pastes.map((range) => ({
    ...range,
    // A range's start moves with anything inserted at or before it; its end only moves
    // for insertions strictly inside it, so typing right after a pasted block (position
    // === end) appends after the block instead of being swallowed into it.
    start: range.start >= position ? range.start + delta : range.start,
    end: range.end > position ? range.end + delta : range.end,
  }));
  return { value: nextValue, pastes: nextPastes, cursor: position + delta };
}

// Backspace deletes a pasted block as one atomic unit when the cursor sits right after
// it (mirroring how it renders as a single token), otherwise a plain single character.
function deleteBeforeCursor(
  value: string,
  pastes: PasteRange[],
  cursor: number,
): EditResult | undefined {
  if (cursor <= 0) return undefined;

  const block = pastes.find((range) => range.end === cursor);
  if (block) {
    const nextValue = value.slice(0, block.start) + value.slice(block.end);
    const removed = block.end - block.start;
    const nextPastes = pastes
      .filter((range) => range !== block)
      .map((range) => ({
        ...range,
        start: range.start >= block.end ? range.start - removed : range.start,
        end: range.end >= block.end ? range.end - removed : range.end,
      }));
    return { value: nextValue, pastes: nextPastes, cursor: block.start };
  }

  const nextValue = value.slice(0, cursor - 1) + value.slice(cursor);
  const nextPastes = pastes.map((range) => ({
    ...range,
    start: range.start >= cursor ? range.start - 1 : range.start,
    end: range.end >= cursor ? range.end - 1 : range.end,
  }));
  return { value: nextValue, pastes: nextPastes, cursor: cursor - 1 };
}

// Arrow movement skips a pasted block as a single step, same as backspace treats it as
// a single unit — landing inside a collapsed token would have nothing meaningful to show.
function stepCursor(
  pastes: PasteRange[],
  cursor: number,
  direction: 1 | -1,
  limit: number,
): number {
  if (direction === -1) {
    const block = pastes.find((range) => range.end === cursor);
    return block ? block.start : Math.max(0, cursor - 1);
  }
  const block = pastes.find((range) => range.start === cursor);
  return block ? block.end : Math.min(limit, cursor + 1);
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

// A pasted block renders as a single token, so a target position that would otherwise
// land inside one (from a word/line jump) snaps to whichever edge is in the direction
// of travel — same "atomic unit" rule arrow-stepping and backspace already follow.
function snapOutOfBlock(pastes: PasteRange[], position: number, direction: 1 | -1): number {
  const block = pastes.find((range) => position > range.start && position < range.end);
  if (!block) return position;
  return direction === -1 ? block.start : block.end;
}

// Option+Left (and Ctrl+Left on Linux/Windows terminals) — jump to the start of the
// previous word, treating a pasted block right before the cursor as one atomic word.
function wordLeft(value: string, pastes: PasteRange[], cursor: number): number {
  const block = pastes.find((range) => range.end === cursor);
  if (block) return block.start;
  let pos = cursor;
  while (pos > 0 && isSpace(value[pos - 1])) pos--;
  while (pos > 0 && !isSpace(value[pos - 1])) pos--;
  return snapOutOfBlock(pastes, pos, -1);
}

// Option+Right (and Ctrl+Right) — mirror of wordLeft, jumping to the start of the next word.
function wordRight(value: string, pastes: PasteRange[], cursor: number): number {
  const block = pastes.find((range) => range.start === cursor);
  if (block) return block.end;
  let pos = cursor;
  while (pos < value.length && isSpace(value[pos])) pos++;
  while (pos < value.length && !isSpace(value[pos])) pos++;
  return snapOutOfBlock(pastes, pos, 1);
}

// Ctrl+A, and what Terminal.app/iTerm2 send by default for Cmd+Left — start of the
// current line.
function lineStart(value: string, pastes: PasteRange[], cursor: number): number {
  let pos = cursor;
  while (pos > 0 && value[pos - 1] !== '\n') pos--;
  return snapOutOfBlock(pastes, pos, -1);
}

// Ctrl+E / Cmd+Right — end of the current line.
function lineEnd(value: string, pastes: PasteRange[], cursor: number): number {
  let pos = cursor;
  while (pos < value.length && value[pos] !== '\n') pos++;
  return snapOutOfBlock(pastes, pos, 1);
}

// Deletes [start, end) as one edit — used by Ctrl+U (kill to line start) and
// Option+Backspace/Ctrl+W (delete previous word). A block fully inside the range is
// dropped whole, same as a single backspace right after it would.
function deleteRange(
  value: string,
  pastes: PasteRange[],
  start: number,
  end: number,
): EditResult | undefined {
  if (start >= end) return undefined;
  const nextValue = value.slice(0, start) + value.slice(end);
  const removed = end - start;
  const nextPastes = pastes
    .filter((range) => !(range.start >= start && range.end <= end))
    .map((range) => ({
      ...range,
      start: range.start >= end ? range.start - removed : range.start,
      end: range.end >= end ? range.end - removed : range.end,
    }));
  return { value: nextValue, pastes: nextPastes, cursor: start };
}

// Decides whether a (possibly reassembled) chunk of pasted text should collapse into a
// placeholder, and produces the resulting edit either way.
function applyPaste(
  value: string,
  pastes: PasteRange[],
  cursor: number,
  text: string,
  pasteCounter: { current: number },
): EditResult {
  const lineCount = text.split('\n').length;
  const isLongPaste =
    text.length > 1 && (lineCount > PASTE_LINE_THRESHOLD || text.length > PASTE_CHAR_THRESHOLD);
  if (isLongPaste) {
    pasteCounter.current += 1;
    const label = pasteLabel(pasteCounter.current, lineCount);
    const inserted = insertText(value, pastes, cursor, text);
    return {
      ...inserted,
      pastes: [...inserted.pastes, { start: cursor, end: cursor + text.length, label }],
    };
  }
  return insertText(value, pastes, cursor, text);
}

interface DisplayResult {
  text: string;
  cursorIndex: number;
  dimMask: boolean[];
}

// Renders the real value with each pasted range collapsed into its label, and maps the
// real cursor position onto the resulting display string.
function buildDisplay(value: string, pastes: PasteRange[], cursor: number): DisplayResult {
  const sorted = [...pastes].sort((a, b) => a.start - b.start);
  let text = '';
  const dimMask: boolean[] = [];
  let cursorIndex = 0;
  let pos = 0;

  function append(chunk: string, dim: boolean) {
    text += chunk;
    for (let i = 0; i < chunk.length; i++) dimMask.push(dim);
  }

  for (const range of sorted) {
    if (range.start > pos) {
      const chunk = value.slice(pos, range.start);
      if (cursor >= pos && cursor <= range.start) cursorIndex = text.length + (cursor - pos);
      append(chunk, false);
    }
    if (cursor === range.start) cursorIndex = text.length;
    append(range.label, true);
    if (cursor === range.end) cursorIndex = text.length;
    pos = range.end;
  }

  if (pos <= value.length) {
    const chunk = value.slice(pos);
    if (cursor >= pos) cursorIndex = text.length + Math.min(cursor - pos, chunk.length);
    append(chunk, false);
  }

  return { text, cursorIndex, dimMask };
}

interface DisplayRow {
  chars: string[];
  dims: boolean[];
  cursorCol: number | null;
}

function splitRows(display: DisplayResult): DisplayRow[] {
  const lines = display.text.split('\n');
  const rows: DisplayRow[] = [];
  let consumed = 0;
  for (const line of lines) {
    const end = consumed + line.length;
    const cursorCol =
      display.cursorIndex >= consumed && display.cursorIndex <= end
        ? display.cursorIndex - consumed
        : null;
    rows.push({ chars: [...line], dims: display.dimMask.slice(consumed, end), cursorCol });
    consumed = end + 1;
  }
  return rows;
}

// Input never grows beyond this many visible rows — once content exceeds it,
// the earliest rows scroll out of view, same as a terminal scrolling up.
const MAX_VISIBLE_ROWS = 3;

// Defaults to the last MAX_VISIBLE_ROWS rows, but shifts the window up to
// keep the cursor row visible if it's been left behind above that range
// (e.g. after backspacing or jumping left across an earlier line).
function windowRows(rows: DisplayRow[], maxRows: number): DisplayRow[] {
  if (rows.length <= maxRows) return rows;
  const cursorRowIndex = rows.findIndex((row) => row.cursorCol !== null);
  const defaultStart = rows.length - maxRows;
  const start =
    cursorRowIndex !== -1 && cursorRowIndex < defaultStart ? cursorRowIndex : defaultStart;
  return rows.slice(start, start + maxRows);
}

interface MultilineTextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
}

export function MultilineTextInput({
  value: externalValue,
  onChange,
  onSubmit,
  placeholder = '',
  focus = true,
}: MultilineTextInputProps) {
  // value/pastes/cursor live in ONE state object, updated with a single setState call
  // per edit, instead of three separate pieces of state (a parent-owned `value` prop
  // plus two local ones). Ink's renderer doesn't guarantee that a prop update reaching
  // this component through `onChange` and this component's own local state land in the
  // same render pass — especially when an edit is committed from the paste-flush timer
  // below rather than directly from a keypress. A render that only saw the longer value
  // but not yet its matching PasteRange would show the raw pasted text before it
  // collapses into a placeholder. Keeping all three in one state object makes that
  // impossible: there both is only one update to see, and it's always self-consistent.
  const [local, setLocal] = useState<EditResult>({
    value: externalValue,
    pastes: [],
    cursor: externalValue.length,
  });
  // A commit made synchronously inside the useInput callback (typing, arrow keys,
  // immediate paste flush) lands together with its onChange in the same batch as
  // anything else that callback triggers, e.g. an onSubmit-driven clear from the parent —
  // so comparing externalValue to local.value directly is reliable there. A commit made
  // from the debounce timer below runs in its own macrotask, outside that batching: the
  // parent's prop update can reach this component in a LATER render than our own
  // `setLocal`, making that in-between render (local already updated, externalValue
  // still stale) look identical to a genuine external reset. This flag suspends the
  // reset check until externalValue actually catches up, but only around that one commit
  // path — synchronous commits keep using the direct comparison so a real external reset
  // (e.g. clearing on submit) is still recognized immediately.
  const awaitingParentSync = useRef(false);
  const pasteCounter = useRef(0);
  const pendingPaste = useRef<string | null>(null);
  const pendingPasteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (awaitingParentSync.current) {
    if (externalValue === local.value) awaitingParentSync.current = false;
  } else if (externalValue !== local.value) {
    // The parent changed `value` on its own (e.g. cleared it after submit) rather than
    // through our own onChange — drop the stale cursor/paste bookkeeping.
    pasteCounter.current = 0;
    setLocal({ value: externalValue, pastes: [], cursor: externalValue.length });
  }

  useEffect(() => {
    return () => {
      if (pendingPasteTimer.current) clearTimeout(pendingPasteTimer.current);
    };
  }, []);

  function commit(result: EditResult): EditResult {
    const previousValue = local.value;
    setLocal(result);
    if (result.value !== previousValue) onChange(result.value);
    return result;
  }

  useInput(
    (input, key) => {
      // A chunk longer than one character is either a whole paste or one fragment of a
      // paste that arrived split across more than one raw stdin read — buffer it briefly
      // and only decide placeholder-or-literal once no further fragments show up. Plain
      // typing never reaches here since each keystroke is a single character on its own.
      if (!key.ctrl && input.length > 1) {
        pendingPaste.current = (pendingPaste.current ?? '') + stripPasteMarkers(input);
        if (pendingPasteTimer.current) clearTimeout(pendingPasteTimer.current);

        // The terminal's own end-of-paste marker is a hard signal the block is complete —
        // commit right away instead of still waiting out the debounce window below.
        if (hasPasteEndMarker(input)) {
          pendingPasteTimer.current = null;
          const buffered = pendingPaste.current;
          pendingPaste.current = null;
          if (buffered)
            commit(applyPaste(local.value, local.pastes, local.cursor, buffered, pasteCounter));
          return;
        }

        pendingPasteTimer.current = setTimeout(() => {
          pendingPasteTimer.current = null;
          const buffered = pendingPaste.current;
          pendingPaste.current = null;
          if (buffered) {
            awaitingParentSync.current = true;
            commit(applyPaste(local.value, local.pastes, local.cursor, buffered, pasteCounter));
          }
        }, PASTE_FLUSH_MS);
        return;
      }

      // Any other key finalizes a pending paste immediately so it lands before whatever
      // this key does — e.g. Return right after pasting must submit the pasted text too.
      let curValue = local.value;
      let curPastes = local.pastes;
      let curCursor = local.cursor;
      if (pendingPaste.current !== null) {
        if (pendingPasteTimer.current) clearTimeout(pendingPasteTimer.current);
        pendingPasteTimer.current = null;
        const buffered = pendingPaste.current;
        pendingPaste.current = null;
        const flushed = commit(
          applyPaste(local.value, local.pastes, local.cursor, buffered, pasteCounter),
        );
        curValue = flushed.value;
        curPastes = flushed.pastes;
        curCursor = flushed.cursor;
      }

      if (key.upArrow || key.downArrow || (key.ctrl && input === 'c') || key.tab) return;

      if (key.return) {
        onSubmit?.(curValue);
        return;
      }

      // Option+Return (and Alt+Enter on Linux/Windows) arrives as ESC followed by a bare
      // CR/LF. Ink's keypress parser doesn't recognize that sequence as a distinct key —
      // key.name stays empty — but it still reports key.return as false, which is the only
      // reliable way to tell it apart from a plain Return. This is also the best-effort path
      // for Cmd+Return: most terminals (Terminal.app, iTerm2 with default settings) never
      // forward Cmd+Return to the app at all — it's captured for "toggle full screen" — so
      // there's no extra signal available to special-case it beyond what already lands here.
      if (!key.ctrl && (input === '\r' || input === '\n')) {
        commit(insertText(curValue, curPastes, curCursor, '\n'));
        return;
      }

      // Option+Left/Right; Ctrl+Left/Right is the same shortcut on Linux/Windows terminals.
      if (key.leftArrow && (key.meta || key.ctrl)) {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: wordLeft(curValue, curPastes, curCursor),
        });
        return;
      }
      if (key.rightArrow && (key.meta || key.ctrl)) {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: wordRight(curValue, curPastes, curCursor),
        });
        return;
      }
      // Some terminal profiles send Option+Left/Right as the classic emacs meta-b/meta-f
      // sequence instead of an arrow key with a modifier.
      if (key.meta && input === 'b') {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: wordLeft(curValue, curPastes, curCursor),
        });
        return;
      }
      if (key.meta && input === 'f') {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: wordRight(curValue, curPastes, curCursor),
        });
        return;
      }

      if (key.leftArrow) {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: stepCursor(curPastes, curCursor, -1, curValue.length),
        });
        return;
      }
      if (key.rightArrow) {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: stepCursor(curPastes, curCursor, 1, curValue.length),
        });
        return;
      }

      // Ctrl+A / Ctrl+E — also what Terminal.app and iTerm2 send by default for Cmd+Left/Right.
      if (key.ctrl && input === 'a') {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: lineStart(curValue, curPastes, curCursor),
        });
        return;
      }
      if (key.ctrl && input === 'e') {
        commit({
          value: curValue,
          pastes: curPastes,
          cursor: lineEnd(curValue, curPastes, curCursor),
        });
        return;
      }

      // Ctrl+U — also what Terminal.app and iTerm2 send by default for Cmd+Backspace.
      if (key.ctrl && input === 'u') {
        const result = deleteRange(
          curValue,
          curPastes,
          lineStart(curValue, curPastes, curCursor),
          curCursor,
        );
        if (result) commit(result);
        return;
      }

      // Option+Backspace and Ctrl+W both mean "delete the previous word".
      if (((key.backspace || key.delete) && key.meta) || (key.ctrl && input === 'w')) {
        const result = deleteRange(
          curValue,
          curPastes,
          wordLeft(curValue, curPastes, curCursor),
          curCursor,
        );
        if (result) commit(result);
        return;
      }

      if (key.backspace || key.delete) {
        const result = deleteBeforeCursor(curValue, curPastes, curCursor);
        if (result) commit(result);
        return;
      }

      if (key.ctrl || input.length === 0) return;

      commit(insertText(curValue, curPastes, curCursor, input));
    },
    { isActive: focus },
  );

  if (local.value.length === 0 && placeholder) {
    return (
      <Text>
        {focus ? <Text inverse>{placeholder[0]}</Text> : placeholder[0]}
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  const display = buildDisplay(local.value, local.pastes, local.cursor);
  const rows = windowRows(splitRows(display), MAX_VISIBLE_ROWS);

  return (
    <>
      {rows.map((row, rowIndex) => {
        // Building the cursor cell as part of the same mapped array (rather than a
        // trailing sibling Text after row.chars.map(...)) sidesteps an Ink/Yoga layout
        // bug where a Box-wrapped Text with an array of mapped children plus one extra
        // sibling child truncates the row on re-render.
        const cells: Array<{ char: string; dim: boolean; inverse: boolean }> =
          row.chars.length === 0
            ? [{ char: ' ', dim: false, inverse: focus && row.cursorCol === 0 }]
            : row.chars.map((char, charIndex) => ({
                char,
                dim: row.dims[charIndex],
                inverse: focus && row.cursorCol === charIndex,
              }));
        if (row.chars.length > 0 && focus && row.cursorCol === row.chars.length) {
          cells.push({ char: ' ', dim: false, inverse: true });
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are display lines derived fresh from the current text every render, not a reorderable list.
          <Text key={rowIndex}>
            {cells.map((cell, cellIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cells of a display line derived fresh from the current text every render.
              <Text key={cellIndex} dimColor={cell.dim} inverse={cell.inverse}>
                {cell.char}
              </Text>
            ))}
          </Text>
        );
      })}
    </>
  );
}
