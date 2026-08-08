import { sb, state, session, getDifficulty } from './lib/session-state.js';
import {
  setInstructions, escapeHtml, say, renderSoundToggle, toggleSound,
  showFeedback, hideFeedback, logGameEvent, flushSessionLog, showError,
} from './lib/game-shared.js';
import { I18N, AUTH_I18N, L } from './lib/i18n.js';
import {
  GAME_KEYS, saveProfileData, renderHubTileStars, adjustDifficultyForSession, defaultProfileData,
} from './lib/game-progress.js';
import { semInit, semStart, semTap } from './games/semaforo.js';
import { simonInit, simonStart } from './games/memoria.js';
import { storyInit, storyStart } from './games/historia.js';
import { chatInit, chatStart, chatContinue } from './games/minhavez.js';
import { huntInit, huntStart, huntShowPreStart, huntTogglePace } from './games/cacaalvo.js';
import { thermoInit, thermoStart } from './games/termometro.js';
import { loadProfilesList, AVATARS } from './lib/parents-data.js';
import { openProfessionalDashboard, resetProfDashboardSelection } from './dashboards/professional-dashboard.js';
import { parentsOpenDashboard, openAddChildProfileModal, resetParentsDashboardState } from './dashboards/parents-dashboard.js';
import {
  openParents, parentsForgotPin, parentsCancelForgot, parentsSavePin, parentsCheckPin, resetPinGate,
} from './lib/pin-gate.js';
import { isBrazil, startCheckout, openPixCpfModal, linkLeadSignup } from './lib/billing.js';
/* ============================================================
   GAME CONTENT DATA (per-game text/assets in both languages -
   UI copy itself lives in lib/i18n.js)
   ============================================================ */
const STICKERS = [
  { id:'parrot',    emoji:'🦜', tier:'bronze',    price:10,  name:{pt:'Papagaio',     it:'Pappagallo'} },
  { id:'butterfly', emoji:'🦋', tier:'bronze',    price:10,  name:{pt:'Borboleta',    it:'Farfalla'} },
  { id:'bee',       emoji:'🐝', tier:'bronze',    price:15,  name:{pt:'Abelha',       it:'Ape'} },
  { id:'lizard',    emoji:'🦎', tier:'bronze',    price:15,  name:{pt:'Lagartixa',    it:'Lucertola'} },
  { id:'snail',     emoji:'🐌', tier:'bronze',    price:15,  name:{pt:'Caracol',      it:'Lumaca'} },
  { id:'duck',      emoji:'🦆', tier:'bronze',    price:20,  name:{pt:'Pato',         it:'Anatra'} },
  { id:'pufferfish',emoji:'🐡', tier:'bronze',    price:20,  name:{pt:'Baiacu',       it:'Pesce palla'} },
  { id:'fish',      emoji:'🐠', tier:'silver',    price:25,  name:{pt:'Peixinho',     it:'Pesciolino'} },
  { id:'crab',      emoji:'🦀', tier:'silver',    price:25,  name:{pt:'Caranguejo',   it:'Granchio'} },
  { id:'octopus',   emoji:'🐙', tier:'silver',    price:30,  name:{pt:'Polvo',        it:'Polpo'} },
  { id:'flamingo',  emoji:'🦩', tier:'silver',    price:35,  name:{pt:'Flamingo',     it:'Fenicottero'} },
  { id:'monkey',    emoji:'🐒', tier:'silver',    price:40,  name:{pt:'Macaco',       it:'Scimmia'} },
  { id:'otter',     emoji:'🦦', tier:'silver',    price:45,  name:{pt:'Lontra',       it:'Lontra'} },
  { id:'owl',       emoji:'🦉', tier:'gold',      price:55,  name:{pt:'Coruja',       it:'Gufo'} },
  { id:'dolphin',   emoji:'🐬', tier:'gold',      price:65,  name:{pt:'Golfinho',     it:'Delfino'} },
  { id:'peacock',   emoji:'🦚', tier:'gold',      price:75,  name:{pt:'Pavão',        it:'Pavone'} },
  { id:'whale',     emoji:'🐳', tier:'gold',      price:90,  name:{pt:'Baleia',       it:'Balena'} },
  { id:'kapi',      emoji:'🦫', tier:'legendary', price:150, name:{pt:'Kapi Dourada', it:'Kapi Dorata'} }
];

/* ============================================================
   SUPABASE + AUTH + STATE
   ============================================================ */
// SUPABASE_URL/SUPABASE_ANON_KEY come from supabase-config.js, loaded above.


let authMode = 'login'; // login, signup, reset
let authUserType = 'family'; // family | professional

function setAuthLang(l) {
  state.lang = l; // one language drives the whole app, from the login screen onward
  document.getElementById('authLangBtnPt').classList.toggle('active', l === 'pt');
  document.getElementById('authLangBtnIt').classList.toggle('active', l === 'it');
  renderAuthScreen();
}


function getAuthErrorMsg(errCode) {
  const t = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  if (!errCode) return t.errorGeneric;
  const lower = errCode.toLowerCase();
  if (lower.includes('email_not_confirmed') || lower.includes('email not confirmed')) return t.errorEmailNotConfirmed;
  if (errCode.includes('invalid_credentials')) return t.errorInvalidCredentials;
  if (errCode.includes('user_already_exists')) return t.errorEmailInUse;
  if (errCode.includes('weak_password')) return t.errorWeakPassword;
  if (errCode.includes('network') || errCode.includes('fetch')) return t.errorNetwork;
  return t.errorGeneric;
}

