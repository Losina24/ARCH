/**
 * Continuous cyberpunk neon gradient (electric cyan → violet → magenta →
 * hot pink) used to color the ARCH wordmark left-to-right as one flowing
 * ramp, rather than a discrete color per letter.
 */
interface Rgb {
  r: number;
  g: number;
  b: number;
}

const STOPS: Rgb[] = ['#00eaff', '#7a5cff', '#ff2bd6', '#ff3d81'].map(hexToRgb);

function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const clampChannel = (channel: number) => Math.min(255, Math.max(0, Math.round(channel)));
  return `#${[r, g, b]
    .map((channel) => clampChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Maps t in [0, 1] to a hex color along the neon gradient, clamping out-of-range input. */
export function neonGradientColor(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const segment = clamped * (STOPS.length - 1);
  const index = Math.min(STOPS.length - 2, Math.floor(segment));
  const localT = segment - index;
  const from = STOPS[index];
  const to = STOPS[index + 1];

  return rgbToHex({
    r: lerp(from.r, to.r, localT),
    g: lerp(from.g, to.g, localT),
    b: lerp(from.b, to.b, localT),
  });
}

/** Scales a hex color's brightness by `factor` (0-1) — used for the dim halo glow. */
export function dimHex(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({ r: r * factor, g: g * factor, b: b * factor });
}
