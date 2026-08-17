import { describe, it, expect } from 'vitest';
import { canonicalPositions, scatterPositions, generateRoundPair } from '../src/games/cocos-logic.js';

describe('cocos-logic (Quantos Cocos? - senso numérico/subitizing)', () => {
  it('canonicalPositions returns exactly n fixed dice-like positions for 1-3', () => {
    expect(canonicalPositions(1)).toHaveLength(1);
    expect(canonicalPositions(2)).toHaveLength(2);
    expect(canonicalPositions(3)).toHaveLength(3);
  });

  it('canonicalPositions falls back to the 3-item layout for anything above 3', () => {
    expect(canonicalPositions(5)).toEqual(canonicalPositions(3));
  });

  it('scatterPositions returns exactly n positions, deterministic given the same rng sequence', () => {
    const seq = [0.1, 0.9, 0.4, 0.6, 0.2, 0.8, 0.3, 0.7];
    const rng = (() => { let i = 0; return () => seq[i++ % seq.length]; })();
    const a = scatterPositions(4, rng);
    expect(a).toHaveLength(4);
    a.forEach(p => { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThanOrEqual(100); });
  });

  it('scatterPositions never returns fewer than n points even with a degenerate rng', () => {
    const rng = () => 0.5; // always the same point - forces the "give up on min-distance" fallback path
    expect(scatterPositions(6, rng)).toHaveLength(6);
  });

  it('generateRoundPair always returns two distinct quantities within [1, maxQty]', () => {
    const rng = (() => { let i = 0; const seq = [0.9, 0.1, 0.5, 0.2, 0.05]; return () => seq[i++ % seq.length]; })();
    const { left, right } = generateRoundPair(6, 1.6, rng);
    expect(left).not.toBe(right);
    expect(left).toBeGreaterThanOrEqual(1); expect(left).toBeLessThanOrEqual(6);
    expect(right).toBeGreaterThanOrEqual(1); expect(right).toBeLessThanOrEqual(6);
  });

  it('generateRoundPair respects the minimum ratio between the two quantities', () => {
    const rng = (() => { let i = 0; const seq = [0.9, 0.05, 0.9, 0.05, 0.9, 0.05]; return () => seq[i++ % seq.length]; })();
    const { left, right } = generateRoundPair(6, 2.5, rng);
    const ratio = Math.max(left, right) / Math.min(left, right);
    expect(ratio).toBeGreaterThanOrEqual(2.5);
  });

  it('generateRoundPair falls back to the widest possible ratio (1 vs maxQty) if minRatio is unreachable otherwise', () => {
    const rng = () => 0.5; // deterministic: never lands on a valid ratio by chance within maxQty=3
    const { left, right } = generateRoundPair(3, 2.9, rng);
    expect([left, right].sort((a, b) => a - b)).toEqual([1, 3]);
  });
});
