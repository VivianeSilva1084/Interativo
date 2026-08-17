// GAME 8: QUANTOS COCOS? - a criança toca na pilha de cocos que tem MAIS,
// treinando senso numérico (subitizing + comparação de magnitude não-
// simbólica) sem exigir contagem ou cálculo. Nível fácil usa arranjos fixos
// tipo padrão de dado com razão bem distante entre as pilhas (sucesso
// garantido); médio/difícil espalham os cocos e aproximam a razão. Sem
// timer como mecânica de sucesso/fracasso - responseTimeMs é só telemetria
// passiva. Imports session-state.js, game-shared.js, lib/i18n.js,
// lib/game-progress.js e cocos-logic.js (geração de rodada, sem DOM,
// testável em isolado) - nunca app.js, mesmo motivo dos outros jogos (evitar
// import circular).
import { session, getDifficulty } from '../lib/session-state.js';
import { setInstructions, hideFeedback, showFeedback, logGameEvent, say } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { DIFF, setStars, addSeeds, renderDiffRow } from '../lib/game-progress.js';
import { canonicalPositions, scatterPositions, generateRoundPair } from './cocos-logic.js';

let cocos = { round: 0, hits: 0, total: 6, cfg: null, pair: null, roundStartedAt: 0, answered: false };

export function cocosInit() {
  const t = L();
  document.getElementById('cocosTitle').textContent = t.cocos.title;
  setInstructions('cocosInstructions', t.cocos.instr, true);
  document.getElementById('cocosStartBtn').textContent = t.startBtn;
  document.getElementById('cocosPreStart').style.display = 'flex';
  document.getElementById('cocosPlayArea').style.display = 'none';
  hideFeedback('cocosFeedback');
  renderDiffRow('cocosDiffRow', 'cocos');
}

export function cocosStart() {
  const level = getDifficulty('cocos');
  cocos.cfg = DIFF.cocos[level];
  cocos.round = 0;
  cocos.hits = 0;
  cocos.total = cocos.cfg.rounds;
  document.getElementById('cocosPreStart').style.display = 'none';
  document.getElementById('cocosPlayArea').style.display = 'flex';
  document.getElementById('cocosRounds').innerHTML = Array.from({ length: cocos.total }).map(() => '<div class="round-dot"></div>').join('');
  hideFeedback('cocosFeedback');
  cocosNextRound();
}

function renderPile(containerId, qty, canonical) {
  const el = document.getElementById(containerId);
  const positions = canonical ? canonicalPositions(qty) : scatterPositions(qty);
  el.innerHTML = positions.map(p => `<span class="cocos-coco" style="left:${p.x}%;top:${p.y}%;">🥥</span>`).join('');
}

function cocosNextRound() {
  if (cocos.round >= cocos.total) { cocosEnd(); return; }
  cocos.pair = generateRoundPair(cocos.cfg.maxQty, cocos.cfg.minRatio);
  cocos.answered = false;
  renderPile('cocosLeftPile', cocos.pair.left, cocos.cfg.canonical);
  renderPile('cocosRightPile', cocos.pair.right, cocos.cfg.canonical);
  cocos.roundStartedAt = Date.now();
}

export function cocosPick(side) {
  if (cocos.round >= cocos.total || cocos.answered) return;
  cocos.answered = true;
  const t = L();
  const correctSide = cocos.pair.left > cocos.pair.right ? 'left' : 'right';
  const hit = side === correctSide;
  const rt = Date.now() - cocos.roundStartedAt;
  logGameEvent({ eventType: 'answer', targetType: 'quantity', target: JSON.stringify({ left: cocos.pair.left, right: cocos.pair.right }), correct: hit, responseTimeMs: rt });
  const dots = document.querySelectorAll('#cocosRounds .round-dot');
  dots[cocos.round].classList.add(hit ? 'hit' : 'miss');
  if (hit) cocos.hits++;
  showFeedback('cocosFeedback', hit ? t.cocos.hit : t.cocos.miss, hit);
  cocos.round++;
  setTimeout(() => { hideFeedback('cocosFeedback'); cocosNextRound(); }, 900);
}

function cocosEnd() {
  session.sessionCompleted = true;
  logGameEvent({ eventType: 'activity_complete' });
  const t = L();
  const ratio = cocos.hits / cocos.total;
  const stars = ratio >= 0.9 ? 3 : ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0;
  setStars('cocos', stars);
  addSeeds(cocos.hits * 2);
  showFeedback('cocosFeedback', `${t.cocos.result(cocos.hits, cocos.total)} ${'⭐'.repeat(stars)}`, true);
  say(stars >= 2 ? t.mascotGood : t.mascotTry);
}
