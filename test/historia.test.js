import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { historia: { facil: { len: 3 }, medio: { len: 4 }, dificil: { len: 5 } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

function buildDom(){
  document.body.innerHTML = `
    <div id="storyTitle"></div>
    <button id="storyStartBtn"></button>
    <button id="storyResetBtn"></button>
    <div id="storyPreStart"></div>
    <div id="storyPlayArea"></div>
    <div id="storyInstructions"></div>
    <div id="storyFeedback" class="feedback-banner"></div>
    <div id="storyCards"></div>
    <div id="storyAnswer"></div>
    <div id="mascotSpeech"></div>
  `;
}

function cardsInRenderedOrder(){
  return [...document.querySelectorAll('#storyCards .story-card')];
}

describe('historia (Monte a História) game', () => {
  let storyInit, storyStart, setStars, addSeeds, state, session;

  beforeEach(async () => {
    buildDom();
    // historia.js keeps story.lastPickIdx/lastWasPerfect around *by design*,
    // to retry the same story after an imperfect attempt - so a stale
    // lastPickIdx left over from a previous test, combined with Math.random
    // always returning the same stubbed value below, would make
    // storyStart()'s anti-repeat do-while loop forever (idx can never differ
    // from itself). vi.resetModules() gives every test a fresh module
    // instance instead, so lastPickIdx always starts at null. That means
    // state/session/setStars/addSeeds also have to be re-imported after the
    // reset - importing them at file scope would keep pointing at the
    // module instances from *before* the reset, not the ones historia.js is
    // actually using post-reset.
    vi.resetModules();
    ({ storyInit, storyStart } = await import('../src/games/historia.js'));
    ({ setStars, addSeeds } = await import('../src/lib/game-progress.js'));
    ({ state, session } = await import('../src/lib/session-state.js'));
    setStars.mockClear();
    addSeeds.mockClear();

    state.lang = 'pt';
    state.profile = { difficultyByGame: { historia: 'medio' }, starsByGame: {} };
    session.sessionCompleted = false;
    // Fixed at 0.5 makes two things deterministic: the story pick
    // (Math.floor(0.5 * bankLength)) and the shuffle
    // (.sort(() => Math.random() - 0.5) with a comparator that's always 0 -
    // a stable sort leaves the original card order untouched), so the
    // rendered card order always equals story.correct's order.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('awards 3 stars and the seed bonus for a perfect run (cards tapped in the correct order)', () => {
    storyInit();
    storyStart();

    cardsInRenderedOrder().forEach(card => card.click());

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('historia', 3);
    expect(addSeeds).toHaveBeenCalledWith(6);
    expect(document.getElementById('storyFeedback').className).toContain('good');
  });

  it('gives no seed bonus for a partial run, even though it still awards stars and ends the session', () => {
    storyInit();
    storyStart();

    // Swapping the first two taps (then finishing the rest in order) leaves
    // exactly 2 of the 4 slots correct - a straight permutation of 4 distinct
    // cards can never land on exactly 3/4 (fixing n-1 of n slots forces the
    // last one to fix too), so this is the partial-credit case to test, not
    // a full miss.
    cardsInRenderedOrder()[1].click();
    cardsInRenderedOrder()[0].click();
    cardsInRenderedOrder()[2].click();
    cardsInRenderedOrder()[3].click();

    expect(session.sessionCompleted).toBe(true);
    expect(setStars).toHaveBeenCalledWith('historia', 1); // ratio 2/4=0.5 -> below the 0.6 threshold for 2 stars
    expect(addSeeds).not.toHaveBeenCalled();
    expect(document.getElementById('storyFeedback').className).toContain('gentle');
  });

  it('replays the same story after an imperfect attempt instead of picking a new one', () => {
    storyInit();
    storyStart();
    const firstTitle = document.getElementById('storyInstructions').textContent;

    cardsInRenderedOrder()[1].click(); // wrong slot -> imperfect run
    cardsInRenderedOrder()[0].click();
    cardsInRenderedOrder()[2].click();
    cardsInRenderedOrder()[3].click();

    storyStart(); // retry
    expect(document.getElementById('storyInstructions').textContent).toBe(firstTitle);
  });
});
