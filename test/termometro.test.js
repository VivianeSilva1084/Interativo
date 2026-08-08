import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/game-progress.js', () => ({
  DIFF: { termometro: { facil: { rounds: 2 }, medio: { rounds: 2 }, dificil: { rounds: 2 } } },
  setStars: vi.fn(),
  addSeeds: vi.fn(),
  renderDiffRow: vi.fn(),
}));

import { thermoInit, thermoStart } from '../src/games/termometro.js';
import { setStars, addSeeds } from '../src/lib/game-progress.js';
import { state, session } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="thermoTitle"></div>
    <div id="thermoInstructions"></div>
    <button id="thermoStartBtn"></button>
    <div id="thermoPreStart"></div>
    <div id="thermoPlayArea"></div>
    <div id="thermoFeedback" class="feedback-banner"></div>
    <div id="thermoProgress"></div>
    <div id="scenarioBox"></div>
    <div id="thermoStep1"></div>
    <div id="thermoStep2"></div>
    <div id="thermoStep1Label"></div>
    <div id="thermoStep2Label"></div>
    <div id="emoOptions"></div>
    <div id="calmOptions"></div>
    <div id="mascotSpeech"></div>
  `;
}

function pickFirst(containerId){
  document.querySelector(`#${containerId} .emo-btn`).click();
}

describe('termometro (Termômetro das Emoções) game', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    buildDom();
    state.lang = 'pt';
    state.profile = { difficultyByGame: { termometro: 'medio' }, starsByGame: {} };
    session.sessionCompleted = false;
    setStars.mockClear();
    addSeeds.mockClear();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // keeps the scenario-shuffle order stable
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('awards 5 seeds per round and 3 stars at the end, across both configured rounds', () => {
    thermoInit();
    thermoStart(); // 2 rounds configured above

    pickFirst('emoOptions'); // round 1: pick a feeling
    vi.advanceTimersByTime(500); // -> reveals the calming-strategy step
    pickFirst('calmOptions'); // round 1: pick a strategy
    expect(addSeeds).toHaveBeenCalledWith(5);
    vi.advanceTimersByTime(2200); // non-last-round delay -> advances to round 2

    expect(document.getElementById('thermoProgress').textContent).toContain('2');

    pickFirst('emoOptions'); // round 2: pick a feeling
    vi.advanceTimersByTime(500);
    pickFirst('calmOptions'); // round 2 (the last one): pick a strategy
    vi.advanceTimersByTime(1800); // last-round delay

    expect(addSeeds).toHaveBeenCalledTimes(2);
    expect(setStars).toHaveBeenCalledWith('termometro', 3);
    expect(session.sessionCompleted).toBe(true);
  });

  it('shows the breathing-circle extra only for the "breathe" calming strategy', () => {
    thermoInit();
    thermoStart();
    pickFirst('emoOptions');
    vi.advanceTimersByTime(500);

    const breatheBtn = [...document.querySelectorAll('#calmOptions .emo-btn')].find(b => b.textContent.includes('Respirar fundo'));
    breatheBtn.click();

    expect(document.getElementById('thermoFeedback').innerHTML).toContain('breathe-circle');
  });
});
