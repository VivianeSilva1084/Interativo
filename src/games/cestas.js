// GAME 7: CESTAS DA ILHA ("Cestas da Ilha") - Torre de Londres adaptada:
// mover frutas entre 3 cestas de capacidade limitada até bater com a meta
// (sempre visível). Toque simples (origem → destino), sem drag-and-drop, sem
// timer, sem tela de fracasso - ao bater o teto de movimentos sem resolver, o
// tabuleiro reseta sozinho pro mesmo problema em vez de encerrar a sessão.
// Imports session-state.js, game-shared.js, lib/i18n.js, lib/game-progress.js
// e cestas-logic.js (BFS/geração de round, sem DOM, testável em isolado) -
// nunca app.js, mesmo motivo dos outros jogos (evitar import circular).
import { state, session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';
import { cloneState, statesEqual, stateKey, bfsDistancesFromGoal, generateInitialState, computeStars, moveCap } from './cestas-logic.js';

// Banco de metas por dificuldade - fácil tem só 1 meta de propósito (reforça
// "sucesso garantido" na primeira experiência com o jogo, reduz variação).
const GOAL_BANK = {
  facil:   [ [['🍎'], ['🍌']] ],
  medio:   [ [['🍎', '🍌'], ['🍇'], []], [['🍇'], ['🍎'], ['🍌']] ],
  dificil: [ [['🍎', '🍌', '🍇'], ['🍊'], []], [['🍎'], ['🍌', '🍇'], ['🍊']] ],
};

let cestas = {
  goal: null, initial: null, current: null, distanceMap: null,
  minMoves: 1, cap: 1, movesUsed: 0, capacities: [], difficulty: 'medio',
  selectedBasket: null, roundStartedAt: 0, lastActionAt: 0, firstTapLogged: false,
  reachedGoalLastAttempt: true,
};

export function cestasInit(){
  const t = L();
  document.getElementById('cestasTitle').textContent = t.cestas.title;
  setInstructions('cestasInstructions', t.cestas.instr, true);
  document.getElementById('cestasStartBtn').textContent = t.startBtn;
  document.getElementById('cestasGoalLabel').textContent = t.cestas.goalLabel;
  document.getElementById('cestasBoardLabel').textContent = t.cestas.boardLabel;
  document.getElementById('cestasRestartBtn').textContent = t.cestas.restartBtn;
  document.getElementById('cestasPreStart').style.display = 'flex';
  document.getElementById('cestasPlayArea').style.display = 'none';
  hideFeedback('cestasFeedback');
  renderDiffRow('cestasDiffRow', 'cestas');
}

export function cestasStart(){
  const level = getDifficulty('cestas');
  const cfg = DIFF.cestas[level];

  if(cestas.reachedGoalLastAttempt || !cestas.goal || level !== cestas.difficulty){
    const bank = GOAL_BANK[level];
    const goal = bank[Math.floor(Math.random() * bank.length)];
    cestas.goal = cloneState(goal);
    cestas.difficulty = level;
    cestas.capacities = cfg.capacities;
    cestas.distanceMap = bfsDistancesFromGoal(cestas.goal, cfg.capacities);
    let initial, minMoves;
    for(let attempt = 0; attempt < 10; attempt++){
      initial = generateInitialState(cestas.goal, cfg.capacities, cfg.genMoves);
      minMoves = cestas.distanceMap.get(stateKey(initial));
      if(minMoves > 0) break;
    }
    cestas.initial = initial;
    cestas.minMoves = minMoves || 1;
  }
  cestas.cap = moveCap(cestas.minMoves);
  cestas.current = cloneState(cestas.initial);
  cestas.movesUsed = 0;
  cestas.selectedBasket = null;
  cestas.firstTapLogged = false;
  cestas.roundStartedAt = Date.now();
  cestas.lastActionAt = cestas.roundStartedAt;

  document.getElementById('cestasPreStart').style.display = 'none';
  document.getElementById('cestasPlayArea').style.display = 'flex';
  hideFeedback('cestasFeedback');
  renderGoalBoard();
  renderCurrentBoard();
}

export function cestasRestart(){
  logGameEvent({ eventType: 'retry', target: 'voluntary' });
  hideFeedback('cestasFeedback');
  cestas.current = cloneState(cestas.initial);
  cestas.movesUsed = 0;
  cestas.selectedBasket = null;
  cestas.lastActionAt = Date.now();
  renderCurrentBoard();
}

function renderGoalBoard(){
  renderBoard('cestasGoalBoard', cestas.goal, null);
}
function renderCurrentBoard(){
  renderBoard('cestasBoard', cestas.current, cestasPickBasket);
}
// Fruta do topo (movível) aparece primeiro na exibição, pra ficar claro qual
// é a interativa. onPick=null renderiza a meta (não-clicável, sem seleção).
function renderBoard(containerId, boardState, onPick){
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = '';
  boardState.forEach((basket, idx) => {
    const el = document.createElement(onPick ? 'button' : 'div');
    el.className = 'emo-btn' + (onPick && cestas.selectedBasket === idx ? ' selected' : '');
    const fruitsDisplay = basket.length ? [...basket].reverse().join('') : '·';
    el.innerHTML = `<span class="e">${fruitsDisplay}</span>${basket.length}/${cestas.capacities[idx]}`;
    if(onPick) el.onclick = () => onPick(idx);
    wrap.appendChild(el);
  });
}

function cestasPickBasket(idx){
  if(!cestas.firstTapLogged){
    logGameEvent({ eventType: 'answer', targetType: 'move', target: 'deliberation', responseTimeMs: Date.now() - cestas.roundStartedAt });
    cestas.firstTapLogged = true;
  }
  if(cestas.selectedBasket === null){
    if(cestas.current[idx].length === 0) return; // cesta vazia não pode ser origem - no-op silencioso
    cestas.selectedBasket = idx;
    renderCurrentBoard();
    return;
  }
  if(cestas.selectedBasket === idx){
    cestas.selectedBasket = null; // mudou de ideia - permitido sem penalidade
    renderCurrentBoard();
    return;
  }
  if(cestas.current[idx].length >= cestas.capacities[idx]){
    cestas.selectedBasket = null; // cesta destino cheia - no-op silencioso, nunca mensagem negativa
    renderCurrentBoard();
    return;
  }
  commitMove(cestas.selectedBasket, idx);
}

function commitMove(from, to){
  const beforeDist = cestas.distanceMap.get(stateKey(cestas.current));
  const next = cloneState(cestas.current);
  next[to].push(next[from].pop());
  const afterDist = cestas.distanceMap.has(stateKey(next)) ? cestas.distanceMap.get(stateKey(next)) : beforeDist;
  const wasHelpful = afterDist < beforeDist;
  const rt = Date.now() - cestas.lastActionAt;
  cestas.lastActionAt = Date.now();
  logGameEvent({ eventType: 'answer', targetType: 'move', target: String(from), responseValue: String(to), correct: wasHelpful, responseTimeMs: rt });

  cestas.current = next;
  cestas.movesUsed++;
  cestas.selectedBasket = null;
  renderCurrentBoard();

  if(statesEqual(cestas.current, cestas.goal)) handleGoalReached();
  else if(cestas.movesUsed >= cestas.cap) handleCapReached();
}

function handleGoalReached(){
  const t = L();
  const stars = computeStars(cestas.minMoves, cestas.movesUsed);
  setStars('cestas', stars);
  addSeeds(stars === 3 ? 8 : stars === 2 ? 6 : 4);
  cestas.reachedGoalLastAttempt = true;
  session.sessionCompleted = true;
  logGameEvent({ eventType: 'activity_complete', target: JSON.stringify({ minMoves: cestas.minMoves, movesUsed: cestas.movesUsed }) });
  const msg = stars === 3 ? t.cestas.resultGood : stars === 2 ? t.cestas.resultOk : t.cestas.resultTry;
  showFeedback('cestasFeedback', msg, true);
  say(t.mascotGood);
}

// Bateu o teto de movimentos sem alcançar a meta: nunca encerra a sessão nem
// mostra tela de fracasso - Kapi sugere tentar de outro jeito e o tabuleiro
// volta sozinho pro estado inicial do MESMO problema, sem exigir clique da
// criança. cestasStart() (se chamado de novo depois, ex: saiu e voltou à
// tela) também reusa este problema, via reachedGoalLastAttempt=false.
function handleCapReached(){
  const t = L();
  cestas.reachedGoalLastAttempt = false;
  logGameEvent({ eventType: 'answer', targetType: 'move', target: 'cap_reached' });
  showFeedback('cestasFeedback', t.cestas.replanMsg, false);
  say(t.mascotTry);
  setTimeout(() => {
    hideFeedback('cestasFeedback');
    cestas.current = cloneState(cestas.initial);
    cestas.movesUsed = 0;
    cestas.selectedBasket = null;
    cestas.lastActionAt = Date.now();
    renderCurrentBoard();
  }, 2200);
}
