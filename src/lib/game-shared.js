// Cross-cutting helpers every game (and a few dashboard bits) share:

// mascot TTS speech, the feedback-banner + sound/haptic system, and

// per-game telemetry logging. Imports session-state.js for sb/state/session

// - never the other way around, so there's no circular dependency.

import { sb, state, session, getDifficulty } from './session-state.js';
import { L } from './i18n.js';

export function speak(text, rate){
  if(!('speechSynthesis' in window) || !text) return;
  const clean = String(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '') // skip emoji (stars, hearts, etc.) so the voice doesn't try to describe them
    .replace(/\s+/g,' ').trim();
  if(!clean) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = state.lang === 'it' ? 'it-IT' : 'pt-BR';
  u.rate = rate || 0.9;
  window.speechSynthesis.speak(u);
}

export function makeTtsBtn(text, light){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tts-btn' + (light ? ' tts-btn-light' : '');
  btn.setAttribute('aria-label', 'Ouvir');
  btn.textContent = '🔊';
  btn.onclick = (e)=>{ e.stopPropagation(); speak(text); };
  return btn;
}

export function makeTtsIcon(text){
  const span = document.createElement('span');
  span.className = 'tts-icon';
  span.setAttribute('role', 'button');
  span.setAttribute('aria-label', 'Ouvir');
  span.textContent = '🔊';
  span.onclick = (e)=>{ e.stopPropagation(); speak(text); };
  return span;
}

export function makeHelpBtn(instructionText){
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'help-btn';
  btn.setAttribute('aria-label', L().helpBtnLabel);
  btn.textContent = '💡';
  btn.onclick = (e)=>{
    e.stopPropagation();
    logGameEvent({ eventType: 'help_request' }); // behavioral signal for the "Tolerância à frustração" report; the hint itself is intentionally simple
    speak(instructionText, 0.65); // slower repeat of the instruction doubles as the "hint"
  };
  return btn;
}

export function setInstructions(id, text, showHelp){
  const el = document.getElementById(id);
  el.innerHTML = '';
  const span = document.createElement('span');
  span.className = 'instr-text';
  span.textContent = text;
  el.appendChild(span);
  el.appendChild(makeTtsBtn(text));
  if(showHelp) el.appendChild(makeHelpBtn(text));
}

// Names (child profile, professional full_name) are free text the account
// owner controls, but they get rendered into other people's browsers -
// professionals viewing linked children, parents viewing linked
// professionals - so any HTML in a name would execute in their session.
// Escape before every innerHTML/outerHTML interpolation of one; textContent
// assignments elsewhere don't need this, they never parse HTML.
export function escapeHtml(s){
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

export function showError(msg) {
  const el = document.getElementById('globalError');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// Two-step "type the word to confirm" modal, used for irreversible actions
// (account deletion) - shared by both dashboard modules, neither of which
// can import the other or app.js.
export function openDeleteAccountModal({ warningHtml, onConfirm }){
  const t = L().deleteModal;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <div data-step="1">
        <h3>⚠️ ${t.title}</h3>
        <p>${warningHtml}</p>
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.cancelBtn}</button>
          <button type="button" class="confirm-modal-btn-danger" data-action="continue">${t.continueBtn}</button>
        </div>
      </div>
      <div data-step="2" style="display:none;">
        <h3>⚠️ ${t.title}</h3>
        <p>${t.typeToConfirmLabel}</p>
        <input type="text" class="confirm-modal-input" id="deleteAccountConfirmInput" autocomplete="off" autocapitalize="characters">
        <div class="confirm-modal-actions">
          <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.cancelBtn}</button>
          <button type="button" class="confirm-modal-btn-danger" data-action="confirm" disabled>${t.finalBtn}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelectorAll('[data-action="cancel"]').forEach(btn=> btn.onclick = close);
  overlay.querySelector('[data-action="continue"]').onclick = ()=>{
    overlay.querySelector('[data-step="1"]').style.display = 'none';
    overlay.querySelector('[data-step="2"]').style.display = 'block';
    overlay.querySelector('#deleteAccountConfirmInput').focus();
  };

  const input = overlay.querySelector('#deleteAccountConfirmInput');
  const confirmBtn = overlay.querySelector('[data-action="confirm"]');
  input.addEventListener('input', ()=>{
    confirmBtn.disabled = input.value.trim().toUpperCase() !== t.confirmWord;
  });
  confirmBtn.onclick = async ()=>{
    confirmBtn.disabled = true;
    confirmBtn.textContent = t.deleting;
    await onConfirm(close);
  };
}