function renderAuthScreen() {
  const t = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  document.getElementById('authLangBtnPt').classList.toggle('active', state.lang === 'pt');
  document.getElementById('authLangBtnIt').classList.toggle('active', state.lang === 'it');
  document.title = (I18N[state.lang] || I18N.pt).pageTitle;

  const title = document.getElementById('authTitle');
  const subtitle = document.getElementById('authSubtitle');
  const btn = document.getElementById('authSubmitBtn');
  const toggleBtn = document.getElementById('authToggleBtn');
  const forgotBtn = document.getElementById('authForgotBtn');
  const confirmLbl = document.getElementById('authConfirmPasswordLabel');
  const confirmInp = document.getElementById('authConfirmPassword');
  const passLbl = document.getElementById('authPasswordLabel');
  const passInp = document.getElementById('authPassword');
  
  document.getElementById('authEmailLabel').textContent = t.emailLabel;
  document.getElementById('authEmail').placeholder = t.emailPlaceholder;
  passLbl.textContent = t.passwordLabel;
  passInp.placeholder = t.passwordPlaceholder;
  confirmLbl.textContent = t.confirmPasswordLabel;
  confirmInp.placeholder = t.confirmPasswordPlaceholder;
  document.getElementById('authPrivacyNote').textContent = t.privacyNote;
  const legalConsent = document.getElementById('authLegalConsent');
  legalConsent.innerHTML = t.legalConsentHtml;
  legalConsent.style.display = authMode === 'signup' ? 'block' : 'none';
  document.getElementById('footerNote').textContent = (I18N[state.lang] || I18N.pt).footer;

  document.getElementById('authError').style.display = 'none';

  document.getElementById('authGoogleBtnLabel').textContent = t.googleBtn;
  document.getElementById('authGoogleDividerLabel').textContent = t.orDivider;
  // Google sign-in only covers the family flow: professional signup collects
  // structured fields (role, license, org) that an OAuth redirect can't carry.
  const showGoogleLogin = authUserType === 'family' && authMode !== 'reset';
  document.getElementById('authGoogleDivider').style.display = showGoogleLogin ? 'flex' : 'none';
  document.getElementById('authGoogleBtn').style.display = showGoogleLogin ? 'flex' : 'none';

  if (authMode === 'login') {
    title.textContent = t.loginTitle;
    subtitle.textContent = t.welcomeSubtitle;
    btn.textContent = t.loginBtn;
    toggleBtn.textContent = t.switchToSignup;
    toggleBtn.style.display = 'inline-block';
    forgotBtn.textContent = t.forgotPasswordLink;
    forgotBtn.style.display = 'inline-block';
    
    passLbl.style.display = 'block';
    passInp.style.display = 'block';
    confirmLbl.style.display = 'none';
    confirmInp.style.display = 'none';
  } else if (authMode === 'signup') {
    title.textContent = t.signupTitle;
    subtitle.textContent = t.signupSubtitle;
    btn.textContent = t.signupBtn;
    toggleBtn.textContent = t.switchToLogin;
    toggleBtn.style.display = 'inline-block';
    forgotBtn.style.display = 'none';
    
    passLbl.style.display = 'block';
    passInp.style.display = 'block';
    confirmLbl.style.display = 'block';
    confirmInp.style.display = 'block';
  } else if (authMode === 'reset') {
    title.textContent = t.resetTitle;
    subtitle.textContent = t.resetSubtitle;
    btn.textContent = t.resetBtn;
    toggleBtn.textContent = t.backToLogin;
    toggleBtn.style.display = 'inline-block';
    forgotBtn.style.display = 'none';
    
    passLbl.style.display = 'none';
    passInp.style.display = 'none';
    confirmLbl.style.display = 'none';
    confirmInp.style.display = 'none';
  }

  // -- Campos exclusivos do cadastro profissional (nome, função, registro, instituição) --
  const fullNameLbl = document.getElementById('authFullNameLabel');
  const fullNameInp = document.getElementById('authFullName');
  const roleLbl = document.getElementById('authRoleLabel');
  const roleSel = document.getElementById('authRole');
  const licenseLbl = document.getElementById('authLicenseLabel');
  const licenseInp = document.getElementById('authLicense');
  const orgLbl = document.getElementById('authOrgLabel');
  const orgInp = document.getElementById('authOrg');
  const showProFields = authUserType === 'professional' && authMode === 'signup';
  [fullNameLbl, fullNameInp, roleLbl, roleSel, licenseLbl, licenseInp, orgLbl, orgInp].forEach(el=>{
    el.style.display = showProFields ? 'block' : 'none';
  });
  fullNameLbl.textContent = t.fullNameLabel;
  fullNameInp.placeholder = t.fullNamePlaceholder;
  roleLbl.textContent = t.roleLabel;
  document.getElementById('authRoleOptLogopedista').textContent = t.roleLogopedista;
  document.getElementById('authRoleOptPsicologo').textContent = t.rolePsicologo;
  document.getElementById('authRoleOptProfessor').textContent = t.roleProfessor;
  document.getElementById('authRoleOptOutro').textContent = t.roleOutro;
  licenseLbl.textContent = t.licenseLabel;
  licenseInp.placeholder = t.licensePlaceholder;
  orgLbl.textContent = t.orgLabel;
  orgInp.placeholder = t.orgPlaceholder;

  // -- Sobrescreve com modo profissional (quando ativo) --
  const proToggle = document.getElementById('authProToggle');
  if (authUserType === 'professional') {
    const proBadge = { pt: '🏥 Modo Profissional', it: '🏥 Modalità Professionale' };
    const badge = proBadge[state.lang] || proBadge.pt;
    if (authMode === 'signup') {
      title.textContent = t.proSignupTitle;
      subtitle.innerHTML = `<span class="auth-pro-mode-badge">${badge}</span>`;
      btn.textContent = t.proSignupBtn;
      toggleBtn.textContent = t.switchToLogin;
      confirmLbl.style.display = 'block';
      confirmInp.style.display = 'block';
    } else {
      const proTitle = { pt: 'Área dos Profissionais', it: 'Area Professionisti' };
      title.textContent = proTitle[state.lang] || proTitle.pt;
      subtitle.innerHTML = `<span class="auth-pro-mode-badge">${badge}</span>`;
      btn.textContent = t.loginBtn;
      toggleBtn.textContent = t.switchToSignup;
    }
    toggleBtn.style.display = 'inline-block';
    forgotBtn.style.display = 'none';
    passLbl.style.display = 'block';
    passInp.style.display = 'block';
    if (proToggle) proToggle.textContent = state.lang === 'it' ? '← Accedi come genitore' : '← Entrar como responsável';
  } else {
    if (proToggle) proToggle.textContent = state.lang === 'it' ? 'Accedi come professionista' : 'Entrar como profissional';
  }
}

