import { describe, expect, it } from 'vitest';
import { dimHex, neonGradientColor } from './neon-gradient.js';

describe('neonGradientColor', () => {
  it('returns the first stop at t=0 and the last stop at t=1', () => {
    expect(neonGradientColor(0)).toBe('#00eaff');
    expect(neonGradientColor(1)).toBe('#ff3d81');
  });

  it('clamps out-of-range input to the endpoints', () => {
    expect(neonGradientColor(-5)).toBe(neonGradientColor(0));
    expect(neonGradientColor(5)).toBe(neonGradientColor(1));
  });

  it('produces a distinct color partway through the ramp', () => {
    const mid = neonGradientColor(0.5);
    expect(mid).not.toBe(neonGradientColor(0));
    expect(mid).not.toBe(neonGradientColor(1));
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('dimHex', () => {
  it('scales each channel down by the given factor', () => {
    expect(dimHex('#ff0000', 0.5)).toBe('#800000');
  });

  it('never produces a negative channel', () => {
    expect(dimHex('#000000', 0.5)).toBe('#000000');
  });
});
