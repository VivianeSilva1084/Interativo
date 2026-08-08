// GAME 5: CAÇA AO ALVO - find every target emoji in a grid before time runs
// out (or, in "sem pressa" mode, with no timer at all), training sustained
// attention; the medio/dificil difficulties add a mid-round target swap that
// feeds the "Flexibilidade cognitiva" clinical report. Imports
// session-state.js, game-shared.js, lib/i18n.js and lib/game-progress.js -
// never app.js, so app.js can import this module (to wire huntInit/huntStart/
// huntShowPreStart/huntTogglePace into the onclick handlers in index.html)
// without a circular dependency.
import { session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say, playTone, hapticFeedback } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';

let hunt = { found:0, target:6, timeLeft:20, timerId:null, cfg:null, diffKey:'medio',
  switchEnabled:false, switchAtFound:0, switched:false, activeTarget:'🍀', newTarget:null, graceUntil:0, paused:false,
  untimed:false, timeUp:false };
function huntRenderPaceToggle(){
  const t = L();
  const btn = document.getElementById('huntPaceToggle');
  btn.textContent = hunt.untimed ? t.hunt.timedOff : t.hunt.timedOn;
  btn.classList.toggle('untimed', hunt.untimed);
}
export function huntTogglePace(){
  hunt.untimed = !hunt.untimed;
  huntRenderPaceToggle();
}
export function huntInit(){
  const t = L();
  document.getElementById('huntTitle').textContent = t.hunt.title;
  setInstructions('huntInstructions', t.hunt.instr, true);
  document.getElementById('huntStartBtn').textContent = t.startBtn;
  document.getElementById('huntAgainBtn').textContent = t.playAgainBtn;
  document.getElementById('huntPreStart').style.display = 'flex';
  document.getElementById('huntPlayArea').style.display = 'none';
  document.getElementById('huntAgainBtn').style.display = 'none';
  document.getElementById('huntTargetChip').style.display = 'none';
  document.getElementById('huntRuleCue').classList.remove('show');
  hideFeedback('huntFeedback');
  clearInterval(hunt.timerId);
  hunt.paused = false;
  renderDiffRow('huntDiffRow', 'cacaalvo');
  huntRenderPaceToggle();
}
export function huntShowPreStart(){
  document.getElementById('huntPlayArea').style.display = 'none';
  document.getElementById('huntPreStart').style.display = 'flex';
}
function buildHuntGrid(active){
  const cfg = hunt.cfg;
  const totalCells = cfg.cols * cfg.rows;
  // When the round includes a target swap, cells for the new target are
  // reserved up front too - exactly (target - switchAtFound) of them, the
  // same way the original target count is reserved, so the second half of
  // the round is always completable regardless of the random distractor fill.
  const remainingAfterSwitch = hunt.switchEnabled ? (hunt.target - hunt.switchAtFound) : 0;
  let cells = [];
  for(let i=0;i<cfg.targets;i++) cells.push('🍀');
  for(let i=0;i<remainingAfterSwitch;i++) cells.push(hunt.newTarget);
  const fillPool = hunt.switchEnabled ? cfg.pool.filter(e=>e!==hunt.newTarget) : cfg.pool;
  for(let i=0;i<totalCells - cells.length;i++) cells.push(fillPool[Math.floor(Math.random()*fillPool.length)]);
  cells = cells.sort(()=>Math.random()-0.5);
  const grid = document.getElementById('huntGrid');
  grid.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;
  grid.innerHTML = '';
  cells.forEach(emoji=>{
    const cell = document.createElement('div');
    cell.className = 'hunt-cell';
    cell.textContent = active ? emoji : '❔';
    cell.dataset.emoji = emoji;
    cell.onclick = ()=> active && huntClick(cell);
    grid.appendChild(cell);
  });
}
export function huntStart(){
  const t = L();
  const diffKey = getDifficulty('cacaalvo');
  hunt.cfg = DIFF.cacaalvo[diffKey];
  hunt.found = 0; hunt.target = hunt.cfg.targets; hunt.timeLeft = hunt.cfg.time; hunt.timeUp = false;
  hunt.activeTarget = '🍀'; hunt.switched = false; hunt.paused = false; hunt.graceUntil = 0;
  hunt.diffKey = diffKey;
  // Only medio/dificil get the mid-round target swap ("Flexibilidade cognitiva"
  // measurement) - facil stays a single fixed target, pure sustained attention.
  hunt.switchEnabled = diffKey !== 'facil';
  hunt.switchAtFound = hunt.switchEnabled ? Math.ceil(hunt.target/2) : 0;
  hunt.newTarget = hunt.switchEnabled ? hunt.cfg.pool[Math.floor(Math.random()*hunt.cfg.pool.length)] : null;
  document.getElementById('huntPreStart').style.display = 'none';
  document.getElementById('huntPlayArea').style.display = 'flex';
  document.getElementById('huntAgainBtn').style.display = 'none';
  document.getElementById('huntFoundCount').textContent = t.hunt.found(0, hunt.target);
  document.getElementById('huntTargetChip').style.display = 'none';
  document.getElementById('huntRuleCue').classList.remove('show');
  hideFeedback('huntFeedback');
  buildHuntGrid(true);
  window.instructionEndedAt = Date.now();
  clearInterval(hunt.timerId);
  // "Sem pressa" mode: no clock at all, sustained scanning without a threat
  // framing - see clinical review, a hard countdown trains speed under
  // pressure, not the sustained-attention construct this game is meant to build.
  const timerBar = document.getElementById('huntTimerBar');
  const timerBarWrap = document.getElementById('huntTimerBarWrap');
  const timeLeftEl = document.getElementById('huntTimeLeft');
  timerBar.classList.remove('calm');
  if(hunt.untimed){
    timerBarWrap.style.display = 'none';
    timeLeftEl.style.display = 'none';
    return;
  }
  timerBarWrap.style.display = '';
  timeLeftEl.style.display = '';
  timeLeftEl.textContent = t.hunt.time(hunt.timeLeft);
  timerBar.style.width = '100%';
  hunt.timerId = setInterval(()=>{
    if(hunt.paused) return;
    hunt.timeLeft--;
    timeLeftEl.textContent = t.hunt.time(hunt.timeLeft);
    timerBar.style.width = (hunt.timeLeft/hunt.cfg.time*100) + '%';
    if(hunt.timeLeft<=0){
      if(hunt.diffKey === 'facil'){
        huntEnd(false);
      } else {
        // medio/dificil: the clock stops, but the round doesn't - finishing
        // late still counts (partial credit already exists via the star
        // ratio), so running out of time stops being a threat to react to.
        hunt.timeUp = true;
        clearInterval(hunt.timerId);
        timerBar.classList.add('calm');
        timerBar.style.width = '100%';
        timeLeftEl.textContent = t.hunt.timeUpFriendly;
      }
    }
  }, 1000);
}
function huntClick(cell){
  if(cell.classList.contains('found')) return;
  if(hunt.paused) return; // ignore taps while the "new target" cue is showing
  const emoji = cell.dataset.emoji;

  // Grace period right after a switch: a tap on the just-retired target is
  // still very likely the tail end of the pre-switch motor plan, not a real
  // perseverative error - forgiven silently (no log, no penalty) rather than
  // counted against the child. Genuine perseveration (after the grace window)
  // is still tracked below.
  if(hunt.switched && emoji === '🍀' && Date.now() < hunt.graceUntil){
    cell.style.transform = 'scale(0.9)';
    setTimeout(()=>cell.style.transform='', 150);
    return;
  }

  const rt = Date.now() - (window.instructionEndedAt || Date.now());
  window.instructionEndedAt = Date.now();
  const isTarget = emoji === hunt.activeTarget;
  let errorType = null;
  if(!isTarget){
    if(hunt.switched && emoji === '🍀') errorType = 'perseverativa';
    else if(rt < 300) errorType = 'impulsiva';
  }
  logGameEvent({ eventType: 'answer', targetType: 'grid', target: hunt.activeTarget, responseValue: emoji, correct: isTarget, responseTimeMs: rt, errorType });

  const t = L();
  playTone(isTarget ? 'correct' : 'wrong');
  hapticFeedback(isTarget ? 'correct' : 'wrong');
  if(isTarget){
    cell.classList.add('found');
    hunt.found++;
    document.getElementById('huntFoundCount').textContent = t.hunt.found(hunt.found, hunt.target);
    if(hunt.switchEnabled && !hunt.switched && hunt.found === hunt.switchAtFound){
      huntTriggerRuleChange();
      return;
    }
    if(hunt.found >= hunt.target) huntEnd(true);
  } else {
    cell.style.transform = 'scale(0.9)';
    setTimeout(()=>cell.style.transform='', 150);
  }
}
// Mid-round target swap that feeds the "Flexibilidade cognitiva" report
// (v_rule_adaptation / v_perseverative_errors) - see clinical review: cued
// (not silent) so the measurement is about shifting to the new rule, not
// about noticing it changed. Timer pauses during the cue; taps are ignored
// (hunt.paused) so the pause can't be gamed or unfairly cost a hit.
function huntTriggerRuleChange(){
  hunt.paused = true;
  logGameEvent({ eventType: 'rule_change' });
  const t = L();
  hunt.activeTarget = hunt.newTarget;
  hunt.switched = true;
  const chip = document.getElementById('huntTargetChip');
  chip.textContent = `🎯 ${hunt.newTarget}`;
  chip.style.display = 'inline-flex';
  document.getElementById('huntRuleCueEmoji').textContent = hunt.newTarget;
  document.getElementById('huntRuleCueText').textContent = t.hunt.newTargetCue;
  const cue = document.getElementById('huntRuleCue');
  cue.classList.add('show');
  setTimeout(()=>{
    cue.classList.remove('show');
    hunt.paused = false;
    hunt.graceUntil = Date.now() + 800;
    window.instructionEndedAt = Date.now();
  }, 1300);
}
function huntEnd(allFound){
  clearInterval(hunt.timerId);
  session.sessionCompleted = true;
  logGameEvent({ eventType: 'activity_complete' });
  const t = L();
  document.querySelectorAll('.hunt-cell').forEach(c=>c.onclick=null);
  const ratio = hunt.found/hunt.target;
  const stars = ratio===1?3: ratio>=0.5?2: ratio>0?1:0;
  setStars('cacaalvo', stars); addSeeds(hunt.found*2);
  // "Bora tentar de novo?" reads oddly with zero progress - a distinct,
  // still-gentle message for that edge case, framed around the skill
  // ("olhinho"/attention), never around the clock running out.
  const resultText = allFound ? t.hunt.resultAll : (hunt.found === 0 ? t.hunt.resultZero : t.hunt.resultPartial(hunt.found, hunt.target));
  showFeedback('huntFeedback', resultText, allFound);
  say(stars>=2 ? t.mascotGood : t.mascotTry);
  document.getElementById('huntAgainBtn').style.display = 'inline-block';
}
