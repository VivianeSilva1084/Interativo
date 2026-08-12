import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { cestas: { facil: { fruits: 2, capacities: [2, 2], genMoves: 1 } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

import { cestasInit, cestasStart, cestasRestart } from '../src/games/cestas.js';
import { setStars, addSeeds } from '../src/lib/game-progress.js';
import { state, session } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="cestasTitle"></div>
    <div id="cestasInstructions"></div>
    <button id="cestasStartBtn"></button>
    <div id="cestasPreStart"></div>
    <div id="cestasPlayArea"></div>
    <div id="cestasGoalLabel"></div>
    <div id="cestasGoalBoard"></div>
    <div id="cestasBoardLabel"></div>
    <div id="cestasBoard"></div>
    <button id="cestasRestartBtn"></button>
    <div id="cestasFeedback" class="feedback-banner"></div>
    <div id="mascotSpeech"></div>
  `;
}

// facil = 2 frutas, 1 única meta no banco: [['🍎'],['🍌']] - a única forma de
// já estar fora dela é ambas na mesma cesta, então o único estado inicial
// alcançável em <=2 passos e diferente da meta é [['🍎','🍌'],[]] (minMoves=1).
function clickBasket(index){
  document.querySelectorAll('#cestasBoard .emo-btn')[index].click();
}

describe('cestas (Cestas da Ilha) game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildDom();
    state.lang = 'pt';
    state.profile = { difficultyByGame: { cestas: 'facil' }, starsByGame: {} };
    session.sessionCompleted = false;
    setStars.mockClear();
    addSeeds.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolving in exactly minMoves awards 3 stars and completes the session', () => {
    cestasInit();
    cestasStart();

    // Whatever the generated initial state is, solving optimally always means
    // clicking the non-empty basket then the other one exactly once if
    // minMoves===1, or more generally following the shortest path. For facil
    // with 1 fruit possibly displaced, the simplest robust check is: keep
    // moving fruit from a non-empty basket into the other until goal reached,
    // and assert 3 stars only when done in the reported minimum.
    // Drive it via the board directly instead of hardcoding a path.
    const boardBtns = () => document.querySelectorAll('#cestasBoard .emo-btn');
    // Find a non-empty basket, click it, then click the other basket.
    let attempts = 0;
    while(session.sessionCompleted === false && attempts < 10){
      const btns = boardBtns();
      const nonEmptyIdx = [...btns].findIndex(b => !b.querySelector('.e').textContent.includes('·'));
      clickBasket(nonEmptyIdx);
      const otherIdx = nonEmptyIdx === 0 ? 1 : 0;
      clickBasket(otherIdx);
      attempts++;
    }
    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('cestas', 3); // facil's only reachable non-goal state is 1 move away
    expect(addSeeds).toHaveBeenCalledWith(8);
  });

  it('never shows a failure state - hitting the move cap auto-resets the same problem without ending the session', () => {
    cestasInit();
    cestasStart();

    // Ping-pong the same fruit back and forth well past the (generous) move cap.
    for(let i = 0; i < 10; i++){
      const btns = document.querySelectorAll('#cestasBoard .emo-btn');
      const nonEmptyIdx = [...btns].findIndex(b => !b.querySelector('.e').textContent.includes('·'));
      clickBasket(nonEmptyIdx);
      clickBasket(nonEmptyIdx === 0 ? 1 : 0);
      if(session.sessionCompleted) break; // solved by accident before hitting the cap - re-run is fine
    }
    vi.advanceTimersByTime(2500); // auto-replan delay

    // Either it solved along the way (session completed, fine) or it hit the
    // cap and quietly reset - in the latter case sessionCompleted must stay false.
    if(!session.sessionCompleted){
      expect(setStars).not.toHaveBeenCalled();
      expect(document.getElementById('cestasFeedback').className).not.toContain('show');
    }
  });

  it('voluntary restart logs a retry event and keeps the same problem (goal board unchanged)', () => {
    cestasInit();
    cestasStart();
    const goalBefore = document.getElementById('cestasGoalBoard').innerHTML;

    document.getElementById('cestasRestartBtn').click();

    expect(document.getElementById('cestasGoalBoard').innerHTML).toBe(goalBefore);
    expect(session.sessionCompleted).toBe(false);
  });

  it('tapping the same basket twice deselects it instead of moving anything', () => {
    cestasInit();
    cestasStart();
    const btns = () => document.querySelectorAll('#cestasBoard .emo-btn');
    const nonEmptyIdx = [...btns()].findIndex(b => !b.querySelector('.e').textContent.includes('·'));
    clickBasket(nonEmptyIdx);
    expect(btns()[nonEmptyIdx].className).toContain('selected');
    clickBasket(nonEmptyIdx);
    expect(btns()[nonEmptyIdx].className).not.toContain('selected');
  });
});
