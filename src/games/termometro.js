// GAME 6: TERMÔMETRO ("Termômetro das Emoções") - read a social scenario,
// pick the feeling it'd bring up, then a calming strategy, training emotional
// regulation. Imports session-state.js, game-shared.js, lib/i18n.js and
// lib/game-progress.js - never app.js, so app.js can import this module (to
// wire thermoStart into the onclick handler in index.html) without a
// circular dependency. SCENARIOS/EMOTIONS/CALM_STRATS are content data used
// only by this game, so they live here rather than in a shared module.
import { state, session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say, makeTtsBtn, makeTtsIcon } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';

const SCENARIOS = {
  pt: [
    "Você estava jogando e perdeu bem no finalzinho.",
    "Um amigo pegou seu brinquedo sem perguntar.",
    "Você tentou fazer uma tarefa difícil e não conseguiu na primeira vez.",
    "Você ganhou um elogio da professora na frente da turma.",
    "Você esperou muito tempo na fila e ainda não chegou sua vez.",
    "Seu amigo não quis brincar com você no recreio hoje."
  ],
  it: [
    "Stavi giocando e hai perso proprio alla fine.",
    "Un amico ha preso il tuo giocattolo senza chiedere.",
    "Hai provato a fare un compito difficile e non ce l'hai fatta al primo tentativo.",
    "Hai ricevuto un complimento dalla maestra davanti a tutta la classe.",
    "Hai aspettato tanto in fila e non è ancora arrivato il tuo turno.",
    "Il tuo amico oggi non ha voluto giocare con te in ricreazione."
  ]
};

const EMOTIONS = {
  pt: [ {e:'😠',label:'Bravo'}, {e:'😢',label:'Triste'}, {e:'😳',label:'Frustrado'}, {e:'😄',label:'Feliz'}, {e:'😰',label:'Ansioso'} ],
  it: [ {e:'😠',label:'Arrabbiato'}, {e:'😢',label:'Triste'}, {e:'😳',label:'Frustrato'}, {e:'😄',label:'Felice'}, {e:'😰',label:'Ansioso'} ]
};
const CALM_STRATS = {
  pt: [ {id:'breathe', e:'🫁', label:'Respirar fundo'}, {id:'count', e:'🔢', label:'Contar até 10'}, {id:'hug', e:'🤗', label:'Pedir um abraço'}, {id:'water', e:'💧', label:'Beber água'} ],
  it: [ {id:'breathe', e:'🫁', label:'Respirare profondamente'}, {id:'count', e:'🔢', label:'Contare fino a 10'}, {id:'hug', e:'🤗', label:'Chiedere un abbraccio'}, {id:'water', e:'💧', label:'Bere acqua'} ]
};

function setThermoStepLabel(id, text){
  const el = document.getElementById(id);
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  el.appendChild(makeTtsBtn(text));
}

let thermo = { rounds:[], step:0, emo:null, total:0 };
export function thermoInit(){
  const t = L();
  document.getElementById('thermoTitle').textContent = t.thermo.title;
  setInstructions('thermoInstructions', t.thermo.instr, true);
  document.getElementById('thermoStartBtn').textContent = t.startBtn;
  document.getElementById('thermoPreStart').style.display = 'flex';
  document.getElementById('thermoPlayArea').style.display = 'none';
  hideFeedback('thermoFeedback');
  renderDiffRow('thermoDiffRow', 'termometro');
}
export function thermoStart(){
  const cfg = DIFF.termometro[getDifficulty('termometro')];
  const pool = [...SCENARIOS[state.lang]].sort(()=>Math.random()-0.5);
  thermo.rounds = pool.slice(0, cfg.rounds);
  thermo.total = thermo.rounds.length;
  thermo.step = 0;
  document.getElementById('thermoPreStart').style.display = 'none';
  document.getElementById('thermoPlayArea').style.display = 'flex';
  thermoRenderRound();
}
function thermoRenderRound(){
  const t = L();
  if(thermo.step >= thermo.rounds.length){
    session.sessionCompleted = true;
    logGameEvent({ eventType: 'activity_complete' });
    setStars('termometro', 3); say(t.mascotGood);
    return;
  }
  document.getElementById('thermoProgress').textContent = t.thermo.progress(thermo.step+1, thermo.total);
  setInstructions('scenarioBox', thermo.rounds[thermo.step]);
  document.getElementById('thermoStep1').style.display = 'block';
  document.getElementById('thermoStep2').style.display = 'none';
  setThermoStepLabel('thermoStep1Label', t.thermo.step1);
  document.getElementById('thermoStep2Label').textContent = t.thermo.step2;
  hideFeedback('thermoFeedback');
  const emoWrap = document.getElementById('emoOptions');
  emoWrap.innerHTML = '';
  EMOTIONS[state.lang].forEach(opt=>{
    const btn = document.createElement('button');
    btn.className = 'emo-btn';
    btn.innerHTML = `<span class="e">${opt.e}</span>${opt.label}`;
    btn.onclick = ()=>{
      const rt = Date.now() - (window.instructionEndedAt || Date.now());
      logGameEvent({ eventType: 'answer', targetType: 'emotion', target: thermo.rounds[thermo.step], responseValue: opt.label, responseTimeMs: rt });
      logGameEvent({ eventType: 'emotion_check', emotion: opt.label, context: 'scenario' });
      document.querySelectorAll('.emo-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      thermo.emo = opt.label;
      setTimeout(thermoStep2, 500);
    };
    emoWrap.appendChild(btn);
  });
  window.instructionEndedAt = Date.now();
}
function thermoStep2(){
  document.getElementById('thermoStep1').style.display = 'none';
  document.getElementById('thermoStep2').style.display = 'block';
  const calmWrap = document.getElementById('calmOptions');
  calmWrap.innerHTML = '';
  CALM_STRATS[state.lang].forEach(opt=>{
    const btn = document.createElement('button');
    btn.className = 'emo-btn';
    btn.innerHTML = `<span class="e">${opt.e}</span>${opt.label}`;
    btn.onclick = ()=>thermoPickCalm(opt, btn);
    btn.appendChild(makeTtsIcon(opt.label));
    calmWrap.appendChild(btn);
  });
  window.instructionEndedAt = Date.now();
}
function thermoPickCalm(opt, btn){
  const rt = Date.now() - (window.instructionEndedAt || Date.now());
  logGameEvent({ eventType: 'answer', targetType: 'strategy', responseValue: opt.label, responseTimeMs: rt });
  const t = L();
  document.querySelectorAll('#calmOptions .emo-btn').forEach(b=>b.style.pointerEvents='none');
  btn.classList.add('selected');
  let extra = '';
  if(opt.id === 'breathe'){
    extra = `<div class="breathe-circle"></div><p style="font-size:13px;color:var(--lilac);font-weight:700;">${t.thermo.breathing}</p>`;
  }
  showFeedback('thermoFeedback', t.thermo.feedback(thermo.emo, opt.label) + extra, true);
  addSeeds(5);
  const isLast = thermo.step >= thermo.rounds.length - 1;
  setTimeout(()=>{
    thermo.step++;
    if(isLast){
      const stars = 3;
      setStars('termometro', stars);
      say(t.mascotGood);
    } else {
      thermoRenderRound();
    }
  }, isLast ? 1800 : 2200);
}
