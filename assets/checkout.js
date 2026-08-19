// Family checkout (Stripe/Pix), review form, and testimonials — only familias.html includes this.
// Depends on assets/site.js being loaded first (getFbClickId/getFbBrowserId).

// Validates a CPF using the standard mod-11 check-digit algorithm (rejects
// all-same-digit strings like 111.111.111-11). CNPJ (14 digits) is only
// length-checked - Asaas validates it authoritatively. Same function already
// used inside index.html's parents dashboard for the same purpose.
function isValidCpfCnpj(digits){
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

// Content-kit plans (PDF only, no game login) - checked in a few places below
// so Pix (never wired for kits) and the "access your account" success copy
// don't accidentally show for a product that isn't the game subscription.
const KIT_PLANS = ['kit_mini', 'kit_completo'];

const CHECKOUT_COPY = {
  pt: {
    '30days': { price: 'R$ 34,90', note: 'pagamento único · acesso por 30 dias' },
    monthly: { price: 'R$ 24,90', note: '/mês · cancele quando quiser' },
    bump30: { price: 'R$ 24,90', note: 'pagamento único · acesso por 30 dias · sem mensalidade' },
    kit_mini: { price: 'R$ 14,90', note: 'pagamento único · PDF por e-mail', productName: 'Mini Kit Attenzione' },
    kit_completo: { price: 'R$ 48,90', note: 'pagamento único · 6 PDFs por e-mail', productName: 'Kit Completo VisCare Kids' },
    kitSuccessTitle: 'Pagamento confirmado! 🎉',
    kitSuccessBody: 'Enviamos os arquivos do seu kit pro seu e-mail. Não encontrou? Confira a caixa de spam.',
    invalidEmail: 'Digite um e-mail válido.',
    genericError: 'Não foi possível continuar. Tente novamente.',
    redirecting: 'Aguarde...',
    productName: 'Ilha do Foco + Aventura das Letras',
    productImage: 'assets/cartoonPT.png',
    modalTitle: 'Quase lá!',
    identificationTitle: 'Identificação',
    paymentMethodTitle: 'Forma de pagamento',
    bumpBadge: '🎉 Promoção do momento',
    bumpOfferTitle: 'Você foi contemplado com uma condição especial!',
    bumpOfferLabel: 'Ativar promoção — 30 dias de acesso por R$ 24,90 à vista, sem mensalidade',
    pixInfoTitle: 'Pagamento somente à vista',
    pixInfoBody: 'A liberação do acesso ocorre logo após a confirmação do pagamento. Fique atento à data de expiração do código.',
    emailPlaceholder: 'Seu melhor e-mail', emailHint: 'É nesse e-mail que você vai receber o que você comprou.', phonePlaceholder: 'WhatsApp ou telefone (opcional)',
    cardLabel: 'Cartão', pixLabel: 'Pix', selectMethodError: 'Escolha uma forma de pagamento.',
    finalizeLabel: 'Finalizar compra', securityBadge: 'Pagamento 100% seguro',
    cpfModalTitle: 'Quase lá!', cpfLabel: 'Seu CPF ou CNPJ', cpfPlaceholder: '000.000.000-00',
    cpfInvalid: 'CPF/CNPJ inválido.', cpfCancel: 'Cancelar', cpfContinue: 'Gerar Pix', cpfGenerating: 'Gerando...',
    pixModalTitle: 'Pague com Pix', pixInstructions: 'Escaneie o QR code ou copie o código abaixo no seu app do banco.',
    pixCopy: 'Copiar código', pixCopied: 'Copiado!', pixWaiting: 'Aguardando pagamento...', pixConfirmed: 'Pagamento confirmado! Verifique seu e-mail.',
    pixClose: 'Fechar', pixError: 'Não foi possível gerar o Pix. Tente novamente.',
    successTitle: 'Pagamento confirmado! 🎉', successBody: 'Enviamos um link de acesso pro seu e-mail. Clique nele pra entrar na sua conta, já com tudo liberado. Não encontrou? Confira a caixa de spam.',
    confirming: 'Confirmando pagamento...',
    cancelledTitle: 'Pagamento não concluído', cancelledBody: 'Nenhuma cobrança foi feita. Quando quiser, é só tentar de novo.',
  },
  it: {
    '30days': { price: '€ 9,90', note: 'pagamento unico · nessun rinnovo automatico' },
    monthly: { price: '€ 4,99', note: '/mese · annulla quando vuoi' },
    bump30: { price: 'R$ 24,90', note: 'pagamento único · acesso por 30 dias · sem mensalidade' },
    kit_mini: { price: '€ 9,90', note: 'pagamento unico · PDF via email', productName: 'Mini Kit Attenzione' },
    kit_completo: { price: '€ 29,90', note: 'pagamento unico · 6 PDF via email', productName: 'Kit Completo VisCare Kids' },
    kitSuccessTitle: 'Pagamento confermato! 🎉',
    kitSuccessBody: 'Ti abbiamo inviato i file del tuo kit via email. Non li trovi? Controlla lo spam.',
    invalidEmail: 'Inserisci un\'email valida.',
    genericError: 'Impossibile continuare. Riprova.',
    redirecting: 'Attendere...',
    productName: 'VisCare Kids',
    productImage: 'assets/cartonnIT.png',
    modalTitle: 'Quasi fatto!',
    identificationTitle: 'Identificazione',
    paymentMethodTitle: 'Metodo di pagamento',
    bumpBadge: '🎉 Promozione del momento',
    bumpOfferTitle: 'Sei stato selezionato per una condizione speciale!',
    bumpOfferLabel: 'Attiva la promozione — 30 giorni di accesso a R$ 24,90 in un\'unica soluzione, senza abbonamento',
    pixInfoTitle: 'Pagamento in un\'unica soluzione',
    pixInfoBody: 'Lo sblocco avviene subito dopo la conferma del pagamento. Presta attenzione alla data di scadenza del codice.',
    emailPlaceholder: 'La tua migliore email', emailHint: 'Riceverai il prodotto scelto da te proprio a questa email.', phonePlaceholder: 'WhatsApp o telefono (facoltativo)',
    cardLabel: 'Carta', pixLabel: 'Pix', selectMethodError: 'Scegli un metodo di pagamento.',
    finalizeLabel: 'Completa l\'acquisto', securityBadge: 'Pagamento 100% sicuro',
    cpfModalTitle: 'Quasi fatto!', cpfLabel: 'Il tuo CPF o CNPJ', cpfPlaceholder: '000.000.000-00',
    cpfInvalid: 'CPF/CNPJ non valido.', cpfCancel: 'Annulla', cpfContinue: 'Genera Pix', cpfGenerating: 'Generazione...',
    pixModalTitle: 'Paga con Pix', pixInstructions: 'Scansiona il QR code o copia il codice qui sotto nella tua app bancaria.',
    pixCopy: 'Copia codice', pixCopied: 'Copiato!', pixWaiting: 'In attesa del pagamento...', pixConfirmed: 'Pagamento confermato! Controlla la tua email.',
    pixClose: 'Chiudi', pixError: 'Impossibile generare il Pix. Riprova.',
    successTitle: 'Pagamento confermato! 🎉', successBody: 'Ti abbiamo inviato un link di accesso via email. Cliccalo per entrare nel tuo account, già con tutto sbloccato. Non lo trovi? Controlla lo spam.',
    confirming: 'Confermando il pagamento...',
    cancelledTitle: 'Pagamento non completato', cancelledBody: 'Nessun addebito è stato effettuato. Quando vuoi, riprova pure.',
  },
};

// Ensures every checkout attempt has a `leads` row to attach the eventual
// "cliente" conversion to - without this, someone who lands from an ad and
// buys immediately (skipping the separate opt-in form, never clicking a
// lifecycle link) has no lead row for asaas-webhook/check-pix-payment-status
// to update, so the purchase never shows up in the CRM despite going through
// fine. Reuses the existing ilhaDoFoco_leadId key, so it's a no-op for anyone
// who already has one (from the opt-in form or a lifecycle link).
async function ensureCheckoutLeadId(lang, email, phone){
  const existing = localStorage.getItem('ilhaDoFoco_leadId');
  if(existing) return existing;

  const leadId = crypto.randomUUID();
  const params = new URLSearchParams(window.location.search);
  const payload = {
    id: leadId,
    full_name: null,
    contact_email: email,
    contact_whatsapp: phone || null,
    language: lang === 'it' ? 'it' : 'pt-BR', // leads.language is CHECK-constrained to exactly these two values
    whatsapp_opt_in: false,
    email_opt_in: false, // no consent checkbox in the checkout modal, unlike the opt-in form
    utm_source: params.get('utm_source') || 'direto',
    utm_medium: params.get('utm_medium') || null,
    utm_campaign: params.get('utm_campaign') || null,
    utm_content: params.get('utm_content') || null,
  };
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
    if(!res.ok) return null;
    localStorage.setItem('ilhaDoFoco_leadId', leadId);
    return leadId;
  }catch(e){
    return null; // best-effort - checkout must proceed even if this fails
  }
}

