// The 4-digit PIN gate in front of the parents area - separate from account
// auth, so a child using the shared device can't wander into billing/danger-
// zone settings. Imports session-state.js, game-shared.js, i18n.js and
// dashboards/parents-dashboard.js (parentsOpenDashboard, called once the PIN
// is set/verified) - never the other way around, so app.js can import
// openParents without a circular dependency.
import { sb, state } from './session-state.js';
import { flushSessionLog } from './game-shared.js';
import { L } from './i18n.js';
import { parentsOpenDashboard } from '../dashboards/parents-dashboard.js';

let parentsForcedSetup = false;
export function resetPinGate(){ parentsForcedSetup = false; }

// Unused - kept from the pre-extraction codebase (hashPin below uses its own
// inline FNV-1a hash instead, not this Web Crypto SHA-256).
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function hashPin(pin){
  const str = pin + ':' + state.authUserId;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function openParents(){
  flushSessionLog();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-parents').classList.add('active');
  document.getElementById('parentsTitle').textContent = '🔒 ' + L().parents.areaTitle;
  parentsForcedSetup = false;
  document.getElementById('parentsGate').style.display = 'block';
  document.getElementById('parentsDashboard').style.display = 'none';
  parentsRenderGate();
}
function parentsRenderGate(){
  const t = L();
  const isSetup = !state.familyPinHash || parentsForcedSetup;
  document.getElementById('parentsSetupBlock').style.display = isSetup ? 'block' : 'none';
  document.getElementById('parentsEnterBlock').style.display = isSetup ? 'none' : 'block';
  document.getElementById('parentsCancelForgotBtn').style.display = parentsForcedSetup ? 'inline-block' : 'none';
  document.getElementById('parentsGateTitle').textContent = isSetup ? t.parents.gateSetTitle : t.parents.gateEnterTitle;
  document.getElementById('parentsGateSubtitle').textContent = isSetup ? t.parents.gateSetSubtitle : t.parents.gateEnterSubtitle;
  document.getElementById('parentsPinLabel').textContent = t.parents.pinLabel;
  document.getElementById('parentsPinConfirmLabel').textContent = t.parents.pinConfirmLabel;
  document.getElementById('parentsPinLabelEnter').textContent = t.parents.pinLabel;
  document.getElementById('parentsSavePinBtn').textContent = t.parents.savePinBtn;
  document.getElementById('parentsUnlockBtn').textContent = t.parents.unlockBtn;
  document.getElementById('parentsForgotBtn').textContent = t.parents.forgotPin;
  document.getElementById('parentsCancelForgotBtn').textContent = t.backLabel;
  document.getElementById('parentsPinInput').value = '';
  document.getElementById('parentsPinConfirmInput').value = '';
  document.getElementById('parentsPinInputEnter').value = '';
  document.getElementById('parentsPinError').style.display = 'none';
  document.getElementById('parentsPinErrorEnter').style.display = 'none';
}
export function parentsForgotPin(){
  parentsForcedSetup = true;
  parentsRenderGate();
}
export function parentsCancelForgot(){
  parentsForcedSetup = false;
  parentsRenderGate();
}
export async function parentsSavePin(){
  const t = L();
  const errEl = document.getElementById('parentsPinError');
  const pin = document.getElementById('parentsPinInput').value.trim();
  const confirmPin = document.getElementById('parentsPinConfirmInput').value.trim();
  if(!/^\d{4}$/.test(pin)){ errEl.textContent = t.parents.errPinLength; errEl.style.display = 'block'; return; }
  if(pin !== confirmPin){ errEl.textContent = t.parents.errPinMismatch; errEl.style.display = 'block'; return; }
  try{
    const hash = await hashPin(pin);
    const { error } = await sb.from('families').update({ parent_pin_hash: hash }).eq('auth_user_id', state.authUserId);
    if(error) throw error;
    state.familyPinHash = hash;
    parentsForcedSetup = false;
    await parentsOpenDashboard();
  }catch(e){
    errEl.textContent = t.parents.errGeneric;
    errEl.style.display = 'block';
  }
}
export async function parentsCheckPin(){
  const t = L();
  const errEl = document.getElementById('parentsPinErrorEnter');
  const pin = document.getElementById('parentsPinInputEnter').value.trim();
  if(!/^\d{4}$/.test(pin)){ errEl.textContent = t.parents.errPinLength; errEl.style.display = 'block'; return; }
  const hash = await hashPin(pin);
  if(hash === state.familyPinHash){
    await parentsOpenDashboard();
  } else {
    errEl.textContent = t.parents.errPinWrong;
    errEl.style.display = 'block';
    document.getElementById('parentsPinInputEnter').value = '';
  }
}
