// Hub/progress-adjacent helpers every game shares identically: difficulty
// tuning constants, the seeds/stars/difficulty mutations (each persisted via
// saveProfileData, a Supabase write), the difficulty-picker widget each
// game's pre-start screen renders, and the adaptive-difficulty check run
// when a game opens. Imports session-state.js, game-shared.js and i18n.js -
// never the other way around, so games can depend on this module without
// any risk of a circular import back into app.js (the composition root that
// dispatches into each game's *Init and therefore has to import them, not
// be imported by anything they depend on).
import { sb, state, session, getDifficulty } from './session-state.js';
import { showError } from './game-shared.js';
import { L } from './i18n.js';

export const DIFF = {
  semaforo:{ facil:{rounds:4, greenMs:2000, waitMin:1000, waitMax:2000}, medio:{rounds:5, greenMs:1400, waitMin:1200, waitMax:2800}, dificil:{rounds:7, greenMs:1000, waitMin:1500, waitMax:3200} },
  memoria:{ facil:{maxLevel:4, startLen:2, stepDelay:800}, medio:{maxLevel:6, startLen:2, stepDelay:700}, dificil:{maxLevel:8, startLen:3, stepDelay:550} },
  historia:{ facil:{len:3}, medio:{len:4}, dificil:{len:5} },
  minhavez:{ facil:{turns:2, hint:true}, medio:{turns:3, hint:false}, dificil:{turns:5, hint:false} },
  cacaalvo:{ facil:{cols:5, rows:5, targets:4, time:25, pool:['🍄','🌸','🪨','🐚']},
             medio:{cols:6, rows:5, targets:6, time:20, pool:['🍄','🌸','🍂','🪨','🐚','🍁','🌼','🍇']},
             dificil:{cols:7, rows:6, targets:8, time:18, pool:['🌿','🍃','☘️','🌱','🪴','🍂','🌸']} },
  termometro:{ facil:{rounds:2}, medio:{rounds:3}, dificil:{rounds:4} },
  // genMoves do fácil é 1, não 2: com 2 cestas/2 frutas o grafo de estados
  // alcançável a partir da meta tem diâmetro 1 (qualquer 2º passo volta pra
  // meta, sempre) - 2 passos daria minMoves=0 de forma determinística, não
  // aleatória. 1 passo garante minMoves=1, batendo com "resolvível em 1-2
  // movimentos" da spec e reforçando o sucesso garantido no nível fácil.
  cestas:{ facil:{fruits:2,capacities:[2,2],genMoves:1}, medio:{fruits:3,capacities:[3,2,1],genMoves:3}, dificil:{fruits:4,capacities:[3,3,2],genMoves:5} }
};
export const DIFF_LEVELS = ['facil','medio','dificil'];

export const GAME_KEYS = ['semaforo','memoria','historia','minhavez','cacaalvo','termometro','cestas'];

export function defaultProfileData(name, avatar, lang){
  const diffByGame = {}; GAME_KEYS.forEach(k=>diffByGame[k]='medio');
  const starsByGame = {}; GAME_KEYS.forEach(k=>starsByGame[k]=0);
  return { name, avatar, lang, seeds:0, starsByGame, difficultyByGame:diffByGame, unlockedStickers:[] };
}

export async function saveProfileData(){
  if(!state.profileId || !state.profile) return;
  try{
    const p = state.profile;
    const { error } = await sb.from('child_profiles').update({
      lang: p.lang,
      seeds: p.seeds,
      stars_by_game: p.starsByGame,
      difficulty_by_game: p.difficultyByGame,
      unlocked_stickers: p.unlockedStickers || []
    }).eq('id', state.profileId);
    if(error) throw error;
  }catch(e){
    showError('Erro ao salvar progresso. Verifique a conexão.');
  }
}

export function addSeeds(n){
  state.profile.seeds += n;
  document.getElementById('seedCount').textContent = state.profile.seeds;
  saveProfileData();
}
export function setStars(gameKey, count){
  state.profile.starsByGame[gameKey] = Math.max(state.profile.starsByGame[gameKey], count);
  saveProfileData();
  renderHubTileStars();
  session.sessionDirty[gameKey] = true;
}
export function setDifficulty(gameKey, level){
  state.profile.difficultyByGame[gameKey] = level;
  saveProfileData();
}

export function renderHubTileStars(){
  GAME_KEYS.forEach(k=>{
    const el = document.getElementById('stars-'+k);
    if(!el) return;
    const c = state.profile.starsByGame[k] || 0;
    el.textContent = '⭐'.repeat(c) + '☆'.repeat(Math.max(0,3-c));
  });
}

export function renderDiffRow(containerId, gameKey, onChange){
  const t = L();
  const row = document.getElementById(containerId);
  row.innerHTML = '';
  const current = getDifficulty(gameKey);
  DIFF_LEVELS.forEach(level=>{
    const btn = document.createElement('button');
    btn.className = 'diff-btn' + (level===current ? ' selected' : '');
    btn.textContent = t.diff[level];
    btn.onclick = ()=>{
      setDifficulty(gameKey, level);
      row.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      if(onChange) onChange(level);
    };
    row.appendChild(btn);
  });
}

// v_recommended_difficulty looks at the child's last 15 answers for this game
// and suggests 'subir'/'descer'/'manter'/'dados_insuficientes'. Moves at most
// one step per session so a single noisy round can't cause a sudden jump.
export async function adjustDifficultyForSession(gameKey){
  if(!state.profileId) return;
  try{
    const { data, error } = await sb.from('v_recommended_difficulty')
      .select('recomendacao').eq('profile_id', state.profileId).eq('game_key', gameKey).maybeSingle();
    if(error) throw error;
    if(!data || data.recomendacao === 'manter' || data.recomendacao === 'dados_insuficientes') return;
    const idx = DIFF_LEVELS.indexOf(getDifficulty(gameKey));
    if(data.recomendacao === 'subir' && idx < DIFF_LEVELS.length - 1) setDifficulty(gameKey, DIFF_LEVELS[idx+1]);
    else if(data.recomendacao === 'descer' && idx > 0) setDifficulty(gameKey, DIFF_LEVELS[idx-1]);
  }catch(e){ /* best-effort; keep whatever difficulty is already set */ }
}