function setupCheckoutCard(lang){
  const t = CHECKOUT_COPY[lang];
  const card = document.getElementById(`checkoutCard-${lang}`);
  if(!card) return;
  const priceEl = card.querySelector('.checkout-price');
  const noteEl = card.querySelector('.checkout-price-note');
  const ctaBtn = card.querySelector('.checkout-cta-btn');

  card.querySelectorAll('.plan-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      card.dataset.plan = btn.dataset.plan;
      card.querySelectorAll('.plan-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      priceEl.textContent = t[btn.dataset.plan].price;
      noteEl.textContent = t[btn.dataset.plan].note;
    });
  });

  ctaBtn.addEventListener('click', () => openCheckoutModal(lang, card.dataset.plan));
}

// Single modal covering the whole checkout: product summary, e-mail, optional
// phone, payment method choice, and (only when Pix is picked) CPF/CNPJ - one
// "Finalizar compra" action instead of the old two-button-on-the-card +
// separate CPF modal flow. Card path redirects to Stripe same as before; Pix
// path still hands off to the existing QR modal/polling once the payment is
// created.
function openCheckoutModal(lang, plan){
  const t = CHECKOUT_COPY[lang];
  // Gated on the displayed product language, not the visitor's browser
  // locale - isBrazil() alone let a browser set to pt-BR show the BRL bump
  // (and Pix, and a BRL Stripe price) on top of the EUR-priced IT page if
  // the visitor had switched the page's language manually.
  // Only offered on the 30-day one-time plan - someone who already picked
  // monthly has shown intent to become a recurring subscriber, so dangling
  // a cheaper non-recurring option in front of them would just talk them
  // out of the recurring revenue instead of rescuing a hesitant one-time buyer.
  const showBump = lang === 'pt' && plan === '30days'; // bump30 only has BRL pricing - no EUR equivalent defined
  // Kit plans are PDF-only - Pix was never wired for them (create-public-pix-payment
  // has no content_kit branch), so only offer card for these regardless of lang.
  const isKitPlan = KIT_PLANS.includes(plan);
  const summaryName = t[plan].productName || t.productName;
  const overlay = document.createElement('div');
  overlay.className = 'checkout-page-overlay';
  overlay.innerHTML = `
    <div class="vendas-modal checkout-modal-v2">
      <button type="button" class="checkout-modal-close" data-action="cancel">×</button>
      <div class="checkout-summary">
        <img class="checkout-summary-img" src="${t.productImage}" alt="${summaryName}">
        <div>
          <div class="checkout-summary-name">${summaryName}</div>
          <div class="checkout-summary-price" id="checkoutSummaryPrice">${t[plan].price}</div>
          <div class="checkout-summary-note" id="checkoutSummaryNote">${t[plan].note}</div>
        </div>
      </div>

      <div class="checkout-section">
        <div class="checkout-section-title">👤 ${t.identificationTitle}</div>
        <input type="email" id="checkoutModalEmail" placeholder="${t.emailPlaceholder}" autocomplete="email">
        <p class="checkout-email-hint">${t.emailHint}</p>
        <input type="text" id="checkoutModalPhone" placeholder="${t.phonePlaceholder}" autocomplete="tel">
      </div>

      ${showBump ? `
      <div class="checkout-bump">
        <div class="checkout-bump-badge">${t.bumpBadge}</div>
        <div class="checkout-bump-title">${t.bumpOfferTitle}</div>
        <label class="checkout-bump-label">
          <input type="checkbox" id="checkoutBumpCheck">
          <span>${t.bumpOfferLabel}</span>
        </label>
      </div>` : ''}

      <div class="checkout-section">
        <div class="checkout-section-title">💳 ${t.paymentMethodTitle}</div>
        <div class="payment-method-row">
          <button type="button" class="payment-method-btn" data-method="card">💳 ${t.cardLabel}</button>
          ${(lang === 'pt' && !isKitPlan) ? `<button type="button" class="payment-method-btn" data-method="pix">⚡ ${t.pixLabel}</button>` : ''}
        </div>
        <input type="text" id="checkoutModalCpf" inputmode="numeric" placeholder="${t.cpfPlaceholder}" autocomplete="off" style="display:none;">
        <div class="checkout-payment-info" id="checkoutPaymentInfo" style="display:none;">
          <strong>${t.pixInfoTitle}</strong>
          ${t.pixInfoBody}
        </div>
      </div>

      <p class="modal-error" id="checkoutModalError" style="display:none;"></p>
      <button type="button" class="checkout-finalize-btn" id="checkoutModalFinalize" disabled>${t.finalizeLabel}</button>
      <p class="checkout-security-badge">🔒 ${t.securityBadge}</p>
      <button type="button" class="checkout-cancel-link" data-action="cancel">${t.cpfCancel}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if(e.target === overlay) close(); });
  overlay.querySelectorAll('[data-action="cancel"]').forEach(btn => { btn.onclick = close; });

  const emailInput = overlay.querySelector('#checkoutModalEmail');
  const phoneInput = overlay.querySelector('#checkoutModalPhone');
  const cpfInput = overlay.querySelector('#checkoutModalCpf');
  const errorEl = overlay.querySelector('#checkoutModalError');
  const finalizeBtn = overlay.querySelector('#checkoutModalFinalize');
  const methodBtns = overlay.querySelectorAll('[data-method]');
  const paymentInfoEl = overlay.querySelector('#checkoutPaymentInfo');
  const bumpCheck = overlay.querySelector('#checkoutBumpCheck');
  const summaryPriceEl = overlay.querySelector('#checkoutSummaryPrice');
  const summaryNoteEl = overlay.querySelector('#checkoutSummaryNote');

  const showError = (msg) => { errorEl.textContent = msg; errorEl.style.display = 'block'; };
  const clearError = () => { errorEl.style.display = 'none'; };

  // The bump swaps which plan gets charged (avulso <-> mensal) instead of
  // adding a second item - there's no multi-item cart here, just one
  // subscription per family, so "add to order" isn't meaningful the way it
  // is on the reference checkout this design is based on.
  const getEffectivePlan = () => (bumpCheck && bumpCheck.checked) ? 'bump30' : plan;
  if(bumpCheck){
    bumpCheck.addEventListener('change', () => {
      const effectivePlan = getEffectivePlan();
      summaryPriceEl.textContent = t[effectivePlan].price;
      summaryNoteEl.textContent = t[effectivePlan].note;
    });
  }

  let selectedMethod = null;
  methodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      selectedMethod = btn.dataset.method;
      methodBtns.forEach(b => b.classList.toggle('active', b === btn));
      cpfInput.style.display = selectedMethod === 'pix' ? 'block' : 'none';
      paymentInfoEl.style.display = selectedMethod === 'pix' ? 'block' : 'none';
      finalizeBtn.disabled = false;
      clearError();
    });
  });
  // Pre-select a sensible default so most people don't have to make an extra
  // choice: Pix for Brazil (converts better there), card everywhere else -
  // it's the only option for IT anyway, since Pix never renders there.
  const defaultMethodBtn = overlay.querySelector((lang === 'pt' && !isKitPlan) ? '[data-method="pix"]' : '[data-method="card"]');
  if(defaultMethodBtn) defaultMethodBtn.click();

  finalizeBtn.onclick = async () => {
    clearError();
    const email = emailInput.value.trim();
    if(!email || !email.includes('@') || !email.includes('.')){
      showError(t.invalidEmail);
      return;
    }
    if(!selectedMethod){
      showError(t.selectMethodError);
      return;
    }
    const phone = phoneInput.value.trim() || null;
    const leadId = await ensureCheckoutLeadId(lang, email, phone);
    const effectivePlan = getEffectivePlan();
    const originalLabel = finalizeBtn.textContent;
    const fbc = getFbClickId() || undefined;
    const fbp = getFbBrowserId() || undefined;

    if(selectedMethod === 'card'){
      if(typeof fbq !== 'undefined') fbq('track', 'InitiateCheckout');
      finalizeBtn.disabled = true;
      finalizeBtn.textContent = t.redirecting;
      try{
        const response = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/create-public-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, phone, country: lang === 'pt' ? 'BR' : 'INT', plan: effectivePlan, leadId: leadId || undefined, fbc, fbp }),
        });
        const result = await response.json();
        if(!response.ok || !result.url) throw new Error(result.error || 'checkout_failed');
        window.location.href = result.url;
      }catch(err){
        finalizeBtn.disabled = false;
        finalizeBtn.textContent = originalLabel;
        showError(t.genericError);
      }
      return;
    }

    // Pix
    const digits = cpfInput.value.replace(/\D/g, '');
    if(!isValidCpfCnpj(digits)){
      showError(t.cpfInvalid);
      return;
    }
    if(typeof fbq !== 'undefined') fbq('track', 'InitiateCheckout');
    finalizeBtn.disabled = true;
    finalizeBtn.textContent = t.cpfGenerating;
    try{
      const response = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/create-public-pix-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone, cpfCnpj: digits, plan: effectivePlan, leadId: leadId || undefined, fbc, fbp }),
      });
      const result = await response.json();
      if(!response.ok || !result.qrCodeImage) throw new Error(result.error || 'pix_failed');
      close();
      openCheckoutPixQrModal(lang, result);
    }catch(err){
      finalizeBtn.disabled = false;
      finalizeBtn.textContent = originalLabel;
      showError(t.pixError);
    }
  };
}

function openCheckoutPixQrModal(lang, { qrCodeImage, copyPasteCode, paymentId }){
  const t = CHECKOUT_COPY[lang];
  const overlay = document.createElement('div');
  overlay.className = 'vendas-modal-overlay';
  overlay.innerHTML = `
    <div class="vendas-modal">
      <h3>⚡ ${t.pixModalTitle}</h3>
      <p>${t.pixInstructions}</p>
      <img class="pix-qr-img" src="data:image/png;base64,${qrCodeImage}" alt="QR code Pix">
      <textarea rows="3" readonly>${copyPasteCode}</textarea>
      <div><button type="button" class="modal-btn-secondary" id="checkoutPixCopyBtn">${t.pixCopy}</button></div>
      <div class="pix-status" id="checkoutPixStatus">⏳ ${t.pixWaiting}</div>
      <div class="modal-actions"><button type="button" class="modal-btn-secondary" data-action="close">${t.pixClose}</button></div>
    </div>
  `;
  document.body.appendChild(overlay);

  let stopped = false;
  const close = () => { stopped = true; overlay.remove(); };
  overlay.addEventListener('click', (e) => { if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').onclick = close;
  overlay.querySelector('#checkoutPixCopyBtn').onclick = async () => {
    await navigator.clipboard.writeText(copyPasteCode);
    const btn = overlay.querySelector('#checkoutPixCopyBtn');
    btn.textContent = t.pixCopied;
    setTimeout(() => { if(!stopped) btn.textContent = t.pixCopy; }, 2000);
  };

  // No family_id exists yet to poll subscriptions by (the account is only
  // provisioned by asaas-webhook once payment confirms) - polls Asaas's own
  // payment status directly instead via check-pix-payment-status.
  (async function poll(){
    for(let i = 0; i < 75 && !stopped; i++){ // ~5 minutes at 4s intervals
      await new Promise(r => setTimeout(r, 4000));
      if(stopped) return;
      try{
        const res = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/check-pix-payment-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId }),
        });
        const data = await res.json();
        if(data.confirmed){
          stopped = true;
          const statusEl = overlay.querySelector('#checkoutPixStatus');
          if(statusEl){ statusEl.textContent = `✅ ${t.pixConfirmed}`; statusEl.classList.add('confirmed'); }
          // Same event_id the server-side CAPI call in check-pix-payment-status
          // uses for this payment - Meta dedupes the two into a single event.
          if(typeof fbq !== 'undefined' && data.value != null){
            fbq('track', 'Purchase', { value: data.value, currency: data.currency || 'BRL' }, { eventID: `purchase_${paymentId}` });
          }
          if(typeof gtag !== 'undefined' && data.value != null){
            gtag('event', 'conversion', {
              'send_to': 'AW-18374065092/dWeCCPK7_9wcEMT3t7lE',
              'value': data.value,
              'currency': data.currency || 'BRL',
              'transaction_id': `purchase_${paymentId}`,
            });
          }
          // Fast path: check-pix-payment-status just provisioned the account and
          // returned a fresh login link - redirect straight in from this same
          // tab instead of making the user go open the e-mail. If for any reason
          // no actionLink came back, the e-mail (already sent as a backup by
          // asaas-webhook once it fires) remains the fallback.
          if(data.actionLink){
            setTimeout(() => { window.location.href = data.actionLink; }, 1200);
          }
          return;
        }
      }catch(e){ /* transient network hiccup - just retry next tick */ }
    }
  })();
}

setupCheckoutCard('pt');
setupCheckoutCard('it');

const REVIEW_COPY = {
  pt: {
    missingName: 'Digite seu nome.',
    missingRating: 'Escolha de 1 a 5 estrelas.',
    genericError: 'Não foi possível enviar. Tente novamente.',
    sending: 'Enviando...',
    success: 'Obrigada! Sua avaliação será revisada antes de aparecer aqui. 💛',
  },
  it: {
    missingName: 'Inserisci il tuo nome.',
    missingRating: 'Scegli da 1 a 5 stelle.',
    genericError: 'Impossibile inviare. Riprova.',
    sending: 'Invio...',
    success: 'Grazie! La tua recensione sarà controllata prima di apparire qui. 💛',
  },
};

// Free text a site visitor controls, rendered via innerHTML into the
// testimonials grid below - same reasoning as index.html's escapeHtml
// (fixed there for the same class of stored-XSS risk): never trust it raw.
function escapeHtml(s){
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Public review form - any visitor can submit (see the app_reviews RLS
// policies: insert always forced to status='pending'), no purchase/login
// check. Moderation before anything shows publicly is the only gate.
function setupReviewForm(lang){
  const t = REVIEW_COPY[lang];
  const card = document.getElementById(`reviewFormCard-${lang}`);
  if(!card) return;
  const starRow = card.querySelector('.review-star-row');
  const stars = [...starRow.querySelectorAll('.review-star-btn')];
  const nameInput = card.querySelector('.review-name-input');
  const commentInput = card.querySelector('.review-comment-input');
  const submitBtn = card.querySelector('.review-submit-btn');
  const errorEl = card.querySelector('.review-error');
  const successEl = card.querySelector('.review-success');
  let rating = 0;

  function renderStars(){
    stars.forEach((btn, i) => btn.classList.toggle('active', i < rating));
  }
  function previewStars(n){
    stars.forEach((btn, i) => btn.classList.toggle('preview', i < n));
  }
  stars.forEach((btn, i) => {
    btn.addEventListener('click', () => { rating = i + 1; renderStars(); });
    btn.addEventListener('mouseenter', () => previewStars(i + 1));
  });
  starRow.addEventListener('mouseleave', () => previewStars(0));

  submitBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    errorEl.style.display = 'none';
    if(!name){
      errorEl.textContent = t.missingName;
      errorEl.style.display = 'block';
      return;
    }
    if(rating < 1){
      errorEl.textContent = t.missingRating;
      errorEl.style.display = 'block';
      return;
    }

    // Written into the column matching the form's own language - the other
    // language's column stays null until an admin adds a manual translation
    // (see admin.html), so loadTestimonials() never shows this comment on
    // the other language's page verbatim.
    const payload = {
      name,
      rating,
      [lang === 'it' ? 'comment_it' : 'comment_pt']: commentInput.value.trim() || null,
      status: 'pending',
    };

    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = t.sending;
    try{
      const res = await fetch(`${SUPABASE_URL}/rest/v1/app_reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(payload),
      });
      if(!res.ok) throw new Error('review_insert_failed');
      starRow.style.display = 'none';
      nameInput.style.display = 'none';
      commentInput.style.display = 'none';
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
setupReviewForm('pt');
setupReviewForm('it');