function toggleAuthMode() {
  if (authMode === 'login') authMode = 'signup';
  else authMode = 'login';
  renderAuthScreen();
}

function handleForgotPassword() {
  authMode = 'reset';
  renderAuthScreen();
}

async function handleGoogleLogin() {
  const t = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  const btn = document.getElementById('authGoogleBtn');
  btn.disabled = true;
  try {
    // signInWithOAuth navigates the whole page to Google on success, so
    // there's no session to handle here - onAuthStateChange picks it up
    // (via detectSessionInUrl) the same way it already does for email
    // login, once Google redirects back.
    //
    // The ?parents=1 intent (set in localStorage by openSignupFromQueryParam)
    // is re-attached to the redirect URL here rather than trusted to survive
    // in localStorage alone - Google's full-page redirect round trip is a much
    // bigger detour than email/password login ever takes, so the URL itself
    // carries the intent back too. Requires the wildcard entry
    // "https://interativo-pi.vercel.app/**" in Supabase's Redirect URLs list
    // (added alongside the pre-existing exact, no-wildcard entry).
    // Only append anything when the flag is set - otherwise this must stay
    // byte-for-byte window.location.origin (no trailing slash) to keep
    // matching the pre-existing exact, no-wildcard allow-list entry.
    const wantsParents = localStorage.getItem('ilhaDoFoco_landOnParents') === '1';
    const redirectTo = window.location.origin + (wantsParents ? '/?parents=1' : '');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (error) throw error;
  } catch (err) {
    btn.disabled = false;
    showError(t.googleLoginError);
  }
}

sb.auth.onAuthStateChange(async (event, session) => {
  if (session) {
    state.authUserId = session.user.id;

    // -- Verificação de profissional (antes da lógica de família) --
    const { data: profRow } = await sb.from('professionals').select('id').eq('auth_user_id', session.user.id).maybeSingle();
    if (profRow) {
      state.isProfessional = true;
      resetProfDashboardSelection();
      openProfessionalDashboard();
      return;
    }

    // First session ever seen for a professional signup (whether that's
    // immediate, with email confirmation off, or delayed until the user
    // clicks the confirmation link): the row couldn't be created at signUp
    // time because no session - and therefore no RLS-usable auth.uid() -
    // existed yet, so it's created here from the metadata signUp() stashed.
    if (session.user.user_metadata?.signup_type === 'professional') {
      const meta = session.user.user_metadata;
      const profPayload = {
        auth_user_id: session.user.id,
        full_name: meta.full_name,
        role: meta.role,
        license_number: meta.license_number || null,
        organization_name: meta.organization_name || null,
      };
      let { error: profError } = await sb.from('professionals').insert(profPayload);
      const isDuplicate = (err) => err?.message?.includes('duplicate key');
      if (profError && !isDuplicate(profError)) {
        // Best-effort single retry for a transient failure; a duplicate-key
        // error means another onAuthStateChange firing already created it
        // (harmless - the unique constraint on auth_user_id makes that safe).
        ({ error: profError } = await sb.from('professionals').insert(profPayload));
      }
      if (!profError || isDuplicate(profError)) {
        state.isProfessional = true;
        resetProfDashboardSelection();
        openProfessionalDashboard();
        return;
      }
      // Genuine, non-duplicate failure: don't fall through to family
      // creation below - that would silently turn a professional signup
      // into a stray family account instead of surfacing the real problem.
      showError((AUTH_I18N[state.lang] || AUTH_I18N.pt).errorProfOrphaned);
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('screen-auth').classList.add('active');
      renderAuthScreen();
      return;
    }
    state.isProfessional = false;

    // -- Lógica de família (fluxo existente) --
    const { data: familyList, error } = await sb.from('families').select('id, parent_pin_hash').eq('auth_user_id', session.user.id).limit(1);
    const family = familyList && familyList.length > 0 ? familyList[0] : null;
    if (family) {
      state.familyId = family.id;
      state.familyPinHash = family.parent_pin_hash || null;
    } else {
      const { data: newFamily, err } = await sb.from('families').insert({ auth_user_id: session.user.id }).select('id, parent_pin_hash').single();
      if(newFamily){
        state.familyId = newFamily.id; state.familyPinHash = newFamily.parent_pin_hash || null;
        linkLeadSignup();
      }
    }
    await routeFamilyAfterAccessCheck();
  } else {
    state.isProfessional = false;
    state.familyId = null;
    state.familyPinHash = null;
    state.authUserId = null;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-auth').classList.add('active');
    renderAuthScreen(); // Atualiza idiomas
  }
});

