// GAME 1: SEMÁFORO ("Luz da Espera") - waits for a green light before
// tapping, training impulse control. Imports session-state.js, game-shared.js,
// lib/i18n.js and lib/game-progress.js - never app.js, so app.js can import
// this module (to wire semStart/semTap into the onclick handlers in
// index.html) without a circular dependency.
import { session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';

let sem = { round:0, hits:0, total:5, canGo:false, cfg:null };

export function semInit(){
  const t = L();
  document.getElementById('semTitle').textContent = t.sem.title;
  setInstructions('semInstructions', t.sem.instr, true);
  document.getElementById('semStartBtn').textContent = t.startBtn;
  document.getElementById('semPreStart').style.display = 'flex';
  document.getElementById('semPlayArea').style.display = 'none';
  hideFeedback('semFeedback');
  renderDiffRow('semDiffRow', 'semaforo');
}
export function semStart(){
  const t = L();
  sem.cfg = DIFF.semaforo[getDifficulty('semaforo')];
  sem.round = 0; sem.hits = 0; sem.total = sem.cfg.rounds; sem.canGo = false;
  document.getElementById('semPreStart').style.display = 'none';
  document.getElementById('semPlayArea').style.display = 'flex';
  document.getElementById('semRounds').innerHTML = Array.from({length:sem.total}).map(()=>'<div class="round-dot"></div>').join('');
  semNextRound();
}
function semNextRound(){
  clearTimeout(window._semTimer);
  const t = L();
  const light = document.getElementById('semLight');
  if(sem.round >= sem.total){ semEnd(); return; }
  light.className = 'light-circle wait'; light.textContent = t.sem.wait; sem.canGo = false;
  const waitTime = sem.cfg.waitMin + Math.random()*(sem.cfg.waitMax - sem.cfg.waitMin);
  window._semTimer = setTimeout(()=>{
    light.className = 'light-circle go'; light.textContent = t.sem.go; sem.canGo = true;
    window.instructionEndedAt = Date.now();
    window._semTimer = setTimeout(()=>{
      if(sem.canGo){
        sem.canGo = false;
        logGameEvent({ eventType: 'answer', targetType: 'light', correct: false, errorType: 'omissao' });
        markRound(false);
      }
    }, sem.cfg.greenMs);
  }, waitTime);
}
export function semTap(){
  if(sem.round >= sem.total) return;
  if(sem.canGo){
    const rt = Date.now() - window.instructionEndedAt;
    sem.canGo = false;
    logGameEvent({ eventType: 'answer', targetType: 'light', correct: true, responseTimeMs: rt });
    markRound(true);
  }
  else {
    logGameEvent({ eventType: 'premature_click', targetType: 'light' });
    showFeedback('semFeedback', L().sem.early, false); setTimeout(()=>hideFeedback('semFeedback'), 1100);
  }
}
function markRound(hit){
  clearTimeout(window._semTimer);
  const t = L();
  const dots = document.querySelectorAll('#semRounds .round-dot');
  dots[sem.round].classList.add(hit?'hit':'miss');
  if(hit){ sem.hits++; showFeedback('semFeedback', t.sem.hit, true); } else { showFeedback('semFeedback', t.sem.miss, false); }
  sem.round++;
  setTimeout(()=>{ hideFeedback('semFeedback'); semNextRound(); }, 900);
}
function semEnd(){
  session.sessionCompleted = true;
  logGameEvent({ eventType: 'activity_complete' });
  const t = L();
  const light = document.getElementById('semLight');
  light.className = 'light-circle go'; light.textContent = '🎉';
  const ratio = sem.hits / sem.total;
  const stars = ratio>=0.9?3: ratio>=0.5?2: ratio>0?1:0;
  setStars('semaforo', stars);
  addSeeds(sem.hits*2);
  showFeedback('semFeedback', `${t.sem.result(sem.hits, sem.total)} ${'⭐'.repeat(stars)}`, true);
  say(stars>=2 ? t.mascotGood : t.mascotTry);
}