// Approved testimonials - fetched once, then rendered separately per
// language: a review's comment only appears on a language section once
// that language's column (comment_pt/comment_it) is filled in - either the
// original (submitted through that language's form) or a manual admin
// translation (see admin.html). Never shown untranslated on the other
// section - the card still appears (stars + name), just without a quote,
// until someone adds the missing translation.
// Section stays hidden (see the style="display:none" on both
// testimonialsSection-* wrappers) until there's at least one to show, so an
// empty grid never reads as "nobody's reviewed this."
async function loadTestimonials(){
  try{
    const res = await fetch(`${SUPABASE_URL}/rest/v1/app_reviews?status=eq.approved&order=created_at.desc&limit=9&select=name,rating,comment_pt,comment_it`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if(!res.ok) return;
    const reviews = await res.json();
    if(!Array.isArray(reviews) || !reviews.length) return;
    for(const lang of ['pt', 'it']){
      const grid = document.getElementById(`testimonialsGrid-${lang}`);
      const section = document.getElementById(`testimonialsSection-${lang}`);
      if(!grid || !section) continue;
      const commentField = lang === 'it' ? 'comment_it' : 'comment_pt';
      grid.innerHTML = reviews.map(r => `
        <div class="testimonial-card">
          <div class="testimonial-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>
          ${r[commentField] ? `<p class="testimonial-comment">"${escapeHtml(r[commentField])}"</p>` : ''}
          <div class="testimonial-name">${escapeHtml(r.name)}</div>
        </div>
      `).join('');
      section.style.display = '';
    }
  }catch(e){ /* best-effort - no testimonials shown just means the section stays hidden */ }
}
loadTestimonials();

// Handles the redirect back from Stripe's hosted checkout (the embedded Pix
// flow never leaves this page, so it doesn't need this - see the polling above).
(function handleCheckoutRedirect(){
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if(!checkout) return;
  const sessionId = params.get('session_id');
  history.replaceState({}, '', window.location.pathname);
  const wantsIt = document.getElementById('btnIt')?.classList.contains('active');
  const t = CHECKOUT_COPY[wantsIt ? 'it' : 'pt'];
  const box = document.createElement('div');
  box.className = 'wrap';
  // Prepended to the current-language block itself rather than anchored after
  // .hero - familias.html/profissionais.html have no hero, only Home does.
  const langBlock = document.querySelector(`[data-lang="${wantsIt ? 'it' : 'pt'}"]`);

  if(checkout === 'cancelled'){
    box.innerHTML = `<div class="checkout-cancelled-box"><h3>${t.cancelledTitle}</h3><p>${t.cancelledBody}</p></div>`;
    if(langBlock) langBlock.insertAdjacentElement('afterbegin', box);
    return;
  }

  // Fast path: check-checkout-session-status provisions the account (if
  // needed) and hands back a fresh login link the moment Stripe reports the
  // session as paid - normally resolves on the first try, since payment_status
  // is already settled by the time Stripe redirects back here. Falls back to
  // the "check your e-mail" message if no session_id came back for some
  // reason, or the session isn't marked paid yet.
  box.innerHTML = `<div class="checkout-success-box"><h3>${t.successTitle}</h3><p>${t.confirming}</p></div>`;
  if(langBlock) langBlock.insertAdjacentElement('afterbegin', box);

  if(!sessionId) return;
  (async () => {
    for(let i = 0; i < 5; i++){
      try{
        const res = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/check-checkout-session-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const data = await res.json();
        if(data.confirmed){
          // Same event_id the server-side CAPI call in check-checkout-session-status
          // uses for this session - Meta dedupes the two into a single event.
          if(typeof fbq !== 'undefined' && data.value != null){
            fbq('track', 'Purchase', { value: data.value, currency: data.currency || 'BRL' }, { eventID: `purchase_${sessionId}` });
          }
          if(typeof gtag !== 'undefined' && data.value != null){
            gtag('event', 'conversion', {
              'send_to': 'AW-18374065092/dWeCCPK7_9wcEMT3t7lE',
              'value': data.value,
              'currency': data.currency || 'BRL',
              'transaction_id': `purchase_${sessionId}`,
            });
          }
          // Content kits never get an actionLink (no game account involved) -
          // show the "check your e-mail for the PDF" message instead of the
          // "access your account" one, even if actionLink were ever present.
          const isKit = data.product_type === 'content_kit';
          if(data.actionLink && !isKit){
            window.location.href = data.actionLink;
          }else{
            const title = isKit ? t.kitSuccessTitle : t.successTitle;
            const body = isKit ? t.kitSuccessBody : t.successBody;
            box.innerHTML = `<div class="checkout-success-box"><h3>${title}</h3><p>${body}</p></div>`;
          }
          return;
        }
      }catch(e){ /* transient network hiccup - just retry next tick */ }
      await new Promise(r => setTimeout(r, 1500));
    }
    // Gave up after a few tries - the webhook will still catch up and e-mail the link.
    box.innerHTML = `<div class="checkout-success-box"><h3>${t.successTitle}</h3><p>${t.successBody}</p></div>`;
  })();
})();
