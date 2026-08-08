// GAME 2: TRILHA DA KAPI ("Memória da Kapi") - repeat a growing sequence of
// lit footprint pads, training working memory. Imports session-state.js,
// game-shared.js, lib/i18n.js and lib/game-progress.js - never app.js, so
// app.js can import this module (to wire simonStart into the onclick handler
// in index.html) without a circular dependency.
import { session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';

let simon = { sequence:[], input:[], level:1, playing:false, cfg:null, locked:false };

export function simonInit(){
  const t = L();
  document.getElementById('memTitle').textContent = t.mem.title;
  setInstructions('memInstructions', t.mem.instr, true);
  document.getElementById('memStartBtn').textContent = t.startBtn;
  document.getElementById('memPreStart').style.display = 'flex';
  document.getElementById('memPlayArea').style.display = 'none';
  hideFeedback('simonFeedback');
  renderDiffRow('memDiffRow', 'memoria');
}
export function simonStart(){
  simon.cfg = DIFF.memoria[getDifficulty('memoria')];
  document.getElementById('memPreStart').style.display = 'none';
  document.getElementById('memPlayArea').style.display = 'flex';
  simon.sequence = Array.from({length: simon.cfg.startLen}, ()=>Math.floor(Math.random()*4));
  simon.level = 1;
  simonPlaySequence();
}
function simonSetLocked(locked){
  document.querySelectorAll('.trail-pad').forEach(p=>p.classList.toggle('locked', locked));
}
function simonRenderFootprints(litCount){
  const el = document.getElementById('trailFootprints');
  el.innerHTML = '';
  for(let i=0;i<simon.sequence.length;i++){
    const span = document.createElement('span');
    span.textContent = '👣';
    if(i < litCount) span.classList.add('done');
    el.appendChild(span);
  }
}
function simonPlaySequence(){
  const t = L();
  simon.playing = true; simon.input = []; simon.locked = false;
  document.getElementById('simonLevel').textContent = t.mem.level(simon.level);
  hideFeedback('simonFeedback');
  simonRenderFootprints(0);
  simonSetLocked(true);
  let i = 0;
  const pads = document.querySelectorAll('.trail-pad');
  function step(){
    if(i>0) pads[simon.sequence[i-1]].classList.remove('lit');
    if(i >= simon.sequence.length){
      simon.playing = false;
      simonSetLocked(false);
      window.instructionEndedAt = Date.now();
      return;
    }
    pads[simon.sequence[i]].classList.add('lit');
    i++;
    setTimeout(step, simon.cfg.stepDelay);
  }
  setTimeout(step, 500);
}
function simonInput(padIndex){
  if(simon.playing || simon.locked) {
    if (simon.playing) logGameEvent({ eventType: 'premature_click' });
    return;
  }
  if(simon.input.length >= simon.sequence.length) return;
  const rt = Date.now() - (window.instructionEndedAt || Date.now());
  window.instructionEndedAt = Date.now(); // reset timer for next input in sequence
  simon.locked = true;
  setTimeout(()=>{ simon.locked = false; }, 280);
  const t = L();
  const pads = document.querySelectorAll('.trail-pad');
  pads[padIndex].classList.add('lit');
  setTimeout(()=>pads[padIndex].classList.remove('lit'), 250);
  simon.input.push(padIndex);
  const idx = simon.input.length - 1;
  const isCorrect = simon.input[idx] === simon.sequence[idx];
  let errorType = null;
  if (!isCorrect && rt < 400) errorType = 'impulsiva';
  logGameEvent({ eventType: 'answer', targetType: 'sequence', target: simon.sequence.join(''), responseValue: simon.input.join(''), correct: isCorrect, responseTimeMs: rt, errorType });

  if(!isCorrect){
    simon.playing = true;
    showFeedback('simonFeedback', t.mem.wrong, false);
    const stars = simon.level-1 >= Math.ceil(simon.cfg.maxLevel*0.7) ? 3 : simon.level-1 >= Math.ceil(simon.cfg.maxLevel*0.4) ? 2 : simon.level-1>=1?1:0;
    setStars('memoria', stars);
    setTimeout(()=>simonPlaySequence(), 1400);
    return;
  }
  simonRenderFootprints(simon.input.length);
  if(simon.input.length === simon.sequence.length){
    simon.playing = true;
    if(simon.level >= simon.cfg.maxLevel){
      session.sessionCompleted = true;
      logGameEvent({ eventType: 'activity_complete' });
      showFeedback('simonFeedback', t.mem.mastery, true);
      setStars('memoria', 3); addSeeds(10); say(t.mascotGood);
      return;
    }
    showFeedback('simonFeedback', t.mem.next, true);
    addSeeds(2);
    simon.level++;
    simon.sequence.push(Math.floor(Math.random()*4));
    setTimeout(()=>simonPlaySequence(), 1200);
  }
}
document.getElementById('simonGrid').addEventListener('pointerdown', function(e){
  if(!e.isPrimary) return; // ignore incidental secondary touches (palm/other finger) so they can't hijack the sequence
  const pad = e.target.closest('.trail-pad');
  if(!pad) return;
  e.preventDefault();
  simonInput(Number(pad.dataset.i));
});
