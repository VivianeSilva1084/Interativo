// Shared nav/language/tabs behavior + lead capture — used by every page (Home, familias.html, profissionais.html, sobre.html, contato.html).

function setDocLang(l){
  document.documentElement.setAttribute('lang', l === 'it' ? 'it-IT' : 'pt-BR');
  document.getElementById('btnPt').classList.toggle('active', l === 'pt');
  document.getElementById('btnIt').classList.toggle('active', l === 'it');
  document.querySelectorAll('[data-lang]').forEach(el => {
    el.style.display = (el.getAttribute('data-lang') === l) ? 'block' : 'none';
  });
  document.title = l === 'it'
    ? "VisCare Kids — Giochi educativi per attenzione, autocontrollo e lettura"
    : "Ilha do Foco + Aventura das Letras — Jogos para foco, calma e leitura";
}

// Toggles which of the two apps' intro+games-grid is shown inside the
// #appTabs-<lang> section - both panels' markup stays in the DOM the whole
// time (no innerHTML swap), same imperative display-toggle style setDocLang
// already uses above, just scoped to one section instead of the whole page.
function setAppTab(lang, tab){
  ['foco', 'letras'].forEach(t => {
    const panel = document.getElementById(`appTab${t === 'foco' ? 'Foco' : 'Letras'}-${lang}`);
    const btn = document.getElementById(`appTabBtn${t === 'foco' ? 'Foco' : 'Letras'}-${lang}`);
    if (panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if (btn) { btn.classList.toggle('active', t === tab); btn.setAttribute('aria-selected', t === tab ? 'true' : 'false'); }
  });
}

function toggleNav(){
  const nav = document.getElementById('siteNav');
  const btn = document.getElementById('navToggle');
  const open = !nav.classList.contains('open');
  nav.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closeNav(){
  document.getElementById('siteNav').classList.remove('open');
  document.getElementById('navToggle').setAttribute('aria-expanded', 'false');
}

// Picks the initial language before the visitor touches the 🇧🇷/🇮🇹 toggle:
// an explicit #lang=it (from the Italian version of the lifecycle emails)
// wins, otherwise fall back to the browser's own language. Everything past
// this point (video included) already reacts to setDocLang() alone, since
// each language's content - and video - lives in its own data-lang block
// that setDocLang() shows/hides; there's no separate video-language state.
(function detectInitialLang(){
  const hash = window.location.hash;
  const browserLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  const wantsIt = hash.includes('lang=it') || browserLang.startsWith('it');
  if(wantsIt) setDocLang('it');

  if(hash.includes('video')){
    const target = document.getElementById(wantsIt ? 'video-it' : 'video-pt');
    if(target) setTimeout(()=>target.scrollIntoView({behavior:'smooth'}), 300);
  }
})();

// Attribution: a visitor arriving from a lifecycle email/WhatsApp link carries
// ?lead_id=<uuid>. We log the visit and stash the id in localStorage (same
// origin as index.html) so it survives all the way to checkout, which only
// happens much later, deep inside the parents dashboard.
(function trackLeadVisit(){
  const leadId = new URLSearchParams(window.location.search).get('lead_id');
  if(!leadId) return;
  localStorage.setItem('ilhaDoFoco_leadId', leadId);
  fetch(`${SUPABASE_URL}/rest/v1/lead_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ id: crypto.randomUUID(), lead_id: leadId, event_type: 'sales_page_visited', channel: 'site' }),
  }).catch(()=>{});
})();

// Meta Pixel: CTAs elsewhere on this page or on another page (e.g. Home's
// "Para as Famílias" links) that point at the checkout card fire this as the
// closest "intent to convert" signal. `*=` instead of `^=` because a
// cross-page link looks like "familias.html#checkoutCard-pt", not just
// "#checkoutCard-pt". The checkout card's own buttons fire this again
// themselves, right as the payment call actually starts (see setupCheckoutCard).
document.querySelectorAll('a[href*="checkoutCard"]').forEach(el => {
  el.addEventListener('click', () => {
    if(typeof fbq !== 'undefined') fbq('track', 'InitiateCheckout');
  });
});

// Meta pixel click-attribution cookies — shared by lead capture below and by checkout.js on familias.html.
function getCookie(name){
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}
// The Pixel script sets _fbc itself once it processes an incoming fbclid,
// but that can race the very first checkout click - build it ourselves from
// the URL as a fallback, per Meta's documented fb.1.<timestamp>.<fbclid> format.
function getFbClickId(){
  const existing = getCookie('_fbc');
  if(existing) return existing;
  const fbclid = new URLSearchParams(window.location.search).get('fbclid');
  return fbclid ? `fb.1.${Date.now()}.${fbclid}` : null;
}
function getFbBrowserId(){
  return getCookie('_fbp');
}

/* ========================= Lead capture (no purchase yet) ========================= */
const LEAD_CAPTURE_COPY = {
  pt: {
    invalidEmail: 'Digite um e-mail válido.',
    genericError: 'Não foi possível enviar. Tente novamente.',
    sending: 'Enviando...',
    success: 'Prontinho! Fique de olho no seu e-mail.',
  },
  it: {
    invalidEmail: 'Inserisci un\'email valida.',
    genericError: 'Impossibile inviare. Riprova.',
    sending: 'Invio...',
    success: 'Fatto! Controlla la tua email.',
  },
};


function setupLeadCaptureForm(lang){
  const t = LEAD_CAPTURE_COPY[lang];
  const card = document.getElementById(`leadCaptureCard-${lang}`);
  if(!card) return;
  const nameInput = card.querySelector('.lead-capture-name-input');
  const emailInput = card.querySelector('.lead-capture-email-input');
  const consentLabel = card.querySelector('.lead-capture-consent');
  const consentCheck = card.querySelector('.lead-capture-consent-check');
  const submitBtn = card.querySelector('.lead-capture-submit');
  const errorEl = card.querySelector('.lead-capture-error');
  const successEl = card.querySelector('.lead-capture-success');

  submitBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    errorEl.style.display = 'none';
    if(!email || !email.includes('@') || !email.includes('.')){
      errorEl.textContent = t.invalidEmail;
      errorEl.style.display = 'block';
      return;
    }

    const leadId = crypto.randomUUID();
    const params = new URLSearchParams(window.location.search);
    const payload = {
      id: leadId,
      full_name: nameInput.value.trim() || null,
      contact_email: email,
      contact_whatsapp: null,
      language: lang === 'it' ? 'it' : 'pt-BR', // leads.language is CHECK-constrained to exactly these two values
      whatsapp_opt_in: false,
      email_opt_in: !!consentCheck?.checked,
      utm_source: params.get('utm_source') || 'direto',
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
      utm_content: params.get('utm_content') || null,
    };

    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = t.sending;
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
      });
      if(!res.ok) throw new Error('lead_insert_failed');
      // Same key the checkout card already reads - if this visitor buys later
      // in this browser, the existing conversion-marking logic picks this up
      // automatically, no changes needed there.
      localStorage.setItem('ilhaDoFoco_leadId', leadId);
      // Ad optimization signal - without this the Meta algorithm has almost no
      // conversion data to learn from (only Purchase, which is much rarer than
      // a lead). Client Pixel + server CAPI, same fbc/fbp already captured for
      // checkout so this lead can also be matched to the ad that drove it.
      if(typeof fbq !== 'undefined') fbq('track', 'Lead');
      fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/send-meta-capi-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId, email,
          fbc: getFbClickId() || undefined, fbp: getFbBrowserId() || undefined,
          eventSourceUrl: window.location.href,
        }),
      }).catch(()=>{ /* best-effort - a failed CAPI call shouldn't affect the lead capture UX */ });
      nameInput.style.display = 'none';
      emailInput.style.display = 'none';
      consentLabel.style.display = 'none';
      submitBtn.style.display = 'none';
      successEl.textContent = t.success;
      successEl.style.display = 'block';
    }catch(e){
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
      errorEl.textContent = t.genericError;
      errorEl.style.display = 'block';
    }
  });
}

setupLeadCaptureForm('pt');
setupLeadCaptureForm('it');
