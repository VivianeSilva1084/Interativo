import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: {
    cacaalvo: {
      // facil: no target swap, no distractor fill needed (2 targets exactly
      // fill a 2x2 grid alongside 2 fixed distractors).
      facil: { cols: 2, rows: 2, targets: 2, time: 3, pool: ['🌸'] },
      // medio: switchAtFound = ceil(4/2) = 2, remainingAfterSwitch = 2 -
      // 4 targets + 2 new-target cells exactly fill a 3x2 grid, so which
      // cell holds what is fully determined by insertion order (see below),
      // with zero reliance on the random distractor-fill loop.
      medio: { cols: 3, rows: 2, targets: 4, time: 20, pool: ['🌸', '🍄'] },
      dificil: { cols: 3, rows: 2, targets: 4, time: 20, pool: ['🌸', '🍄'] },
    },
  },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

function buildDom(){
  document.body.innerHTML = `
    <div id="huntTitle"></div>
    <div id="huntInstructions"></div>
    <button id="huntStartBtn"></button>
    <button id="huntAgainBtn"></button>
    <div id="huntPreStart"></div>
    <div id="huntPlayArea"></div>
    <div id="huntTargetChip"></div>
    <div id="huntRuleCue"><span id="huntRuleCueEmoji"></span><span id="huntRuleCueText"></span></div>
    <div id="huntFeedback" class="feedback-banner"></div>
    <button id="huntPaceToggle"></button>
    <div id="huntFoundCount"></div>
    <div id="huntGrid"></div>
    <div id="huntTimerBar"></div>
    <div id="huntTimerBarWrap"></div>
    <div id="huntTimeLeft"></div>
    <div id="mascotSpeech"></div>
  `;
}

function cells(){
  return [...document.querySelectorAll('#huntGrid .hunt-cell')];
}

describe('cacaalvo (Caça ao Alvo) game', () => {
  let huntInit, huntStart, huntTogglePace, setStars, addSeeds, state, session;

  beforeEach(async () => {
    vi.useFakeTimers();
    buildDom();
    // hunt.untimed is toggled (not reset) by huntTogglePace, and persists on
    // the module's internal `hunt` object across calls by design - so a
    // previous test flipping it to "untimed" would silently disable the
    // countdown-timeout test below unless every test starts from a fresh
    // module instance.
    vi.resetModules();
    ({ huntInit, huntStart, huntTogglePace } = await import('../src/games/cacaalvo.js'));
    ({ setStars, addSeeds } = await import('../src/lib/game-progress.js'));
    ({ state, session } = await import('../src/lib/session-state.js'));
    setStars.mockClear();
    addSeeds.mockClear();

    state.lang = 'pt';
    state.profile = { difficultyByGame: { cacaalvo: 'facil' }, starsByGame: {} };
    session.sessionCompleted = false;
    // Fixed at 0.5: the distractor-fill pick (Math.floor(0.5*pool.length))
    // and the final cells.sort(() => Math.random()-0.5) (comparator always
    // 0 -> stable sort keeps insertion order) both become deterministic, so
    // which grid cell holds which emoji is knowable in advance from
    // buildHuntGrid's push order: all `targets` clover cells first, then all
    // `remainingAfterSwitch` new-target cells, then any distractor filler.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('awards 3 stars and 2 seeds per find for a perfect, untimed facil round', () => {
    huntTogglePace(); // untimed:false -> true, skips the countdown interval entirely
    huntInit();
    huntStart();

    expect(cells()[0].dataset.emoji).toBe('🍀');
    expect(cells()[1].dataset.emoji).toBe('🍀');

    cells()[0].click();
    cells()[1].click();

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('cacaalvo', 3);
    expect(addSeeds).toHaveBeenCalledWith(4); // 2 finds * 2 seeds
    expect(document.getElementById('huntFeedback').className).toContain('good');
  });

  it('ends the round when the clock runs out on facil, crediting whatever was found', () => {
    huntInit();
    huntStart(); // timed (time: 3) - untimed defaults to false on a fresh module instance

    cells()[0].click(); // 1 of 2 targets found before time runs out
    vi.advanceTimersByTime(3000); // 3 ticks of the 1s countdown -> timeLeft hits 0 -> huntEnd(false)

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('cacaalvo', 2); // ratio 1/2=0.5 meets the >=0.5 threshold for 2 stars
    expect(document.getElementById('huntFeedback').className).toContain('gentle'); // allFound was false
  });

  it('cues a mid-round target swap on medio, then requires the new target - not the old one - to finish', () => {
    state.profile.difficultyByGame.cacaalvo = 'medio';
    huntTogglePace(); // untimed, isolates the swap timing from the countdown interval
    huntInit();
    huntStart();

    const grid = cells();
    expect(grid.slice(0, 4).every(c => c.dataset.emoji === '🍀')).toBe(true);
    const newTargetEmoji = grid[4].dataset.emoji;
    expect(newTargetEmoji).not.toBe('🍀');

    grid[0].click();
    grid[1].click(); // 2nd clover = switchAtFound -> triggers the rule-change cue (hunt.paused = true)

    expect(document.getElementById('huntTargetChip').style.display).not.toBe('none');

    grid[2].click(); // paused during the cue -> this tap must be ignored entirely
    expect(setStars).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1300); // the cue's own delay -> unpauses, sets the post-switch grace window

    grid[4].click();
    grid[5].click(); // the 2 new-target cells reserved for after the switch

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('cacaalvo', 3); // 4/4 found, ratio 1
  });
});
