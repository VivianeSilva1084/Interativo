// Stripe checkout + Pix (Asaas) subscription flows - triggered from the
// pre-login paywall screen and from inside the parents dashboard's
// upgrade/conversion UI, but not dashboard-shaped itself. Imports
// session-state.js, game-shared.js and i18n.js only - never a dashboard
// module - so both app.js and dashboards/parents-dashboard.js can import it
// without a circular dependency. SUPABASE_URL/SUPABASE_ANON_KEY are set
// globally by supabase-config.js, loaded via its own <script src> before
// dist/app.js in index.html.
import { sb, state } from './session-state.js';
import { showError } from './game-shared.js';
import { L } from './i18n.js';

// Best-effort locale sniff (no billing address is collected today) used to decide
// BRL vs EUR Stripe pricing, and now also whether to offer Pix as a payment method
// at all - Pix only makes sense for Brazilian users, so it stays hidden elsewhere.
export function isBrazil(){
  return navigator.language.toLowerCase().startsWith('pt');
}
// Fire-and-forget: logs a lead_events row via direct REST (same public-insert
// pattern used by the quiz funnel) so a checkout attempt is attributable even
// if the checkout itself fails or is abandoned before any webhook fires.
export function logLeadCheckoutStarted(leadId){
  if(!leadId) return;
  fetch(`${SUPABASE_URL}/rest/v1/lead_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ id: crypto.randomUUID(), lead_id: leadId, event_type: 'checkout_started', channel: 'site' }),
  }).catch(()=>{});
}

// Fire-and-forget, called right after a brand-new family row is created.
// leads has no self-service UPDATE policy (only admins can write to it), so
// this goes through link-lead-signup, which does the privileged write with
// the service role after verifying the caller's own session server-side.
export function linkLeadSignup(){
  const leadId = localStorage.getItem('ilhaDoFoco_leadId');
  if(!leadId) return;
  sb.auth.getSession().then(({ data: { session } })=>{
    if(!session) return;
    fetch(`${SUPABASE_URL}/functions/v1/link-lead-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ leadId }),
    }).catch(()=>{});
  });
}

export async function startCheckout(btn, plan){
  const t = L();
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t.parents.checkoutRedirecting;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) throw new Error('no-session');
    const country = isBrazil() ? 'BR' : 'INT';
    const leadId = localStorage.getItem('ilhaDoFoco_leadId');
    logLeadCheckoutStarted(leadId);
    const response = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ country, leadId: leadId || undefined, plan: plan || 'monthly' }),
    });
    const result = await response.json();
    if(!response.ok || !result.url) throw new Error(result.error || 'checkout_failed');
    window.location.href = result.url;
  }catch(err){
    btn.disabled = false;
    btn.textContent = originalLabel;
    showError(t.parents.checkoutError);
  }
}

// Validates a CPF using the standard mod-11 check-digit algorithm (rejects
// all-same-digit strings like 111.111.111-11, a common invalid placeholder).
// CNPJ (14 digits) is only length-checked - Asaas validates it authoritatively.
export function isValidCpfCnpj(digits){
  if(digits.length === 14) return true;
  if(digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const calcCheckDigit = (base) => {
    let sum = 0;
    for(let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * (base.length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const d1 = calcCheckDigit(digits.slice(0, 9));
  const d2 = calcCheckDigit(digits.slice(0, 10));
  return d1 === parseInt(digits[9], 10) && d2 === parseInt(digits[10], 10);
}

export function openPixCpfModal(plan, onSuccess){
  const t = L().parents;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>⚡ ${t.pixCpfModalTitle}</h3>
      <p style="margin-bottom:6px;">${t.pixCpfLabel}</p>
      <input type="text" class="pix-cpf-input" id="pixCpfInput" inputmode="numeric" placeholder="${t.pixCpfPlaceholder}" autocomplete="off">
      <p class="pix-cpf-hint">${t.pixCpfHint}</p>
      <p class="pix-cpf-error" id="pixCpfError">${t.pixCpfInvalid}</p>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.pixCpfCancelBtn}</button>
        <button type="button" class="confirm-modal-btn-danger" style="background:var(--leaf);" data-action="continue">${t.pixCpfContinueBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  const input = overlay.querySelector('#pixCpfInput');
  const errEl = overlay.querySelector('#pixCpfError');
  const continueBtn = overlay.querySelector('[data-action="continue"]');
  input.focus();
  continueBtn.onclick = async ()=>{
    const digits = input.value.replace(/\D/g, '');
    if(!isValidCpfCnpj(digits)){
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';
    continueBtn.disabled = true;
    continueBtn.textContent = t.pixGenerating;
    await startPixCheckout(digits, ()=>{ continueBtn.disabled = false; continueBtn.textContent = t.pixCpfContinueBtn; }, plan, onSuccess);
    close();
  };
}

async function startPixCheckout(cpfCnpj, onError, plan, onSuccess){
  const t = L().parents;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) throw new Error('no-session');
    const leadId = localStorage.getItem('ilhaDoFoco_leadId');
    logLeadCheckoutStarted(leadId);
    const response = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/create-pix-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ cpfCnpj, leadId: leadId || undefined, plan: plan || 'monthly' }),
    });
    const result = await response.json();
    if(!response.ok || !result.qrCodeImage) throw new Error(result.error || 'pix_failed');
    openPixQrModal(result, onSuccess);
  }catch(err){
    if(onError) onError();
    showError(t.pixError);
  }
}

