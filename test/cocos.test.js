import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// game-progress.js is mocked for the same reason as semaforo.test.js/
// cestas.test.js: its exports persist to Supabase via saveProfileData, out
// of scope for a game-logic test. DIFF is replaced with tiny/deterministic
// values (maxQty:3, minRatio:2.9 forces the 1-vs-3 fallback pair every round,
// so the "correct side" is always predictable in the test).
vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { cocos: { facil: { rounds: 2, maxQty: 3, minRatio: 2.9, canonical: true }, medio: { rounds: 2, maxQty: 3, minRatio: 2.9, canonical: true }, dificil: { rounds: 2, maxQty: 3, minRatio: 2.9, canonical: true } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

import { cocosInit, cocosStart, cocosPick } from '../src/games/cocos.js';
import { setStars, addSeeds } from '../src/lib/game-progress.js';
import { state, session } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="cocosTitle"></div>
    <div id="cocosInstructions"></div>
    <button id="cocosStartBtn"></button>
    <div id="cocosPreStart"></div>
    <div id="cocosPlayArea"></div>
    <div id="cocosFeedback" class="feedback-banner"></div>
    <div id="cocosRounds"></div>
    <button id="cocosLeftPile"></button>
    <button id="cocosRightPile"></button>
    <div id="mascotSpeech"></div>
  `;
}

function pickCorrectSide(){
  // With maxQty:3/minRatio:2.9 every round is the deterministic 1-vs-3 fallback
  // pair (see cocos-logic.js generateRoundPair) - whichever pile rendered 3
  // coconuts (3 <span> children) is the correct tap.
  const left = document.getElementById('cocosLeftPile').children.length;
  return left === 3 ? 'left' : 'right';
}

describe('cocos game (Quantos Cocos? - senso numérico)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildDom();
    state.lang = 'pt';
    state.profile = { difficultyByGame: { cocos: 'medio' }, starsByGame: {} };
    session.currentGameKey = null;
    session.currentSessionId = null;
    session.sessionCompleted = false;
    setStars.mockClear();
    addSeeds.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('awards 3 stars and the full seed bonus when every round is answered correctly', () => {
    cocosInit();
    cocosStart();

    for (let round = 0; round < 2; round++) {
      cocosPick(pickCorrectSide());
      vi.advanceTimersByTime(900);
    }

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('cocos', 3);
    expect(addSeeds).toHaveBeenCalledWith(4); // 2 hits * 2 seeds
  });

  it('never fails the session on a wrong tap - just marks a miss and moves on', () => {
    cocosInit();
    cocosStart();

    const wrongSide = pickCorrectSide() === 'left' ? 'right' : 'left';
    cocosPick(wrongSide);

    expect(document.getElementById('cocosFeedback').className).toContain('gentle');
    const dots = document.querySelectorAll('#cocosRounds .round-dot');
    expect(dots[0].className).toContain('miss');
    vi.advanceTimersByTime(900);
    expect(session.sessionCompleted).toBe(false); // still mid-session, round 2 pending
  });

  it('ignores a second tap on the same round instead of double-counting it', () => {
    cocosInit();
    cocosStart();

    const side = pickCorrectSide();
    cocosPick(side);
    cocosPick(side); // repeat tap before the round advances - must be a no-op
    vi.advanceTimersByTime(900);

    const dots = document.querySelectorAll('#cocosRounds .round-dot');
    expect(dots[0].classList.contains('hit')).toBe(true);
    expect(dots[1].classList.contains('hit') || dots[1].classList.contains('miss')).toBe(false); // round 2 untouched by the repeat tap
  });
});
