import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// memoria.js registers a pointerdown listener on #simonGrid as a top-level
// side effect (document.getElementById('simonGrid').addEventListener(...)),
// which runs the instant the module is imported - before any beforeEach.
// vi.hoisted runs before the (also-hoisted) import below, so #simonGrid has
// to exist by then or the import itself throws (getElementById returns null,
// .addEventListener on null crashes the whole file). simonInput is exported
// and called directly in the tests below, so the real click-through-the-
// listener path is never exercised - this placeholder just has to exist.
vi.hoisted(() => {
  document.body.innerHTML = '<div id="simonGrid"></div>';
});

// Mocked for the same reason as in semaforo.test.js: setStars/addSeeds
// persist to Supabase via saveProfileData, out of scope for a game-logic
// test. DIFF is replaced with a tiny maxLevel so mastery is reachable in a
// couple of steps instead of grinding through the real progression.
vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { memoria: { facil: { maxLevel: 2, startLen: 2, stepDelay: 10 }, medio: { maxLevel: 2, startLen: 2, stepDelay: 10 }, dificil: { maxLevel: 2, startLen: 2, stepDelay: 10 } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

import { simonInit, simonStart, simonInput } from '../src/games/memoria.js';
import { setStars, addSeeds } from '../src/lib/game-progress.js';
import { state, session } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="memTitle"></div>
    <div id="memInstructions"></div>
    <button id="memStartBtn"></button>
    <div id="memPreStart"></div>
    <div id="memPlayArea"></div>
    <div id="simonFeedback" class="feedback-banner"></div>
    <div id="simonLevel"></div>
    <div id="trailFootprints"></div>
    <div id="mascotSpeech"></div>
    <div id="simonGrid">
      <button class="trail-pad" data-i="0"></button>
      <button class="trail-pad" data-i="1"></button>
      <button class="trail-pad" data-i="2"></button>
      <button class="trail-pad" data-i="3"></button>
    </div>
  `;
}

// Forces Math.random() to return a fixed sequence of values, one per call -
// simon.sequence/the next-tile-added-per-level both come from Math.random(),
// and the test needs to know the sequence in advance to tap it correctly.
function stubRandomSequence(values){
  let i = 0;
  vi.spyOn(Math, 'random').mockImplementation(() => values[i++ % values.length]);
}

describe('memoria (Trilha da Kapi) game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildDom();
    state.lang = 'pt';
    state.profile = { difficultyByGame: { memoria: 'medio' }, starsByGame: {} };
    session.currentGameKey = null;
    session.sessionCompleted = false;
    setStars.mockClear();
    addSeeds.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reaches mastery (3 stars, +10 seeds) after correctly repeating every level up to maxLevel', () => {
    // Math.floor(x*4) with x in [0, 0.25) -> 0. Every random call below
    // resolves to pad 0, for a startLen:2 sequence [0, 0] then one more
    // 0 appended for level 2 - so tapping pad 0 is always correct.
    stubRandomSequence([0.1]);

    simonInit();
    simonStart(); // sequence = [0, 0], schedules the playback (500ms + 2*stepDelay)
    vi.runOnlyPendingTimers(); // step 500ms delay
    vi.advanceTimersByTime(10); // stepDelay between pad 1 and pad 2
    vi.advanceTimersByTime(10); // stepDelay after the last pad - playing becomes false

    simonInput(0);
    vi.advanceTimersByTime(280); // simonInput's own 280ms re-tap lock
    simonInput(0); // completes level 1's sequence correctly -> advances to level 2, replays

    expect(addSeeds).toHaveBeenCalledWith(2); // reward for clearing a non-final level
    vi.runOnlyPendingTimers(); // the 1200ms level-up delay -> calls simonPlaySequence()
    vi.runOnlyPendingTimers(); // simonPlaySequence's own 500ms delay -> first step() of level 2
    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(10); // level 2's sequence is 3 pads long

    simonInput(0);
    vi.advanceTimersByTime(280);
    simonInput(0);
    vi.advanceTimersByTime(280);
    simonInput(0); // completes level 2 = maxLevel -> mastery

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('memoria', 3);
    expect(addSeeds).toHaveBeenCalledWith(10);
  });

  it('resets to level 1 difficulty scoring on a wrong tap, without ending the session', () => {
    stubRandomSequence([0.1]); // sequence = [0, 0]

    simonInit();
    simonStart();
    vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(10);
    vi.advanceTimersByTime(10);

    simonInput(1); // wrong - sequence starts with 0, not 1

    expect(document.getElementById('simonFeedback').className).toContain('gentle');
    expect(setStars).toHaveBeenCalledWith('memoria', 0); // level 1, no levels cleared yet
    expect(session.sessionCompleted).toBe(false);
  });

  it('ignores taps while the sequence is still playing back (premature click)', () => {
    stubRandomSequence([0.1]);

    simonInit();
    simonStart(); // playback in progress, hasn't reached the 500ms delay yet

    simonInput(0); // simon.playing is still true at this point

    expect(document.getElementById('simonFeedback').className).not.toContain('gentle');
    expect(document.getElementById('simonFeedback').className).not.toContain('good');
  });
});