function openPixQrModal({ qrCodeImage, copyPasteCode }, onSuccess){
  const t = L().parents;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="pix-modal">
      <h3>⚡ ${t.pixModalTitle}</h3>
      <p>${t.pixModalInstructions}</p>
      <img class="pix-qr-img" src="data:image/png;base64,${qrCodeImage}" alt="QR code Pix">
      <textarea class="pix-copy-code" id="pixCopyCode" rows="3" readonly>${copyPasteCode}</textarea>
      <div><button type="button" class="pix-copy-btn" id="pixCopyBtn">${t.pixCopyBtn}</button></div>
      <div class="pix-status" id="pixStatus">⏳ ${t.pixWaitingPayment}</div>
      <button type="button" class="pix-modal-close" data-action="close">${t.pixCloseBtn}</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let stopped = false;
  const close = ()=>{ stopped = true; overlay.remove(); };
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').onclick = close;

  overlay.querySelector('#pixCopyBtn').onclick = async ()=>{
    await navigator.clipboard.writeText(copyPasteCode);
    overlay.querySelector('#pixCopyBtn').textContent = t.pixCopiedLabel;
    setTimeout(()=>{ if(!stopped) overlay.querySelector('#pixCopyBtn').textContent = t.pixCopyBtn; }, 2000);
  };

  // Pix has no redirect-back step like Stripe Checkout, so this polls our own
  // subscriptions row (readable by the family via RLS) until the webhook
  // (triggered by Asaas once the payment settles) flips plan to 'premium'.
  (async function poll(){
    for(let i = 0; i < 75 && !stopped; i++){ // ~5 minutes at 4s intervals
      await new Promise(r=>setTimeout(r, 4000));
      if(stopped) return;
      const { data } = await sb.from('subscriptions').select('plan').eq('family_id', state.familyId).maybeSingle();
      if(data?.plan === 'premium'){
        const statusEl = overlay.querySelector('#pixStatus');
        if(statusEl){ statusEl.textContent = `✅ ${t.pixPaymentConfirmed}`; statusEl.classList.add('confirmed'); }
        setTimeout(()=>{ if(!stopped){ close(); onSuccess(); } }, 2500);
        return;
      }
    }
  })();
}
export async function manageSubscription(btn){
  const t = L();
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t.parents.manageSubRedirecting;
  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) throw new Error('no-session');
    const response = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/create-portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ returnUrl: 'https://interativo-pi.vercel.app' }),
    });
    const result = await response.json();
    if(result.url){
      window.location.href = result.url;
      return;
    }
    if(result.error === 'no_stripe_customer'){
      btn.disabled = false;
      btn.textContent = originalLabel;
      alert(t.parents.manageSubNoCustomer);
      return;
    }
    throw new Error(result.error || 'portal_failed');
  }catch(err){
    btn.disabled = false;
    btn.textContent = originalLabel;
    showError(t.parents.manageSubError);
  }
}
