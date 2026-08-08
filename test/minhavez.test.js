import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { minhavez: { facil: { turns: 2, hint: true }, medio: { turns: 2, hint: false }, dificil: { turns: 2, hint: false } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

import { chatInit, chatStart, chatContinue } from '../src/games/minhavez.js';
import { setStars, addSeeds } from '../src/lib/game-progress.js';
import { state, session } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="chatTitle"></div>
    <div id="chatInstructions"></div>
    <button id="chatStartBtn"></button>
    <div id="chatPreStart"></div>
    <div id="chatPlayArea"></div>
    <div id="turnIndicator"></div>
    <div id="turnIndicatorLabel"></div>
    <button id="chatContinueBtn"></button>
    <div id="chatFeedback" class="feedback-banner"></div>
    <div id="chatBubble"></div>
    <div id="replyOptions"></div>
    <div id="mascotSpeech"></div>
  `;
}

// With Math.random fixed at 0.5, both the turn-shuffle and the per-turn
// reply-shuffle (.sort(() => Math.random() - 0.5), comparator always 0,
// stable sort) leave CHAT_SCRIPT's original order untouched - so the
// correct reply is always the first ".reply-btn" rendered (CHAT_SCRIPT lists
// the ok:true option first in every turn), and turns play out in the
// script's own order.
function replyButtons(){
  return [...document.querySelectorAll('#replyOptions .reply-btn')];
}

describe('minhavez (Minha Vez, Sua Vez) game', () => {
  beforeEach(() => {
    buildDom();
    state.lang = 'pt';
    state.profile = { difficultyByGame: { minhavez: 'medio' }, starsByGame: {} };
    session.sessionCompleted = false;
    setStars.mockClear();
    addSeeds.mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awards 3 stars and 3 seeds per turn for a perfect run (correct on the first try every turn)', () => {
    chatInit();
    chatStart(); // 2 turns configured above

    replyButtons()[0].click(); // correct reply, turn 1
    chatContinue(); // advances to turn 2
    replyButtons()[0].click(); // correct reply, turn 2
    chatContinue(); // turn 2 was the last -> chatEnd()

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('minhavez', 3);
    expect(addSeeds).toHaveBeenCalledWith(6); // 2 first-try-correct turns * 3
    expect(document.getElementById('chatFeedback').className).toContain('good');
  });

  it('does not repeat the wrong-pick feedback for the same turn, and does not count it as first-try-correct', () => {
    chatInit();
    chatStart();

    replyButtons()[1].click(); // wrong reply (index 0 is always the ok:true option, per the note above)
    expect(document.getElementById('chatFeedback').className).toContain('gentle');

    chatContinue(); // wrong -> chat.willAdvance is false, so the SAME turn repeats
    expect(document.getElementById('chatContinueBtn').style.display).toBe('none');

    replyButtons()[0].click(); // now pick correctly, same turn (retried)
    chatContinue();
    replyButtons()[0].click(); // turn 2, correct on the only try
    chatContinue();

    // Turn 1 needed a retry, so it never counted toward firstTryCorrect - only turn 2 did.
    expect(setStars).toHaveBeenCalledWith('minhavez', 2); // ratio 1/2=0.5 -> meets the >=0.5 threshold for 2 stars
    expect(addSeeds).toHaveBeenCalledWith(3); // 1 first-try-correct turn * 3
  });

  it('shows the option hint text only when the configured difficulty enables it', () => {
    state.profile.difficultyByGame.minhavez = 'facil'; // hint: true in the mocked DIFF above
    chatInit();
    chatStart();
    const anyHint = replyButtons().some(b => b.querySelector('.reply-hint'));
    expect(anyHint).toBe(true);
  });
});
