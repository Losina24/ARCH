export const ACCENT = 'cyan';
export const SUCCESS = 'green';
export const ERROR = 'red';
export const WARNING = 'yellow';
export const MUTED = 'gray';
// Headings in markdown content (Objetivo, Enfoque…) — blue, distinct from
// ACCENT so heading color and inline-code color don't collide.
export const HEADING = 'blue';
// A task paused for human intervention — a brighter blue than HEADING so the
// two distinct meanings (markdown heading vs. task status) never look the same.
export const WAITING = 'blueBright';
// The cyan accent, reused as a flat color for inline `code` spans (rendered
// italic) so they read as distinct from prose.
export const CODE = ACCENT;
// The hot-pink stop from the neon gradient, used for **emphasized** text.
export const EMPHASIS = '#ff2bd6';
// Amber/orange for tasks and agents that are in review — distinct from the
// WARNING yellow so "in review" doesn't read as "something's wrong".
export const REVIEW = '#ffa657';
// Slightly darker than the plain named "gray" — used for inactive tab
// labels, which read as too light against the background at full gray.
export const INACTIVE = '#4b5563';

// Near-black rather than pure "black" — the named ANSI black maps to a
// mid-gray in several terminal color schemes, which made modal backgrounds
// look gray instead of solid dark.
export const MODAL_BG = '#0a0a0a';

export const SELECTION_CURSOR = '❯';

export const ACTIVITY_HEADLINE = '⏺';
export const ACTIVITY_DETAIL = '⎿';
