import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeWeeklyUsage, getChildDifficulty } from '../src/lib/parents-data.js';

describe('computeWeeklyUsage', () => {
  // Fixed "now" so the 7-day cutoff is deterministic. Sessions below are built
  // with the (year, month, day, hour, ...) Date constructor, not ISO/UTC math -
  // that keeps same-day comparisons correct regardless of the test runner's
  // local timezone (unlike subtracting milliseconds from `now`, which can
  // cross a local midnight depending on TZ and make .getDay() disagree).
  const NOW = new Date(2024, 2, 15, 20, 0, 0); // 2024-03-15, 20:00 local

  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  it('buckets a session\'s minutes into its weekday', () => {
    const start = new Date(2024, 2, 15, 10, 0, 0);
    const end = new Date(2024, 2, 15, 10, 25, 0); // 25-minute session
    const result = computeWeeklyUsage([{ played_at: start.toISOString(), end_time: end.toISOString() }]);
    expect(result[start.getDay()]).toBe(25);
    result.forEach((minutes, day) => { if (day !== start.getDay()) expect(minutes).toBe(0); });
  });

  it('ignores sessions with no end_time (abandoned/in-progress)', () => {
    const start = new Date(2024, 2, 15, 10, 0, 0);
    const result = computeWeeklyUsage([{ played_at: start.toISOString(), end_time: null }]);
    expect(result).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('ignores sessions older than 7 days from now', () => {
    const start = new Date(2024, 2, 6, 10, 0, 0); // 9 days before NOW
    const end = new Date(2024, 2, 6, 10, 10, 0);
    const result = computeWeeklyUsage([{ played_at: start.toISOString(), end_time: end.toISOString() }]);
    expect(result).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('sums multiple sessions that land on the same weekday', () => {
    const s1 = { played_at: new Date(2024, 2, 15, 9, 0, 0).toISOString(), end_time: new Date(2024, 2, 15, 9, 10, 0).toISOString() };
    const s2 = { played_at: new Date(2024, 2, 15, 14, 0, 0).toISOString(), end_time: new Date(2024, 2, 15, 14, 15, 0).toISOString() };
    const result = computeWeeklyUsage([s1, s2]);
    expect(result[new Date(2024, 2, 15).getDay()]).toBe(25);
  });
});

describe('getChildDifficulty', () => {
  it('returns the stored difficulty for that game', () => {
    expect(getChildDifficulty({ difficulty_by_game: { semaforo: 'dificil' } }, 'semaforo')).toBe('dificil');
  });

  it('defaults to medio when that specific game has no stored difficulty', () => {
    expect(getChildDifficulty({ difficulty_by_game: { semaforo: 'dificil' } }, 'memoria')).toBe('medio');
  });

  it('defaults to medio when difficulty_by_game is missing entirely', () => {
    expect(getChildDifficulty({}, 'semaforo')).toBe('medio');
  });
});
