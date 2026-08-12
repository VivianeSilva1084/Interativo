import { describe, it, expect } from 'vitest';
import {
  stateKey, cloneState, statesEqual, enumerateMoves,
  bfsDistancesFromGoal, generateInitialState, computeStars, moveCap,
} from '../src/games/cestas-logic.js';

describe('cestas-logic (Cestas da Ilha - Torre de Londres adaptada)', () => {
  it('stateKey/statesEqual/cloneState agree on identity and independence', () => {
    const a = [['🍎', '🍌'], ['🍇'], []];
    const b = cloneState(a);
    expect(statesEqual(a, b)).toBe(true);
    b[0].pop();
    expect(statesEqual(a, b)).toBe(false); // clone is independent, mutating b didn't touch a
    expect(stateKey(a)).toBe('🍎,🍌|🍇|');
  });

  it('enumerateMoves only offers moves respecting basket capacity and non-empty origin', () => {
    const state = [['🍎'], ['🍌', '🍇'], []];
    const capacities = [2, 2, 1];
    const moves = enumerateMoves(state, capacities);
    // origin 1 is full-capacity destination-wise for basket 1 (cap 2, already 2) - can't be a destination
    expect(moves.some(m => m.to === 1)).toBe(false);
    // basket 2 is empty - never a valid origin
    expect(moves.some(m => m.from === 2)).toBe(false);
    // moving from 0 to 2 is legal (0 has a fruit, 2 has room)
    expect(moves.some(m => m.from === 0 && m.to === 2)).toBe(true);
  });

  it('enumerateMoves returns nothing from a fully-stuck-empty board', () => {
    const state = [[], [], []];
    expect(enumerateMoves(state, [2, 2, 2])).toHaveLength(0);
  });

  it('bfsDistancesFromGoal gives distance 0 to the goal and 1 to a single legal move away', () => {
    const goal = [['🍎'], ['🍌'], []];
    const capacities = [2, 2, 2];
    const distances = bfsDistancesFromGoal(goal, capacities);
    expect(distances.get(stateKey(goal))).toBe(0);
    const oneMoveAway = [[], ['🍌'], ['🍎']]; // moved 🍎 from basket 0 to basket 2
    expect(distances.get(stateKey(oneMoveAway))).toBe(1);
  });

  it('generateInitialState produces a state reachable from the goal within genMoves steps, rarely equal to the goal', () => {
    const goal = [['🍎', '🍌'], ['🍇'], []];
    const capacities = [2, 2, 1];
    const rng = (() => { let calls = [0.1, 0.9, 0.4, 0.6, 0.2]; let i = 0; return () => calls[i++ % calls.length]; })();
    const initial = generateInitialState(goal, capacities, 3, rng);
    const distances = bfsDistancesFromGoal(goal, capacities);
    expect(distances.has(stateKey(initial))).toBe(true); // reachable from goal
    expect(distances.get(stateKey(initial))).toBeLessThanOrEqual(3); // at most genMoves away
  });

  it('computeStars: 0 extra moves -> 3 stars, up to 2 extra -> 2 stars, more -> 1 star', () => {
    expect(computeStars(4, 4)).toBe(3);
    expect(computeStars(4, 5)).toBe(2);
    expect(computeStars(4, 6)).toBe(2);
    expect(computeStars(4, 7)).toBe(1);
    expect(computeStars(4, 20)).toBe(1);
  });

  it('moveCap gives a generous but finite ceiling scaling with minMoves', () => {
    expect(moveCap(1)).toBe(7);
    expect(moveCap(5)).toBe(19);
  });
});