// Families created before the paywall existed are grandfathered (legacy_free_access
// in the DB); everyone else needs an active plan before seeing anything past this
// point. Also called after a Pix payment confirms from the paywall screen itself
// (no page reload there, unlike Stripe's redirect-back which re-runs
// onAuthStateChange and naturally re-evaluates this on its own).
async function routeFamilyAfterAccessCheck(){
  const { data: hasAccess } = await sb.rpc('family_has_access', { p_family_id: state.familyId });
  if(!hasAccess){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-paywall').classList.add('active');
    renderPaywallScreen();
    return;
  }
  if(localStorage.getItem('ilhaDoFoco_landOnParents') === '1'){
    localStorage.removeItem('ilhaDoFoco_landOnParents');
    openParents();
    return;
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-profiles').classList.add('active');
  renderProfilesScreen();
}

// Same plan-toggle + payment-method markup as the parents-dashboard upsell card
// (renderParentsDashboardBody's conversionCard), standalone here since this runs
// before there's any child profile or dashboard to attach it to. The Pix path
// passes routeFamilyAfterAccessCheck as the on-success callback instead of the
// dashboard's default (renderParentsDashboardBody) - Stripe's card path doesn't
// need that, since its redirect-back reloads the page and re-runs the same check.
function renderPaywallScreen(){
  const t = L();
  const card = document.getElementById('paywallCard');
  const footerFor = (plan) => {
    if(plan === '30days') return isBrazil() ? t.parents.clinicalConversionFooter30DaysBRL : t.parents.clinicalConversionFooter30DaysEUR;
    return isBrazil() ? t.parents.clinicalConversionFooterBRL : t.parents.clinicalConversionFooterEUR;
  };
  card.dataset.plan = '30days';
  card.innerHTML = `
    <div class="conversion-title">🌴 ${t.parents.paywallTitle}</div>
    <p class="paywall-intro">${t.parents.paywallIntro}</p>
    <div class="plan-toggle-row">
      <button type="button" class="plan-toggle-btn active" data-plan="30days">${t.parents.plan30DaysLabel}</button>
      <button type="button" class="plan-toggle-btn" data-plan="monthly">${t.parents.planMonthlyLabel}</button>
    </div>
    <div class="payment-method-row">
      <button class="big-cta" data-method="card">${isBrazil() ? t.parents.upgradeBtnCard : t.parents.upgradeBtn}</button>
      ${isBrazil() ? `<button class="big-cta pix-btn" data-method="pix">${t.parents.upgradeBtnPix}</button>` : ''}
    </div>
    <p class="conversion-footer">${footerFor('30days')}</p>
  `;
  const footerEl = card.querySelector('.conversion-footer');
  card.querySelectorAll('.plan-toggle-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{
      card.dataset.plan = btn.dataset.plan;
      card.querySelectorAll('.plan-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
      footerEl.textContent = footerFor(btn.dataset.plan);
    });
  });
  card.querySelector('[data-method="card"]').addEventListener('click', (e)=> startCheckout(e.currentTarget, card.dataset.plan));
  const pixBtn = card.querySelector('[data-method="pix"]');
  if(pixBtn) pixBtn.addEventListener('click', ()=> openPixCpfModal(card.dataset.plan, routeFamilyAfterAccessCheck));
}

