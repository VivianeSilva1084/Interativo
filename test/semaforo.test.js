import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// game-progress.js is mocked because its exports (setStars/addSeeds/
// renderDiffRow) persist to Supabase via saveProfileData - out of scope for
// a game-logic test, and exercising the real path would need a full profile
// + working sb.from(...) chain just to satisfy imports. DIFF is replaced with
// tiny values so the round timing below can run in milliseconds instead of
// the real 1-3 second waits. session-state.js and game-shared.js are used
// for real: both are plain, DOM-light, and testing against the real state/
// session objects is what actually proves semaforo.js is wired correctly.
vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { semaforo: { facil: { rounds: 2, greenMs: 1000, waitMin: 0, waitMax: 0 }, medio: { rounds: 2, greenMs: 1000, waitMin: 0, waitMax: 0 }, dificil: { rounds: 2, greenMs: 1000, waitMin: 0, waitMax: 0 } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

import { semInit, semStart, semTap } from '../src/games/semaforo.js';
import { setStars, addSeeds } from '../src/lib/game-progress.js';
import { state, session } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="semTitle"></div>
    <div id="semInstructions"></div>
    <button id="semStartBtn"></button>
    <div id="semPreStart"></div>
    <div id="semPlayArea"></div>
    <div id="semFeedback" class="feedback-banner"></div>
    <div id="semRounds"></div>
    <div id="semLight"></div>
    <div id="mascotSpeech"></div>
  `;
}

describe('semaforo game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildDom();
    state.lang = 'pt';
    state.profile = { difficultyByGame: { semaforo: 'medio' }, starsByGame: {} };
    session.currentGameKey = null;
    session.currentSessionId = null;
    session.sessionCompleted = false;
    setStars.mockClear();
    addSeeds.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('awards 3 stars and the full seed bonus when every round is tapped on time', () => {
    semInit();
    semStart();

    for (let round = 0; round < 2; round++) {
      vi.advanceTimersByTime(0); // fires the wait-timeout -> light turns green
      expect(document.getElementById('semLight').className).toContain('go');
      semTap(); // tap while green -> a hit
      vi.advanceTimersByTime(900); // markRound's feedback-hide + next-round delay
      // A 0ms timer scheduled *from inside* the callback that advanceTimersByTime just
      // ran isn't picked up by another advanceTimersByTime(0) call - fake-timers only
      // considers it "pending" afterwards, so it needs its own flush.
      vi.runOnlyPendingTimers(); // fires the next round's own wait-timeout
    }

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('semaforo', 3);
    expect(addSeeds).toHaveBeenCalledWith(4); // 2 hits * 2 seeds
  });

  it('treats a tap before the light turns green as a premature click, not a hit', () => {
    semInit();
    semStart();

    semTap(); // still 'wait', light hasn't turned green yet
    expect(document.getElementById('semFeedback').className).toContain('gentle');

    const dotsBeforeGreen = document.querySelectorAll('#semRounds .round-dot.hit, #semRounds .round-dot.miss');
    expect(dotsBeforeGreen.length).toBe(0); // no round was consumed by the early tap
  });

  it('counts a missed green window (no tap at all) as a miss, not a hit', () => {
    semInit();
    semStart();

    vi.advanceTimersByTime(0); // light turns green
    vi.advanceTimersByTime(1000); // greenMs elapses with no tap -> auto-miss
    vi.advanceTimersByTime(900); // markRound's delay into round 2
    vi.runOnlyPendingTimers(); // round 2's own wait-timeout (see comment above)

    const dots = document.querySelectorAll('#semRounds .round-dot');
    expect(dots[0].className).toContain('miss');
  });
});