export function say(text){
  const el = document.getElementById('mascotSpeech');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.className = 'speech-text';
  span.textContent = text;
  el.appendChild(span);
  el.appendChild(makeTtsBtn(text, true));
}

export function blinkMascot(){
  const l = document.getElementById('eyeL'), r = document.getElementById('eyeR');
  if(!l||!r) return;
  l.setAttribute('ry','1'); r.setAttribute('ry','1');
  setTimeout(()=>{ l.setAttribute('ry','5'); r.setAttribute('ry','5'); }, 160);
}
setInterval(blinkMascot, 3500);

// Sound/vibration feedback - reviewed by the ADHD-UX agent. One global
// on/off (not per-game, to avoid repeated decisions) persisted in
// localStorage since it's a device/session preference, not profile data.
export function isSoundEnabled(){ return localStorage.getItem('ilha_sound_enabled') !== '0'; }
export function renderSoundToggle(){
  const btn = document.getElementById('soundToggleBtn');
  if(!btn) return;
  const on = isSoundEnabled();
  btn.textContent = on ? '🔊' : '🔇';
  btn.setAttribute('aria-label', on ? 'Som ativado' : 'Som desativado');
}
export function toggleSound(){
  localStorage.setItem('ilha_sound_enabled', isSoundEnabled() ? '0' : '1');
  renderSoundToggle();
}
let _audioCtx = null;
function getAudioCtx(){
  if(!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function beep(ctx, freq, startTime, duration, waveType, gainValue){
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = waveType;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainValue, startTime);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(startTime); osc.stop(startTime + duration + 0.02);
}
// Short synthesized tones (no audio-file assets, no loading cost) for
// correct/wrong/complete moments, layered on top of the existing visual
// feedback. "wrong" is deliberately a single soft, neutral blip - never a
// buzzer or descending tone - so getting something wrong stays low-stakes
// instead of reinforcing shame/avoidance in kids who may already carry
// frustration around mistakes. Skips entirely while the mascot is speaking
// (TTS) so the two audio channels never overlap.
export function playTone(type){
  if(!isSoundEnabled()) return;
  if(window.speechSynthesis && window.speechSynthesis.speaking) return;
  try{
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    if(type === 'correct'){
      beep(ctx, 660, now, 0.08, 'sine', 0.15);
      beep(ctx, 880, now + 0.08, 0.10, 'sine', 0.15);
    } else if(type === 'wrong'){
      beep(ctx, 330, now, 0.12, 'sine', 0.08);
    } else if(type === 'complete'){
      beep(ctx, 523, now, 0.10, 'triangle', 0.2);
      beep(ctx, 659, now + 0.10, 0.10, 'triangle', 0.2);
      beep(ctx, 784, now + 0.20, 0.15, 'triangle', 0.2);
    }
  }catch(e){ /* Web Audio unsupported/blocked - sound is a bonus, never required */ }
}
// No vibration on 'wrong' - stacking a physical negative signal on top of
// sound+visual would pile on for a single wrong answer; haptic stays
// reserved for positive moments only.
export function hapticFeedback(type){
  if(!isSoundEnabled()) return;
  if(!navigator.vibrate) return;
  if(type === 'correct') navigator.vibrate(30);
  else if(type === 'complete') navigator.vibrate([40,50,40,50,60]);
}
export function showFeedback(id, text, good){
  const el = document.getElementById(id);
  el.innerHTML = text;
  el.className = 'feedback-banner show ' + (good ? 'good' : 'gentle');
  el.appendChild(makeTtsBtn(el.textContent));
  playTone(good ? 'correct' : 'wrong');
  hapticFeedback(good ? 'correct' : 'wrong');
}
export function hideFeedback(id){ document.getElementById(id).className = 'feedback-banner'; }

export async function logGameEvent({ eventType, target = null, targetType = null, responseValue = null, correct = null, responseTimeMs = null, errorType = null, emotion = null, context = null }) {
  if (!state.profileId || !session.currentSessionId || !session.currentGameKey) return;
  try {
    const { error } = await sb.from('game_events').insert({
      session_id: session.currentSessionId,
      profile_id: state.profileId,
      game_key: session.currentGameKey,
      event_type: eventType,
      target: target,
      target_type: targetType,
      response_value: responseValue,
      correct: correct,
      response_time_ms: responseTimeMs,
      error_type: errorType,
      emotion: emotion,
      context: context
    });
    if (error) console.error('[gameEvents] falha ao gravar evento:', error);
  } catch (e) {}
}

const repeatedTapTimestamps = {};
function trackRepeatedTap(elementId) {
  const now = Date.now();
  if (!repeatedTapTimestamps[elementId]) repeatedTapTimestamps[elementId] = [];
  repeatedTapTimestamps[elementId] = repeatedTapTimestamps[elementId].filter(t => now - t < 1000);
  repeatedTapTimestamps[elementId].push(now);
  if (repeatedTapTimestamps[elementId].length >= 3) {
    logGameEvent({ eventType: 'repeated_tap', target: elementId });
    repeatedTapTimestamps[elementId] = [];
  }
}
document.addEventListener('pointerdown', (e) => {
  if (!session.currentGameKey) return;
  let id = null;
  const btn = e.target.closest('button, .hunt-cell, .trail-pad, .story-card, .light-circle, .emo-btn');
  if (btn) {
    if (btn.id) id = btn.id;
    else if (btn.className && typeof btn.className === 'string') id = btn.className.split(' ')[0];
  }
  if (id) trackRepeatedTap(id);
});

export function flushSessionLog(){
  if(session.currentGameKey) {
    if(!session.sessionCompleted && session.sessionDirty[session.currentGameKey]) {
      logGameEvent({ eventType: 'abandon' });
    }
    if (session.sessionDirty[session.currentGameKey]) logSession(session.currentGameKey, session.currentSessionId, session.sessionCompleted);
  }
  session.currentGameKey = null;
  session.currentSessionId = null;
}
// Safety net for a tab that's just closed or an app that's backgrounded on
// mobile - neither reaches any of flushSessionLog()'s in-app navigation call
// sites, so without this the session stays status='in_progress' forever
// (this was the actual cause of most sessions never showing as completed or
// abandoned). Unlike flushSessionLog(), this doesn't clear session.currentGameKey/
// session.currentSessionId - gameplay continues normally if the tab comes back to
// the foreground, and the eventual real flushSessionLog() (finishing the
// activity or navigating away) overwrites this checkpoint with the accurate
// final status/end_time.
export function checkpointSessionLog(){
  if(session.currentGameKey && session.sessionDirty[session.currentGameKey]) {
    logSession(session.currentGameKey, session.currentSessionId, session.sessionCompleted);
  }
}
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') checkpointSessionLog();
});
window.addEventListener('pagehide', checkpointSessionLog);
async function logSession(gameKey, sessionId, completed){
  session.sessionDirty[gameKey] = false;
  if(!state.profileId || !state.familyId || !state.profile || !sessionId) return;
  const stars = state.profile.starsByGame[gameKey] || 0;
  const difficulty = getDifficulty(gameKey);
  const startSeeds = session.sessionSeedsStart[gameKey] ?? state.profile.seeds;
  const seedsEarned = Math.max(0, state.profile.seeds - startSeeds);
  try{
    const { error } = await sb.from('game_sessions')
      .update({ difficulty, stars, seeds_earned: seedsEarned, end_time: new Date().toISOString(), status: completed ? 'completed' : 'abandoned' })
      .eq('id', sessionId);
    if(error) throw error;
  }catch(e){ /* best-effort; a failed log shouldn't block gameplay */ }
}