async function handleAuthSubmit() {
  if (authUserType === 'professional' && authMode === 'signup') {
    return handleProfessionalSignup();
  }

  const t = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const confirmPassword = document.getElementById('authConfirmPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';

  if(!email || (authMode !== 'reset' && !password)) {
    errEl.textContent = t.errorInvalidCredentials;
    errEl.style.display = 'block';
    return;
  }

  if (authMode === 'signup' && password !== confirmPassword) {
    errEl.textContent = t.errorPasswordMismatch;
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('authSubmitBtn');
  const originalText = btn.textContent;
  btn.textContent = authMode === 'signup' ? t.loadingSignup : (authMode === 'login' ? t.loadingLogin : '...');
  btn.disabled = true;

  let error = null;
  if (authMode === 'signup') {
    const res = await sb.auth.signUp({ email, password, options: { data: { signup_type: 'family' } } });
    error = res.error;
    // With email confirmation required, signUp() succeeds but returns no
    // session until the link is clicked - onAuthStateChange won't fire, so
    // nothing else happens automatically here. Tell the user to go check
    // their inbox instead of leaving them looking at an unchanged screen.
    if (!error && !res.data?.session) {
      errEl.style.color = '#B8E8B0';
      errEl.style.backgroundColor = 'rgba(124,197,118,.2)';
      errEl.style.borderColor = 'var(--success)';
      errEl.textContent = t.confirmationSentMessage;
      errEl.style.display = 'block';
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }
  } else if (authMode === 'login') {
    const res = await sb.auth.signInWithPassword({ email, password });
    error = res.error;
  } else if (authMode === 'reset') {
    const res = await sb.auth.resetPasswordForEmail(email);
    error = res.error;
    if(!error) {
      errEl.style.color = '#B8E8B0';
      errEl.style.backgroundColor = 'rgba(124,197,118,.2)';
      errEl.style.borderColor = 'var(--success)';
      errEl.textContent = t.resetSentMessage;
      errEl.style.display = 'block';
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }
  }
  
  if (error) {
    errEl.style.color = '#FFA3B1';
    errEl.style.backgroundColor = 'rgba(229,85,110,.2)';
    errEl.style.borderColor = 'var(--berry)';
    errEl.textContent = getAuthErrorMsg(error.message || error.code);
    errEl.style.display = 'block';
  }
  
  btn.textContent = originalText;
  btn.disabled = false;
}

async function handleProfessionalSignup(){
  const t = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  const fullName = document.getElementById('authFullName').value.trim();
  const role = document.getElementById('authRole').value;
  const license = document.getElementById('authLicense').value.trim();
  const org = document.getElementById('authOrg').value.trim();
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const confirmPassword = document.getElementById('authConfirmPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';

  if(!fullName){
    errEl.textContent = t.errorFullNameRequired;
    errEl.style.display = 'block';
    return;
  }
  if(!email || !password){
    errEl.textContent = t.errorInvalidCredentials;
    errEl.style.display = 'block';
    return;
  }
  if(password !== confirmPassword){
    errEl.textContent = t.errorPasswordMismatch;
    errEl.style.display = 'block';
    return;
  }

  const btn = document.getElementById('authSubmitBtn');
  const originalText = btn.textContent;
  btn.textContent = t.proLoadingSignup;
  btn.disabled = true;

  try{
    // The professionals row isn't created here - it's created by
    // onAuthStateChange from this metadata, the first time a real session
    // shows up for this user (immediately if email confirmation is off,
    // or after they click the confirmation link if it's on). That's the
    // only point a session - and therefore an RLS-usable auth.uid() - is
    // guaranteed to exist, and it works the same way regardless of the
    // project's confirm-email setting.
    const { data: authData, error: authError } = await sb.auth.signUp({
      email, password,
      options: { data: {
        signup_type: 'professional',
        full_name: fullName,
        role,
        license_number: license || null,
        organization_name: org || null,
      } }
    });
    if(authError){
      errEl.style.color = '#FFA3B1';
      errEl.style.backgroundColor = 'rgba(229,85,110,.2)';
      errEl.style.borderColor = 'var(--berry)';
      errEl.textContent = getAuthErrorMsg(authError.message || authError.code);
      errEl.style.display = 'block';
      return;
    }

    if(!authData.session){
      errEl.style.color = '#B8E8B0';
      errEl.style.backgroundColor = 'rgba(124,197,118,.2)';
      errEl.style.borderColor = 'var(--success)';
      errEl.textContent = t.confirmationSentMessage;
      errEl.style.display = 'block';
      return;
    }
    // Auto-confirm is on: a session already exists, so onAuthStateChange
    // has already started (or is about to) creating the professionals row
    // and routing to the dashboard on its own - nothing left to do here.
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

async function handleLogout() {
  const t = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  if(!confirm(t.logoutConfirm)) return;
  flushSessionLog(); // persist whatever round is in progress while the session is still valid
  clearTimeout(window._semTimer); clearTimeout(window._semTimer2);
  clearInterval(window._huntTimer);
  await sb.auth.signOut();
  state.profileId = null;
  state.profile = null;
  document.getElementById('hubHeader').style.display = 'none';
  session.currentGameKey = null;
  session.sessionDirty = {};
  session.sessionSeedsStart = {};
  resetParentsDashboardState();
  resetPinGate();
}

function toggleAuthUserType() {
  authUserType = authUserType === 'family' ? 'professional' : 'family';
  authMode = 'login'; // sempre volta ao login ao trocar de tipo
  document.getElementById('authError').style.display = 'none';
  renderAuthScreen();
}

async function saveProfilesList(list){
  // Not used in Supabase version
}
async function loadProfileData(id){
  try{ 
    const { data, error } = await sb.from('child_profiles').select('*').eq('id', id).single();
    if(error) throw error;
    if(data) {
       return {
         name: data.name, avatar: AVATARS.includes(data.avatar) ? data.avatar : AVATARS[0], lang: data.lang,
         seeds: data.seeds, starsByGame: data.stars_by_game, difficultyByGame: data.difficulty_by_game,
         unlockedStickers: data.unlocked_stickers || []
       };
    }
    return null; 
  } catch(e){ 
    showError('Erro ao carregar dados. Verifique a conexão.');
    return null; 
  }
}
async function deleteProfileData(id){
  try{ 
    const { error } = await sb.from('child_profiles').delete().eq('id', id);
    if(error) throw error;
  }catch(e){
    showError('Erro ao excluir perfil. Verifique a conexão.');
  }
}


/* ============================================================
   PROFILES SCREEN
   ============================================================ */
let formLang = 'pt';
function selectFormLang(l){
  formLang = l;
  document.querySelectorAll('.lang-choice').forEach(el=>el.classList.toggle('selected', el.dataset.lang===l));
}
function toggleNewProfileForm(){
  const f = document.getElementById('newProfileForm');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}
async function submitNewProfile(){
  if(!state.familyId) return;
  const nameInput = document.getElementById('newProfileName');
  const name = nameInput.value.trim();
  if(!name) { nameInput.focus(); return; }
  const consentCheck = document.getElementById('newProfileConsentCheck');
  const consentError = document.getElementById('newProfileConsentError');
  const t = L();
  if(!consentCheck.checked){
    consentError.textContent = t.parentalConsentRequired;
    consentError.style.display = 'block';
    return;
  }
  consentError.style.display = 'none';
  const avatarEl = document.querySelector('.avatar-choice.selected');
  const avatar = avatarEl ? avatarEl.textContent : AVATARS[0];

  const data = defaultProfileData(name, avatar, formLang);

  const btn = document.getElementById('createProfileBtn');
  const ogText = btn.textContent;
  btn.textContent = '...';
  btn.disabled = true;

  try {
    const { data: newRow, error } = await sb.from('child_profiles').insert({
      family_id: state.familyId,
      name: name,
      avatar: avatar,
      lang: formLang,
      seeds: data.seeds,
      stars_by_game: data.starsByGame,
      difficulty_by_game: data.difficultyByGame,
      unlocked_stickers: data.unlockedStickers
    }).select().single();

    if(error) throw error;

    // Records the consent as an actual act tied to this specific child, not
    // just informational text - required by LGPD/GDPR for processing a
    // child's data. Best-effort: a failure here shouldn't block the parent
    // from using the profile they already paid for, but it is logged.
    const { error: consentInsertError } = await sb.from('parental_consents').insert({
      family_id: state.familyId,
      child_profile_id: newRow.id,
      terms_version: 'v1',
    });
    if(consentInsertError) console.error('Failed to record parental consent:', consentInsertError);

    nameInput.value = '';
    consentCheck.checked = false;
    document.getElementById('newProfileForm').style.display = 'none';
    await enterProfile(newRow.id, data);
  } catch(e) {
    showError('Erro ao criar perfil. Verifique a conexão.');
  }
  btn.textContent = ogText;
  btn.disabled = false;
}

async function renderProfilesScreen(){
  const list = await loadProfilesList();
  const grid = document.getElementById('profileGrid');
  grid.innerHTML = '';
  list.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'profile-card';
    card.innerHTML = `<button class="del-x" title="excluir" onclick="event.stopPropagation(); removeProfile('${p.id}')">✕</button>
      <div class="avatar">${AVATARS.includes(p.avatar) ? p.avatar : AVATARS[0]}</div><div class="pname">${escapeHtml(p.name)}</div>
      <div class="plang">${p.lang==='pt'?'🇧🇷 PT':'🇮🇹 IT'}</div>`;
    card.onclick = ()=>selectProfile(p.id);
    grid.appendChild(card);
  });
  const avatarRow = document.getElementById('avatarRow');
  avatarRow.innerHTML = '';
  AVATARS.forEach((a,i)=>{
    const el = document.createElement('div');
    el.className = 'avatar-choice' + (i===0?' selected':'');
    el.textContent = a;
    el.onclick = ()=>{ document.querySelectorAll('.avatar-choice').forEach(x=>x.classList.remove('selected')); el.classList.add('selected'); };
    avatarRow.appendChild(el);
  });
  applyProfilesScreenI18n();
}
function applyProfilesScreenI18n(){
  const t = I18N[state.lang] || I18N.pt;
  const ta = AUTH_I18N[state.lang] || AUTH_I18N.pt;
  document.title = t.pageTitle;
  document.getElementById('profilesTitle').textContent = t.profilesTitle;
  document.getElementById('profilesSubtitle').textContent = t.profilesSubtitle;
  document.getElementById('labelName').textContent = t.labelName;
  document.getElementById('newProfileName').placeholder = t.namePlaceholder;
  document.getElementById('labelAvatar').textContent = t.labelAvatar;
  document.getElementById('labelLang').textContent = t.labelLang;
  document.getElementById('newProfileConsentLabel').innerHTML = t.parentalConsentLabel;
  document.getElementById('createProfileBtn').textContent = t.createProfileBtn;
  document.getElementById('addProfileToggleBtn').textContent = t.addProfileBtn;
  document.querySelectorAll('.logout-btn').forEach(b => b.textContent = ta.logoutBtn);
  document.getElementById('footerNote').textContent = t.footer;
}
async function selectProfile(id){
  const data = await loadProfileData(id);
  if(!data) return;
  await enterProfile(id, data);
}
async function removeProfile(id){
  if(!confirm(I18N.pt.confirmDelete + ' / ' + I18N.it.confirmDelete)) return;
  await deleteProfileData(id);
  renderProfilesScreen();
}
async function enterProfile(id, data){
  state.profileId = id;
  state.profile = data;
  state.lang = data.lang || 'pt';
  document.getElementById('hubHeader').style.display = 'flex';
  goHub();
}
function goProfiles(){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-profiles').classList.add('active');
  document.getElementById('hubHeader').style.display = 'none';
  renderProfilesScreen();
}

/* ============================================================
   LANGUAGE SWITCH + GLOBAL UI
   ============================================================ */
function setLang(l){
  state.lang = l;
  if(state.profile){ state.profile.lang = l; saveProfileData(); }
  applyGlobalI18n();
  renderHub();
  say(L().mascotHub(state.profile ? state.profile.name : ''));
}
function applyGlobalI18n(){
  const t = L();
  document.getElementById('langBtnPt').classList.toggle('active', state.lang==='pt');
  document.getElementById('langBtnIt').classList.toggle('active', state.lang==='it');
  document.getElementById('appTitle').textContent = t.appTitle;
  document.title = t.pageTitle;
  document.getElementById('appTag').textContent = t.appTag;
  document.getElementById('seedsLabel').textContent = t.seedsLabel;
  document.getElementById('switchProfileBtn').textContent = t.switchProfile;
  renderSoundToggle();
  document.getElementById('parentsAreaBtnLabel').textContent = t.parents.areaTitle;
  document.getElementById('albumBtnLabel').textContent = t.album.title;
  document.getElementById('headerLogoutBtnLabel').textContent = t.logoutBtnLabel;
  document.getElementById('footerNote').textContent = t.footer;
  document.querySelectorAll('.backLabel').forEach(el=>el.textContent = t.backLabel);
  if(state.profile){
    document.getElementById('chipAvatar').textContent = state.profile.avatar;
    document.getElementById('chipName').textContent = state.profile.name;
    document.getElementById('seedCount').textContent = state.profile.seeds;
  }
}

function renderHub(){
  const t = L();
  const grid = document.getElementById('hubGrid');
  grid.innerHTML = '';
  GAME_KEYS.forEach(k=>{
    const tile = t.tiles[k];
    const div = document.createElement('div');
    div.className = 'tile'; div.tabIndex = 0;
    div.onclick = ()=>openGame(k);
    div.innerHTML = `<span class="emoji">${tile.emoji}</span><span class="skill">${tile.skill}</span>
      <h3>${tile.title}</h3><p>${tile.desc}</p><div class="stars-earned" id="stars-${k}"></div>`;
    grid.appendChild(div);
  });
  renderHubTileStars();
  document.getElementById('hubReadingBannerTitle').textContent = t.hubReadingBannerTitle;
  document.getElementById('hubReadingBannerDesc').textContent = t.hubReadingBannerDesc;
  document.getElementById('hubReadingBannerBtn').textContent = t.hubReadingBannerBtn;
}

async function openGame(key){
  flushSessionLog();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+key).classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
  session.currentGameKey = key;
  session.sessionSeedsStart[key] = state.profile.seeds;
  session.sessionDirty[key] = false;
  session.currentSessionId = crypto.randomUUID();
  session.sessionCompleted = false;
  await adjustDifficultyForSession(key);
  startSessionRow(key, session.currentSessionId);
  if(key==='semaforo') semInit();
  if(key==='memoria') simonInit();
  if(key==='historia') storyInit();
  if(key==='minhavez') chatInit();
  if(key==='cacaalvo') huntInit();
  if(key==='termometro') thermoInit();
}
async function startSessionRow(gameKey, sessionId){
  if(!state.profileId || !state.familyId) return;
  try{
    const { error } = await sb.from('game_sessions').insert({
      id: sessionId,
      family_id: state.familyId,
      profile_id: state.profileId,
      game_key: gameKey,
      difficulty: getDifficulty(gameKey),
      stars: 0,
      seeds_earned: 0
    });
    if(error) throw error;
  }catch(e){ /* best-effort; a failed log shouldn't block gameplay */ }
}
function goHub(){
  // No active child profile happens when a parent lands straight in the
  // parents area (via ?parents=1) without ever picking/creating one - there's
  // no hub to show them, so send them to pick/create a profile instead.
  if(!state.profile){
    goProfiles();
    return;
  }
  flushSessionLog();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-hub').classList.add('active');
  applyGlobalI18n();
  renderHub();
  say(L().mascotHub(state.profile.name));
  clearTimeout(window._semTimer); clearTimeout(window._semTimer2);
  clearInterval(window._huntTimer);
}


/* ========================= SESSION LOGGING (for parents area) ========================= */




/* ========================= STICKER ALBUM ========================= */
function openAlbum(){
  flushSessionLog();
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-album').classList.add('active');
  document.getElementById('albumTitle').textContent = '🖼️ ' + L().album.title;
  setInstructions('albumInstructions', L().album.instr);
  hideFeedback('albumFeedback');
  renderAlbum();
}
function renderAlbum(){
  const t = L();
  const unlocked = state.profile.unlockedStickers || [];
  document.getElementById('albumSummary').textContent = t.album.progress(unlocked.length, STICKERS.length);
  const grid = document.getElementById('albumGrid');
  grid.innerHTML = '';
  STICKERS.forEach(st=>{
    const isUnlocked = unlocked.includes(st.id);
    const name = st.name[state.lang] || st.name.pt;
    const card = document.createElement('div');
    card.className = `sticker-card tier-${st.tier} ${isUnlocked ? 'unlocked' : 'locked'}`;
    if(isUnlocked){
      card.innerHTML = `<span class="sticker-emoji">${st.emoji}</span><span class="sticker-name">${name}</span>`;
    } else {
      card.innerHTML = `<span class="sticker-emoji locked-emoji">${st.emoji}</span><span class="sticker-price">🌰 ${st.price}</span>`;
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.onclick = ()=>attemptUnlock(st.id);
    }
    grid.appendChild(card);
  });
}
function attemptUnlock(id){
  const t = L();
  const st = STICKERS.find(s=>s.id===id);
  if(!st) return;
  if(!state.profile.unlockedStickers) state.profile.unlockedStickers = [];
  if(state.profile.unlockedStickers.includes(id)) return;
  if(state.profile.seeds < st.price){
    showFeedback('albumFeedback', t.album.notEnough(st.price - state.profile.seeds), false);
    return;
  }
  state.profile.seeds -= st.price;
  state.profile.unlockedStickers.push(id);
  document.getElementById('seedCount').textContent = state.profile.seeds;
  saveProfileData();
  renderAlbum();
  const name = st.name[state.lang] || st.name.pt;
  showFeedback('albumFeedback', t.album.unlocked(name, st.emoji), true);
  say(t.mascotGood);
}

/* ========================= LANDING PAGE CTA ========================= */
// Lets vendas.html link straight into the signup form instead of login -
// authMode is read whenever renderAuthScreen() first runs, so setting it
// here (synchronous, top of the auth-state check) is enough.
// landOnParents is stashed in localStorage (not a plain variable) because a
// fresh signup has no session yet - the user has to go confirm their email
// first, which lands them back here on an entirely new page load once they
// click that link, and a mid-air variable wouldn't survive that round trip.
(function openSignupFromQueryParam(){
  const params = new URLSearchParams(window.location.search);
  let touched = false;
  if(params.get('signup') === '1'){
    authMode = 'signup';
    touched = true;
  }
  if(params.get('parents') === '1'){
    localStorage.setItem('ilhaDoFoco_landOnParents', '1');
    touched = true;
  }
  if(params.get('pro') === '1'){
    authUserType = 'professional';
    authMode = 'signup';
    touched = true;
  }
  const leadId = params.get('lead_id');
  if(leadId){
    localStorage.setItem('ilhaDoFoco_leadId', leadId);
    touched = true;
  }
  if(touched) history.replaceState({}, '', window.location.pathname);
})();

/* ========================= CHECKOUT REDIRECT ========================= */
(function handleCheckoutRedirect(){
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  if(!checkout) return;
  history.replaceState({}, '', window.location.pathname);
  if(checkout === 'success'){
    alert(L().checkoutSuccessMsg);
    if(document.getElementById('screen-parents')?.classList.contains('active')){
      renderParentsDashboardBody();
    }
  }
})();

/* ========================= AMBIENT + INIT ========================= */
(function initAmbient(){
  const emojis = ['🍃','🌿','🌴'];
  for(let i=0;i<8;i++){
    const el = document.createElement('div');
    el.className = 'ambient-leaf';
    el.textContent = emojis[Math.floor(Math.random()*emojis.length)];
    el.style.left = Math.random()*100 + 'vw';
    el.style.animationDelay = (Math.random()*14) + 's';
    el.style.animationDuration = (10 + Math.random()*10) + 's';
    document.body.appendChild(el);
  }
})();


  // Offline play + faster repeat loads - see sw.js for the caching strategy.
  // Registered after load, off the critical rendering path.
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  });

// index.html still calls dozens of these via inline onclick="..." (and a
// couple onchange=) HTML attributes - the browser evaluates those in global
// scope, which esbuild's IIFE bundle output does NOT leak function
// declarations into (everything above lives inside the bundle's wrapper
// closure). Without this, every button in the app would throw "X is not
// defined" the instant esbuild started bundling instead of just concatenating.
// List audited by scanning both index.html and this file's own generated-
// HTML template strings for every on(click|change|input|...)="..." attribute.
Object.assign(window, {
  chatContinue, chatStart, goHub, goProfiles, handleAuthSubmit, handleForgotPassword,
  handleGoogleLogin, handleLogout, huntShowPreStart, huntStart, huntTogglePace,
  logGameEvent, openAddChildProfileModal, openAlbum, openParents, parentsCancelForgot,
  parentsCheckPin, parentsForgotPin, parentsSavePin, removeProfile, selectFormLang,
  semStart, semTap, setAuthLang, setLang, simonStart, storyInit, storyStart,
  submitNewProfile, thermoStart, toggleAuthMode, toggleAuthUserType,
  toggleNewProfileForm, toggleSound,
});
