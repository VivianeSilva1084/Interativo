// Read-only clinical dashboard for professionals (logopedista/psicólogo/
// professor) linked to a child via professional_child_links. Entered from
// app.js's sb.auth.onAuthStateChange handler when the logged-in user has a
// row in `professionals`. The parent-side "Convidar" button still has no
// action wired up, so links have to be created directly for now.
// Imports session-state.js, game-shared.js, i18n.js, lib/game-progress.js
// (GAME_KEYS) and lib/clinical-summary.js - never app.js or
// dashboards/parents-dashboard.js - so app.js can import
// openProfessionalDashboard without a circular dependency.
import { sb, state } from '../lib/session-state.js';
import { flushSessionLog, showError, escapeHtml, openDeleteAccountModal } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { GAME_KEYS } from '../lib/game-progress.js';
import { buildClinicalSummary, notifyReportReady } from '../lib/clinical-summary.js';
import { AVATARS } from '../lib/parents-data.js';
import { avatarImageSrc, normalizeAvatarKey } from '../lib/avatars.js';
import { isBrazil } from '../lib/billing.js';

// Versão da declaração de atestação de consentimento exibida na criação de
// perfil próprio (Módulo 14) - gravada em parental_consents.terms_version
// via create_owned_child_profile. Trocar este identificador se o TEXTO da
// declaração em i18n.js (consentAttestationLabel) mudar de sentido jurídico,
// para manter rastreável qual versão cada profissional aceitou de fato.
const CONSENT_ATTESTATION_VERSION = 'professional-attestation-v1';

// Explains to linked professionals how each clinical-panel metric is derived from
// raw gameplay data, and which established assessment instrument (if any) it echoes.
// Content mirrors state.lang so it stays in sync with the rest of the professional panel.
function openMethodologyModal(){
  const t = L().prof;
  const overlay = document.createElement('div');
  overlay.className = 'methodology-modal-overlay';
  overlay.innerHTML = `
    <div class="methodology-modal">
      <h3>📋 ${t.methodologyModalTitle}</h3>
      <p class="methodology-intro">${t.methodologyIntro}</p>
      <table>
        <thead><tr><th>${t.methodologyTableReportCol}</th><th>${t.methodologyTableBasisCol}</th></tr></thead>
        <tbody>
          ${t.methodologyReports.map(([name, basis])=>`<tr><td class="mth-report">${name}</td><td>${basis}</td></tr>`).join('')}
        </tbody>
      </table>
      <ul class="methodology-disclaimers">
        ${t.methodologyDisclaimers.map(d=>`<li>⚠️ ${d}</li>`).join('')}
      </ul>
      <div class="methodology-graphs">
        <h4 class="methodology-graphs-title">${t.methodologyGraphsTitle}</h4>
        <p class="methodology-graphs-intro">${t.methodologyGraphsIntro}</p>
        <ul>${t.methodologyGraphsBullets.map(b=>`<li>${b}</li>`).join('')}</ul>
      </div>
      <button type="button" class="methodology-modal-close" data-action="close">${t.methodologyCloseBtn}</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').onclick = close;
}

/* ========================= PROFESSIONAL DASHBOARD =========================
   Read-only portal for professionals (logopedista/psicólogo/professor) linked
   to a child via professional_child_links. Entered from sb.auth.onAuthStateChange
   when the logged-in user has a row in `professionals`. The parent-side
   "Convidar" button still has no action wired up, so links have to be
   created directly for now. */
let profDashboardChildren = [];
let profDashboardSelectedId = null;
let profActiveTab = 'linked'; // 'linked' | 'owned'
let profOwnedProfiles = [];
let profCapacity = { used: 0, limit: 3 };
let profSelectedIsOwned = false;
// Called right before opening the dashboard on a fresh login, so a
// previous session's selected child doesn't leak into this one.
export function resetProfDashboardSelection(){ profDashboardSelectedId = null; profActiveTab = 'linked'; profOwnedProfiles = []; profSelectedIsOwned = false; }

async function getOwnProfessionalId(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) throw new Error('no-session');
  const { data: professional, error } = await sb.from('professionals').select('id').eq('auth_user_id', user.id).single();
  if(error) throw error;
  return professional.id;
}

let profVerificationStatus = 'unverified';

async function loadProfVerificationStatus(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) throw new Error('no-session');
  const { data, error } = await sb.from('professionals').select('verification_status').eq('auth_user_id', user.id).single();
  if(error) throw error;
  return data.verification_status;
}

async function loadProfOwnedProfiles(){
  const professionalId = await getOwnProfessionalId();
  const [{ data: profiles, error }, { data: used }, { data: limit }] = await Promise.all([
    sb.from('child_profiles').select('id, name, avatar, access_suspended_at').eq('professional_id', professionalId).order('created_at', { ascending:true }),
    sb.rpc('professional_capacity_used', { p_professional_id: professionalId }),
    sb.rpc('professional_capacity_limit', { p_professional_id: professionalId }),
  ]);
  if(error) throw error;
  profCapacity = { used: used ?? 0, limit: limit ?? 3 };
  return (profiles || []).map(p=>({
    childId: p.id, name: p.name, avatar: p.avatar, suspended: !!p.access_suspended_at
  }));
}

export function openProfessionalDashboard(){
  flushSessionLog();
  document.getElementById('hubHeader').style.display = 'none';
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-professional').classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
  renderProfDashboardBody(document.getElementById('profDashboardContainer'));
}

async function loadProfDashboardChildren(){
  const { data: { user } } = await sb.auth.getUser();
  if(!user) throw new Error('no-session');

  const { data: professional, error: profErr } = await sb.from('professionals').select('id').eq('auth_user_id', user.id).single();
  if(profErr) throw profErr;

  const { data: links, error: linksErr } = await sb.from('professional_child_links')
    .select('id, status, child_profile_id, child_profiles(id, name)').eq('professional_id', professional.id);
  if(linksErr) throw linksErr;

  return (links || []).map(l=>({
    linkId: l.id, status: l.status, childId: l.child_profile_id, name: l.child_profiles?.name || '?'
  }));
}

async function loadProfDashboardChildDetail(childId){
  const [
    { data: profile }, { data: readingProgress }, { data: impulsivity }, { data: adherenceRows },
    { data: swaps }, { data: errorTypes }, { data: syllableDifficulty },
    { data: focusEvolution }, { data: responseTime }, { data: workingMemory },
    { data: ruleAdaptation }, { data: perseverativeErrors }, { data: frustration }, { data: waitCompliance }, { data: instructionFollowing }
  ] = await Promise.all([
    sb.from('child_profiles').select('*').eq('id', childId).single(),
    sb.from('reading_progress').select('*').eq('child_profile_id', childId).maybeSingle(),
    sb.from('v_impulsivity_index').select('indice').eq('profile_id', childId).maybeSingle(),
    sb.from('v_adherence_summary').select('game_key, semanas_com_dado, semanas_com_meta_atingida, taxa_adesao_pct').eq('profile_id', childId),
    // v_phonological_swaps/v_error_type_summary/v_syllable_difficulty, and all 7 clinical
    // views below, filter on has_premium_access(profile_id) at the DB level, so an empty
    // array here can mean either "no data yet" or "family isn't premium" - isPremium
    // (fetched below via RPC, since subscriptions itself isn't readable by professionals)
    // disambiguates the two.
    sb.from('v_phonological_swaps').select('expected, answered, occurrences').eq('profile_id', childId).order('occurrences', { ascending:false }).limit(5),
    sb.from('v_error_type_summary').select('error_type, occurrences').eq('profile_id', childId),
    sb.from('v_syllable_difficulty').select('syllable, accuracy_pct').eq('profile_id', childId).lt('accuracy_pct', 100).order('accuracy_pct', { ascending:true }).limit(5),
    sb.from('v_weekly_focus_evolution').select('game_key, week_start, avg_duration_seconds, max_duration_seconds, min_duration_seconds, avg_distractions').eq('profile_id', childId).order('week_start', { ascending:false }),
    sb.from('v_response_time_trend').select('game_key, month, avg_response_time_ms, best_response_time_ms, cv_response_time, n_trials').eq('profile_id', childId).order('month', { ascending:false }),
    sb.from('v_working_memory').select('game_key, longest_correct_sequence, avg_correct_length').eq('profile_id', childId),
    sb.from('v_rule_adaptation').select('game_key, time_to_adapt_ms').eq('profile_id', childId).not('time_to_adapt_ms', 'is', null),
    sb.from('v_perseverative_errors').select('game_key, perseverative_count').eq('profile_id', childId),
    sb.from('v_frustration_raw').select('game_key, abandons, help_requests, retries').eq('profile_id', childId),
    sb.from('v_wait_task_compliance').select('game_key, waited_correctly, clicked_early, total_attempts').eq('profile_id', childId),
    sb.from('v_instruction_following').select('game_key, followed_correctly, total_instructions, accuracy_pct').eq('profile_id', childId)
  ]);

  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const { data: sessions } = await sb.from('game_sessions').select('start_time, end_time')
    .eq('profile_id', childId).gte('start_time', sevenDaysAgo.toISOString()).not('end_time', 'is', null);

  // subscriptions is only readable by the family itself (RLS), so a professional
  // querying it directly always gets nothing back - use the has_premium_access()
  // RPC instead, which is SECURITY DEFINER and works for both family and professional.
  let isPremium = false;
  try{
    const { data } = await sb.rpc('has_premium_access', { p_child_profile_id: childId });
    isPremium = !!data;
  }catch(e){ /* best-effort; falls back to locked-card copy */ }

  const dayLabels = state.lang === 'it' ? ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'] : ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const usageByDay = dayLabels.map(d=>({ day: d, minutes: 0 }));
  (sessions || []).forEach(s=>{
    const start = new Date(s.start_time), end = new Date(s.end_time);
    usageByDay[start.getDay()].minutes += Math.max(0, (end - start) / 60000);
  });

  return {
    profile, readingProgress, impulsivityIndex: impulsivity?.indice ?? null,
    weeklyUsage: usageByDay.map(d=>({ ...d, minutes: Math.round(d.minutes) })),
    adherence: (adherenceRows || []).filter(a=>a.semanas_com_dado > 0),
    phonologicalSwaps: swaps || [], errorTypes: errorTypes || [], syllableDifficulty: syllableDifficulty || [],
    focusEvolution: focusEvolution || [], responseTime: responseTime || [], workingMemory: workingMemory || [],
    ruleAdaptation: ruleAdaptation || [], perseverativeErrors: perseverativeErrors || [], frustration: frustration || [],
    waitCompliance: waitCompliance || [], instructionFollowing: instructionFollowing || [],
    isPremium
  };
}

function renderProfStars(count, max = 3){
  let html = '';
  for(let i=0;i<max;i++) html += `<span class="prof-dash-star" style="color:${i < count ? '#C79A3D' : '#D8D0BC'}">★</span>`;
  return html;
}

async function renderProfDashboardBody(container){
  const t = L().prof;
  container.innerHTML = `<div class="prof-dash"><div style="padding:40px; text-align:center; color:#8A8067;">${t.loading}</div></div>`;

  let children;
  try{
    children = await loadProfDashboardChildren();
  }catch(e){
    container.innerHTML = `<div class="prof-dash"><div style="padding:40px; text-align:center; color:#8A8067;">${t.error}</div></div>`;
    return;
  }

  profDashboardChildren = children;

  // Best-effort - se falhar, a aba "Meus perfis" só aparece vazia/com erro
  // ao clicar, mas o fluxo de vínculo por convite (já existente) continua
  // funcionando normalmente.
  try{
    profOwnedProfiles = await loadProfOwnedProfiles();
    profVerificationStatus = await loadProfVerificationStatus();
  }catch(e){ profOwnedProfiles = []; }

  if(!profDashboardSelectedId && children.some(c=>c.status === 'active')){
    profDashboardSelectedId = children.find(c=>c.status === 'active').childId;
  }
  await renderProfDashboardFrame(container);
}

async function renderProfDashboardFrame(container){
  const t = L().prof;

  container.innerHTML = `
    <div class="prof-dash">
      <div class="prof-dash-topbar">
        <div>
          <div class="prof-dash-title">${t.title}</div>
          <div class="prof-dash-subtitle">${t.subtitle}</div>
        </div>
        <button class="prof-dash-lang-btn" id="profDashLangToggle">${state.lang === 'it' ? '🇮🇹' : '🇧🇷'}</button>
      </div>
      <div class="prof-dash-body">
        <div class="prof-dash-sidebar">
          <div style="display:flex; gap:6px; padding:0 18px 12px;">
            <button type="button" class="prof-dash-tab-btn${profActiveTab==='linked' ? ' selected' : ''}" id="profTabLinked" style="flex:1;">${t.linkedTab}</button>
            <button type="button" class="prof-dash-tab-btn${profActiveTab==='owned' ? ' selected' : ''}" id="profTabOwned" style="flex:1;">${t.ownedTab}</button>
          </div>
          <div id="profSidebarPane"></div>
          <div style="padding:18px 18px 0; text-align:center;">
            <button type="button" class="delete-account-link" id="profDeleteAccountBtn">${t.deleteAccountBtn}</button>
          </div>
        </div>
        <div class="prof-dash-detail" id="profDashDetail">
          <div style="color:#8A8067; text-align:center; margin-top:40px;">${t.selectChild}</div>
        </div>
      </div>
      <div class="prof-dash-footer">
        <span>🛡️ ${t.accessNote}</span>
        <button type="button" class="prof-dash-methodology-link" id="profMethodologyLink">📋 ${t.methodologyLinkLabel}</button>
      </div>
    </div>
  `;

  renderProfSidebarPane(container);

  container.querySelector('#profTabLinked').addEventListener('click', async ()=>{
    if(profActiveTab === 'linked') return;
    profActiveTab = 'linked';
    await renderProfDashboardFrame(container);
  });
  container.querySelector('#profTabOwned').addEventListener('click', async ()=>{
    if(profActiveTab === 'owned') return;
    profActiveTab = 'owned';
    await renderProfDashboardFrame(container);
  });

  container.querySelector('#profMethodologyLink').addEventListener('click', openMethodologyModal);

  container.querySelector('#profDashLangToggle').addEventListener('click', async ()=>{
    state.lang = state.lang === 'it' ? 'pt' : 'it';
    await renderProfDashboardFrame(container);
    if(profDashboardSelectedId) await loadAndRenderProfChildDetail(container);
  });

  container.querySelector('#profDeleteAccountBtn').addEventListener('click', ()=>{
    openDeleteAccountModal({
      warningHtml: t.deleteAccountWarning,
      onConfirm: async (close)=>{
        try{
          const { data, error } = await sb.rpc('delete_my_account');
          if(error) throw error;
          close();
          try{ await sb.auth.signOut(); }catch(e){ /* account row is already gone server-side; local cleanup is what matters */ }
          alert(t.accountDeletedMsg);
        }catch(err){
          close();
          showError(t.deleteAccountError);
        }
      }
    });
  });

  if(profDashboardSelectedId) await loadAndRenderProfChildDetail(container);
}

function renderProfSidebarPane(container){
  const pane = container.querySelector('#profSidebarPane');
  if(!pane) return;
  if(profActiveTab === 'owned'){
    renderProfOwnedPane(pane, container);
  } else {
    renderProfLinkedPane(pane, container);
  }
}

function renderProfLinkedPane(pane, container){
  const t = L().prof;
  pane.innerHTML = `
    <div class="prof-dash-sidebar-label">${t.linkedChildren}</div>
    <div id="profSidebarList"></div>
    <div class="prof-dash-redeem">
      <div class="prof-dash-sidebar-label">${t.redeemLabel}</div>
      <input type="text" id="profRedeemInput" class="prof-dash-redeem-input" placeholder="${t.redeemPlaceholder}">
      <button class="prof-dash-redeem-btn" id="profRedeemBtn">${t.redeemBtn}</button>
      <div id="profRedeemMsg" class="prof-dash-redeem-msg"></div>
    </div>
  `;

  refreshProfLinkedList(pane, container);

  pane.querySelector('#profRedeemBtn').addEventListener('click', ()=>handleRedeemInviteCode(container));
  pane.querySelector('#profRedeemInput').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') handleRedeemInviteCode(container);
  });
}

// Só o miolo da lista (#profSidebarList) - reaproveitado depois de resgatar
// um código, pra não recriar a caixa de convite inteira e apagar a mensagem
// de sucesso que acabou de ser escrita nela (renderProfLinkedPane faz isso).
function refreshProfLinkedList(pane, container){
  const t = L().prof;
  const listEl = pane.querySelector('#profSidebarList');
  listEl.innerHTML = profDashboardChildren.length === 0
    ? `<div style="padding: 12px 18px; font-size: 12.5px; color: #8A8067;">${t.noChildren}</div>`
    : profDashboardChildren.map(c=>`
      <button class="prof-dash-child-btn ${c.childId === profDashboardSelectedId ? 'active' : ''}"
        data-child-id="${c.childId}" ${c.status !== 'active' ? 'disabled' : ''}
        style="opacity:${c.status === 'active' ? 1 : 0.55}">
        <span class="prof-dash-child-name">${escapeHtml(c.name)}</span>
        ${c.status === 'pending' ? `<span class="prof-dash-pending-tag">${t.pending}</span>` : ''}
      </button>
    `).join('');

  listEl.querySelectorAll('.prof-dash-child-btn:not([disabled])').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      profDashboardSelectedId = btn.dataset.childId;
      profSelectedIsOwned = false;
      await renderProfDashboardFrame(container); // already calls loadAndRenderProfChildDetail when profDashboardSelectedId is set
    });
  });
}

async function handleUploadVerificationDoc(container, pane){
  const t = L().prof;
  const fileInput = pane.querySelector('#profVerificationFile');
  const btn = pane.querySelector('#profVerificationUploadBtn');
  const msgEl = pane.querySelector('#profVerificationMsg');
  const file = fileInput.files[0];
  if(!file){ return; }
  btn.disabled = true;
  msgEl.textContent = '';
  msgEl.className = 'prof-dash-redeem-msg';
  try{
    const professionalId = await getOwnProfessionalId();
    const path = `${professionalId}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await sb.storage.from('professional-verification-docs').upload(path, file, { upsert: true });
    if(uploadError) throw uploadError;

    const { error: updateError } = await sb.from('professionals')
      .update({ verification_status: 'pending', verification_document_path: path })
      .eq('id', professionalId);
    if(updateError) throw updateError;

    profVerificationStatus = 'pending';
    renderProfSidebarPane(container);
  }catch(e){
    msgEl.textContent = t.error;
    msgEl.className = 'prof-dash-redeem-msg error';
    btn.disabled = false;
  }
}

function renderProfOwnedPane(pane, container){
  const t = L().prof;

  if(profVerificationStatus !== 'verified'){
    pane.innerHTML = `
      <div class="prof-dash-sidebar-label">${t.verificationLabel}</div>
      <div style="padding:0 18px 14px; font-size:12.5px; color:#8A8067; line-height:1.5;">
        ${t.verificationStatusBody[profVerificationStatus] || t.verificationStatusBody.unverified}
      </div>
      ${profVerificationStatus !== 'pending' ? `
        <div style="padding:0 18px 14px;">
          <input type="file" id="profVerificationFile" accept="image/*,application/pdf" style="width:100%; font-size:12px; margin-bottom:8px;">
          <button type="button" class="prof-dash-redeem-btn" id="profVerificationUploadBtn" style="width:100%;">${t.verificationUploadBtn}</button>
          <div id="profVerificationMsg" class="prof-dash-redeem-msg"></div>
        </div>
      ` : ''}
    `;
    const uploadBtn = pane.querySelector('#profVerificationUploadBtn');
    if(uploadBtn) uploadBtn.addEventListener('click', ()=>handleUploadVerificationDoc(container, pane));
    return;
  }

  pane.innerHTML = `
    <div class="prof-dash-sidebar-label">${t.capacityLabel(profCapacity.used, profCapacity.limit)}</div>
    <div style="padding:0 18px 12px; display:flex; flex-direction:column; gap:8px;">
      <button type="button" class="prof-dash-redeem-btn" id="profNewProfileBtn">${t.newProfileBtn}</button>
      <button type="button" class="prof-dash-redeem-btn" id="profExpandCapacityBtn" style="background:transparent; color:var(--ink,#1F2E29); border:1.5px solid #D9CBA3;">${t.expandCapacityBtn}</button>
    </div>
    <div id="profOwnedList"></div>
  `;

  pane.querySelector('#profExpandCapacityBtn').addEventListener('click', openExpandCapacityModal);

  const listEl = pane.querySelector('#profOwnedList');
  listEl.innerHTML = profOwnedProfiles.length === 0
    ? `<div style="padding: 12px 18px; font-size: 12.5px; color: #8A8067;">${t.ownedNoProfiles}</div>`
    : profOwnedProfiles.map(p=>`
      <button class="prof-dash-child-btn ${p.childId === profDashboardSelectedId ? 'active' : ''}" data-child-id="${p.childId}">
        <span class="prof-dash-child-name"><img src="${avatarImageSrc(p.avatar)}" alt="" class="prof-dash-child-avatar-img"> ${escapeHtml(p.name)}</span>
        ${p.suspended ? `<span class="prof-dash-pending-tag">${t.suspendedBadge}</span>` : ''}
      </button>
    `).join('');

  listEl.querySelectorAll('.prof-dash-child-btn').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      profDashboardSelectedId = btn.dataset.childId;
      profSelectedIsOwned = true;
      await renderProfDashboardFrame(container);
    });
  });

  pane.querySelector('#profNewProfileBtn').addEventListener('click', ()=>openCreateOwnedProfileModal(container));
}

async function handleRedeemInviteCode(container){
  const t = L().prof;
  const input = container.querySelector('#profRedeemInput');
  const btn = container.querySelector('#profRedeemBtn');
  const msgEl = container.querySelector('#profRedeemMsg');
  const code = input.value.trim();
  if(!code) return;
  btn.disabled = true;
  msgEl.textContent = '';
  msgEl.className = 'prof-dash-redeem-msg';
  try{
    const { data, error } = await sb.rpc('redeem_invite_code', { p_code: code });
    if(error) throw error;
    if(data?.success){
      msgEl.textContent = t.redeemSuccess(data.child_name);
      msgEl.className = 'prof-dash-redeem-msg success';
      input.value = '';
      profDashboardChildren = await loadProfDashboardChildren();
      refreshProfLinkedList(container.querySelector('#profSidebarPane'), container);
    } else {
      msgEl.textContent = t.redeemErrors[data?.error] || t.error;
      msgEl.className = 'prof-dash-redeem-msg error';
    }
  }catch(e){
    msgEl.textContent = t.error;
    msgEl.className = 'prof-dash-redeem-msg error';
  }finally{
    btn.disabled = false;
  }
}

async function loadAndRenderProfChildDetail(container){
  const t = L().prof;
  const detailEl = container.querySelector('#profDashDetail');
  if(!detailEl) return;

  let detail;
  try{
    detail = await loadProfDashboardChildDetail(profDashboardSelectedId);
  }catch(e){
    detailEl.innerHTML = `<div style="color:#8A8067;">${t.error}</div>`;
    return;
  }

  const {
    profile, readingProgress, impulsivityIndex, weeklyUsage, adherence, phonologicalSwaps, errorTypes, syllableDifficulty,
    focusEvolution, responseTime, workingMemory, ruleAdaptation, perseverativeErrors, frustration, waitCompliance, instructionFollowing, isPremium
  } = detail;
  const ilhaDoFocoGames = Object.entries(profile?.stars_by_game || {}).filter(([k])=>GAME_KEYS.includes(k));
  const maxMinutes = Math.max(1, ...weeklyUsage.map(d=>d.minutes));
  const gameTitle = (key)=> key === 'aventura_das_letras' ? t.lettersIsland : (L().tiles[key]?.title || key);
  const lockedNote = `<div style="font-size:12.5px; color:#8A8067; line-height:1.5;">${t.lockedBody}</div>`;
  const noDataNote = `<div style="font-size:12.5px; color:#8A8067;">${t.noDataGeneric}</div>`;
  const adherenceRowsHtml = (adherence || []).map(a=>{
    const pct = Math.round(parseFloat(a.taxa_adesao_pct));
    return `<div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(a.game_key)}</span><span class="prof-dash-row-value">${pct}% (${a.semanas_com_meta_atingida}/${a.semanas_com_dado} ${t.adherenceGoalMet})</span></div>`;
  }).join('');

  // v_phonological_swaps/v_error_type_summary/v_syllable_difficulty are filtered by
  // has_premium_access() in the DB, so empty here means either "no data yet" (premium,
  // nothing to show) or "family isn't premium" (isPremium tells them apart).
  const hasPhoneticData = syllableDifficulty.length > 0 || phonologicalSwaps.length > 0 || errorTypes.length > 0;
  let phoneticHtml;
  if(!isPremium){
    phoneticHtml = `<div style="font-size:12.5px; color:#8A8067; line-height:1.5;">${t.lockedBody}</div>`;
  } else if(!hasPhoneticData){
    phoneticHtml = `<div style="font-size:12.5px; color:#8A8067;">${t.noPhoneticData}</div>`;
  } else {
    phoneticHtml = `
      ${syllableDifficulty.length ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11.5px; color:#8A8067; margin-bottom:6px; font-weight:700;">${t.hardestSyllables}</div>
          ${syllableDifficulty.map(s=>`<div class="prof-dash-row"><span class="prof-dash-row-label">${s.syllable}</span><span class="prof-dash-row-value">${s.accuracy_pct}%</span></div>`).join('')}
        </div>` : ''}
      ${phonologicalSwaps.length ? `
        <div style="margin-bottom:12px;">
          <div style="font-size:11.5px; color:#8A8067; margin-bottom:6px; font-weight:700;">${t.phonologicalSwaps}</div>
          ${phonologicalSwaps.map(s=>`<div class="prof-dash-row"><span class="prof-dash-row-label">${s.expected} ${t.swapArrow} ${s.answered}</span><span class="prof-dash-row-value">${s.occurrences}×</span></div>`).join('')}
        </div>` : ''}
      ${errorTypes.length ? `
        <div>
          <div style="font-size:11.5px; color:#8A8067; margin-bottom:6px; font-weight:700;">${t.errorTypesLabel}</div>
          ${errorTypes.map(e=>`<div class="prof-dash-row"><span class="prof-dash-row-label">${t.errorTypeNames[e.error_type] || e.error_type}</span><span class="prof-dash-row-value">${e.occurrences}</span></div>`).join('')}
        </div>` : ''}
    `;
  }

  // --- Atenção sustentada: semana mais recente por jogo (query já ordena week_start desc) ---
  const focusByGame = {};
  (focusEvolution || []).forEach(f=>{ if(!focusByGame[f.game_key]) focusByGame[f.game_key] = f; });
  let focusHtml;
  if(!isPremium) focusHtml = lockedNote;
  else if(Object.keys(focusByGame).length === 0) focusHtml = noDataNote;
  else focusHtml = Object.entries(focusByGame).map(([key, f])=>`
    <div style="margin-bottom:10px;">
      <div style="font-size:11.5px; color:#8A8067; font-weight:700; margin-bottom:4px;">${gameTitle(key)}</div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.focusAvg}</span><span class="prof-dash-row-value">${Math.round(f.avg_duration_seconds || 0)}${t.seconds}</span></div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.focusMax}</span><span class="prof-dash-row-value">${Math.round(f.max_duration_seconds || 0)}${t.seconds}</span></div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.focusMin}</span><span class="prof-dash-row-value">${Math.round(f.min_duration_seconds || 0)}${t.seconds}</span></div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.focusDistractions}</span><span class="prof-dash-row-value">${(f.avg_distractions || 0).toFixed(1)}</span></div>
    </div>
  `).join('');

  // --- Tempo de resposta: mês mais recente por jogo (query já ordena month desc) ---
  const responseByGame = {};
  (responseTime || []).forEach(r=>{ if(!responseByGame[r.game_key]) responseByGame[r.game_key] = r; });
  let responseTimeHtml;
  if(!isPremium) responseTimeHtml = lockedNote;
  else if(Object.keys(responseByGame).length === 0) responseTimeHtml = noDataNote;
  else responseTimeHtml = Object.entries(responseByGame).map(([key, r])=>`
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(key)} — ${t.responseTimeAvg}</span><span class="prof-dash-row-value">${Math.round(r.avg_response_time_ms || 0)}${t.ms}</span></div>
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(key)} — ${t.responseTimeBest}</span><span class="prof-dash-row-value">${Math.round(r.best_response_time_ms || 0)}${t.ms}</span></div>
    ${r.cv_response_time != null ? `<div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(key)} — ${t.responseTimeConsistency}</span><span class="prof-dash-row-value">${t.responseTimeConsistencyValue(r.cv_response_time, r.n_trials)}</span></div>` : ''}
  `).join('');

  // --- Memória de trabalho ---
  let workingMemoryHtml;
  if(!isPremium) workingMemoryHtml = lockedNote;
  else if((workingMemory || []).length === 0) workingMemoryHtml = noDataNote;
  else workingMemoryHtml = workingMemory.map(w=>`
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(w.game_key)} — ${t.workingMemoryLongest}</span><span class="prof-dash-row-value">${w.longest_correct_sequence ?? '-'}</span></div>
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(w.game_key)} — ${t.workingMemoryAvg}</span><span class="prof-dash-row-value">${w.avg_correct_length ? Number(w.avg_correct_length).toFixed(1) : '-'}</span></div>
  `).join('');

  // --- Flexibilidade cognitiva: média geral (não agrupado por jogo) ---
  // Two numbers, not one - per clinical review, raw adaptation time alone
  // can't distinguish "shifted quickly" from "got lucky right after the
  // switch"; perseverative-error count (taps back on the retired target,
  // outside the forgiveness grace window) is the more specific signal for
  // set-shifting difficulty and is tracked separately.
  const ruleAdaptationList = (ruleAdaptation || []).filter(r=>r.time_to_adapt_ms != null);
  const avgAdaptMs = ruleAdaptationList.length
    ? Math.round(ruleAdaptationList.reduce((sum,r)=>sum + r.time_to_adapt_ms, 0) / ruleAdaptationList.length)
    : null;
  const perseverationCount = (perseverativeErrors || []).reduce((sum,r)=>sum + (r.perseverative_count || 0), 0);
  let cognitiveFlexHtml;
  if(!isPremium) cognitiveFlexHtml = lockedNote;
  else if(avgAdaptMs === null) cognitiveFlexHtml = noDataNote;
  else cognitiveFlexHtml = `
    <div style="font-size:12.5px; color:#1F2E29;">${t.cognitiveFlexBody}: <strong>${avgAdaptMs}${t.ms}</strong></div>
    <div style="font-size:12.5px; color:#1F2E29; margin-top:4px;">${t.cognitiveFlexPersev(perseverationCount)}</div>
  `;

  // --- Tolerância à frustração ---
  let frustrationHtml;
  if(!isPremium) frustrationHtml = lockedNote;
  else if((frustration || []).length === 0) frustrationHtml = noDataNote;
  else frustrationHtml = frustration.map(f=>`
    <div style="margin-bottom:8px;">
      <div style="font-size:11.5px; color:#8A8067; font-weight:700; margin-bottom:4px;">${gameTitle(f.game_key)}</div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.frustrationAbandons}</span><span class="prof-dash-row-value">${f.abandons}</span></div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.frustrationHelp}</span><span class="prof-dash-row-value">${f.help_requests}</span></div>
      <div class="prof-dash-row"><span class="prof-dash-row-label">${t.frustrationRetries}</span><span class="prof-dash-row-value">${f.retries}</span></div>
    </div>
  `).join('');

  // --- Cumprimento de espera ---
  let waitHtml;
  if(!isPremium) waitHtml = lockedNote;
  else if((waitCompliance || []).length === 0) waitHtml = noDataNote;
  else waitHtml = waitCompliance.map(w=>`
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(w.game_key)} — ${t.waitCorrect}</span><span class="prof-dash-row-value">${w.waited_correctly}/${w.total_attempts}</span></div>
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(w.game_key)} — ${t.waitEarly}</span><span class="prof-dash-row-value">${w.clicked_early}</span></div>
  `).join('');

  // --- Seguir instruções ---
  let instructionHtml;
  if(!isPremium) instructionHtml = lockedNote;
  else if((instructionFollowing || []).length === 0) instructionHtml = noDataNote;
  else instructionHtml = instructionFollowing.map(i=>`
    <div class="prof-dash-row"><span class="prof-dash-row-label">${gameTitle(i.game_key)} — ${t.instructionAccuracy}</span><span class="prof-dash-row-value">${i.accuracy_pct}%</span></div>
  `).join('');

  detailEl.innerHTML = `
    <div class="prof-dash-grid2">
      <div class="prof-dash-card">
        <div class="prof-dash-card-header">🧩 <span class="prof-dash-card-title">${t.focusIsland}</span></div>
        ${ilhaDoFocoGames.length === 0
          ? `<div style="font-size:12.5px; color:#8A8067;">${t.none}</div>`
          : ilhaDoFocoGames.map(([key, stars])=>`
            <div class="prof-dash-row"><span class="prof-dash-row-label">${L().tiles[key]?.title || key}</span><span>${renderProfStars(stars)}</span></div>
          `).join('')}
      </div>
      <div class="prof-dash-card">
        <div class="prof-dash-card-header">📖 <span class="prof-dash-card-title">${t.lettersIsland}</span></div>
        <div class="prof-dash-row"><span class="prof-dash-row-label">${t.syllablesMastered}</span><span class="prof-dash-row-value">${readingProgress?.mastered_syllables?.length || t.none}</span></div>
        <div class="prof-dash-row"><span class="prof-dash-row-label">${t.wordsRead}</span><span class="prof-dash-row-value">${readingProgress?.read_words?.length || t.none}</span></div>
        <div class="prof-dash-row"><span class="prof-dash-row-label">${t.challenges}</span><span class="prof-dash-row-value">${readingProgress?.challenges_completed ?? 0}</span></div>
      </div>
    </div>

    <div class="prof-dash-card">
      <div class="prof-dash-card-header">🛡️ <span class="prof-dash-card-title">${t.impulsivityIndex}</span></div>
      <div class="prof-dash-impulsivity-badge" style="color:#4F7C64">
        ${impulsivityIndex !== null ? impulsivityIndex + '/100' : t.none}
      </div>
    </div>

    <div class="prof-dash-card">
      <div class="prof-dash-card-header">📅 <span class="prof-dash-card-title">${t.adherence}</span></div>
      ${adherenceRowsHtml || `<div style="font-size:12.5px; color:#8A8067;">${t.adherenceNoData}</div>`}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">🔬 <span class="prof-dash-card-title">${t.phoneticAnalysis}</span></div>
      ${phoneticHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">🎯 <span class="prof-dash-card-title">${t.focusDuration}</span></div>
      ${focusHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">⚡ <span class="prof-dash-card-title">${t.responseTimeTitle}</span>
        <span style="font-size:10px; color:#8A8067; margin-left:auto;">${t.responseTimeCaption}</span>
      </div>
      ${responseTimeHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">🧠 <span class="prof-dash-card-title">${t.workingMemoryTitle}</span></div>
      ${workingMemoryHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">🔄 <span class="prof-dash-card-title">${t.cognitiveFlexTitle}</span></div>
      ${cognitiveFlexHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">💪 <span class="prof-dash-card-title">${t.frustrationTitle}</span></div>
      ${frustrationHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">⏳ <span class="prof-dash-card-title">${t.waitTitle}</span></div>
      ${waitHtml}
    </div>

    <div class="prof-dash-card"${!isPremium ? ' style="border:1px dashed #C79A3D; background:#FFFBF0;"' : ''}>
      <div class="prof-dash-card-header">✅ <span class="prof-dash-card-title">${t.instructionTitle}</span></div>
      ${instructionHtml}
    </div>

    <div class="prof-dash-card" style="border-left:3px solid #C79A3D;">
      <div class="prof-dash-card-header">✨ <span class="prof-dash-card-title">${t.aiSummaryTitle}</span>
        <span style="font-size:10px; color:#8A8067; margin-left:auto;">${t.aiSummaryDisclaimer}</span>
      </div>
      <div style="font-size:13px; color:#1F2E29; line-height:1.7; font-style:italic;">
        ${isPremium ? buildClinicalSummary({ profile, focusEvolution, workingMemory, impulsivityIndex, syllableDifficulty, phonologicalSwaps, frustration, adherence, readingProgress }, state.lang) : t.lockedBody}
      </div>
    </div>

    <div class="prof-dash-card">
      <div class="prof-dash-card-header">⏱️ <span class="prof-dash-card-title">${t.weeklyUsage}</span></div>
      <div class="prof-dash-bar-chart">
        ${weeklyUsage.map(d=>`
          <div class="prof-dash-bar-col">
            <div class="prof-dash-bar" style="height:${(d.minutes / maxMinutes) * 80}px"></div>
            <div class="prof-dash-bar-label">${d.day}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  if(isPremium) notifyReportReady(profDashboardSelectedId);

  if(profSelectedIsOwned){
    renderOwnedManagementBar(container, detailEl, profDashboardSelectedId);
  }
}

/* ========================= "Meus perfis" (Módulo 14) =========================
   Autonomia total do profissional sobre perfis que ele mesmo cria (sem conta
   de família), com login por código - ver Termos de Uso seção 5. */

function renderOwnedManagementBar(container, detailEl, childId){
  const t = L().prof;
  const bar = document.createElement('div');
  bar.className = 'prof-dash-card';
  bar.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px; border-left:3px solid #4F7C64;';
  bar.innerHTML = `
    <button type="button" class="prof-dash-redeem-btn" id="profManageCodeBtn">🔑 ${t.manageCodeBtn}</button>
    <button type="button" class="prof-dash-redeem-btn" id="profResetBtn">🔄 ${t.resetProgressBtn}</button>
    <button type="button" class="prof-dash-redeem-btn" id="profDeleteProfileBtn" style="background:#B23A55;">🗑️ ${t.deleteProfileBtn}</button>
  `;
  detailEl.insertAdjacentElement('afterbegin', bar);

  bar.querySelector('#profManageCodeBtn').addEventListener('click', ()=>openAccessCodeManageModal(childId));
  bar.querySelector('#profResetBtn').addEventListener('click', ()=>{
    openSimpleConfirmModal({
      bodyHtml: t.resetProgressConfirm,
      danger: true,
      onConfirm: async (close)=>{
        try{
          const { error } = await sb.rpc('reset_child_progress', { p_child_profile_id: childId });
          if(error) throw error;
          close();
          alert(t.resetProgressSuccess);
          await loadAndRenderProfChildDetail(container);
        }catch(e){
          close();
          showError(t.error);
        }
      }
    });
  });
  bar.querySelector('#profDeleteProfileBtn').addEventListener('click', ()=>{
    openSimpleConfirmModal({
      bodyHtml: t.deleteProfileConfirmWarning,
      danger: true,
      onConfirm: async (close)=>{
        try{
          const { error } = await sb.rpc('delete_owned_child_profile', { p_child_profile_id: childId });
          if(error) throw error;
          close();
          profDashboardSelectedId = null;
          profOwnedProfiles = await loadProfOwnedProfiles();
          await renderProfDashboardFrame(container);
        }catch(e){
          close();
          showError(t.error);
        }
      }
    });
  });
}

// Modal de confirmação leve (uma etapa), reaproveitando as classes CSS de
// confirm-modal já usadas em openAddChildProfileModal/openDeleteAccountModal
// - diferente daquele, que é sempre de duas etapas e sobre a CONTA inteira.
function openSimpleConfirmModal({ bodyHtml, danger, onConfirm }){
  const t = L().prof;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>⚠️</h3>
      <p>${bodyHtml}</p>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.cancelBtn}</button>
        <button type="button" class="confirm-modal-btn-danger" data-action="confirm">${t.deleteProfileBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="cancel"]').onclick = close;
  overlay.querySelector('[data-action="confirm"]').onclick = ()=> onConfirm(close);
}

async function openAccessCodeManageModal(childId){
  const t = L().prof;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>🔑 ${t.manageCodeBtn}</h3>
      <button type="button" class="prof-dash-redeem-btn" id="profRotateCodeBtn" style="width:100%; margin-bottom:14px;">${t.rotateCodeBtn}</button>
      <div class="prof-dash-sidebar-label">${t.devicesLabel}</div>
      <div id="profDeviceList" style="text-align:left; margin:8px 0 14px;">…</div>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" data-action="close">${t.accessCodeCloseBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').onclick = close;

  async function refreshDevices(){
    const listEl = overlay.querySelector('#profDeviceList');
    const { data: devices } = await sb.from('child_access_sessions')
      .select('auth_user_id, device_label, last_seen_at').eq('child_profile_id', childId);
    listEl.innerHTML = !devices || devices.length === 0
      ? `<span style="font-size:12.5px; color:#8A8067;">${t.noDevices}</span>`
      : devices.map(d=>`
        <div class="prof-dash-row">
          <span class="prof-dash-row-label">${escapeHtml(d.device_label || new Date(d.last_seen_at).toLocaleDateString())}</span>
          <button type="button" class="delete-account-link" data-auth-user-id="${d.auth_user_id}">${t.disconnectBtn}</button>
        </div>
      `).join('');
    listEl.querySelectorAll('[data-auth-user-id]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        await sb.from('child_access_sessions').delete().eq('auth_user_id', btn.dataset.authUserId);
        refreshDevices();
      });
    });
  }
  await refreshDevices();

  overlay.querySelector('#profRotateCodeBtn').addEventListener('click', async ()=>{
    if(!confirm(t.rotateCodeConfirm)) return;
    try{
      const { data: code, error } = await sb.rpc('rotate_access_code', { p_child_profile_id: childId });
      if(error) throw error;
      close();
      openAccessCodeDisplayModal(code);
    }catch(e){
      showError(t.error);
    }
  });
}

function openAccessCodeDisplayModal(code){
  const t = L().prof;
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>🔑 ${t.accessCodeModalTitle}</h3>
      <p>${t.accessCodeModalBody}</p>
      <div style="font-size:28px; font-weight:800; letter-spacing:2px; text-align:center; padding:16px; background:#F6EFDF; border-radius:12px; margin:14px 0;">${escapeHtml(code)}</div>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" id="profCopyCodeBtn">${t.accessCodeCopyBtn}</button>
        <button type="button" class="confirm-modal-btn-danger" style="background:var(--leaf);" data-action="close">${t.accessCodeCloseBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="close"]').onclick = close;
  overlay.querySelector('#profCopyCodeBtn').addEventListener('click', async ()=>{
    try{ await navigator.clipboard.writeText(code); }catch(e){ /* clipboard API unavailable - user still sees the code on screen */ }
    const btn = overlay.querySelector('#profCopyCodeBtn');
    btn.textContent = t.accessCodeCopiedMsg;
    setTimeout(()=>{ btn.textContent = t.accessCodeCopyBtn; }, 2000);
  });
}

function openCreateOwnedProfileModal(container){
  const t = L().prof;
  let selectedAvatar = AVATARS[0];
  let selectedLang = state.lang === 'it' ? 'it' : 'pt';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal parents-add-profile-modal">
      <h3>${t.newProfileBtn}</h3>
      <label>${t.labelName}</label>
      <input type="text" class="pix-cpf-input" id="profNewProfileName" maxlength="20" placeholder="${t.namePlaceholder}">
      <label style="margin-top:14px;">${t.labelAvatar}</label>
      <div class="avatar-row" id="profNewProfileAvatarRow"></div>
      <label>${t.labelLang}</label>
      <div class="lang-row" id="profNewProfileLangRow">
        <div class="lang-choice ${selectedLang==='pt'?'selected':''}" data-lang="pt">🇧🇷 Português</div>
        <div class="lang-choice ${selectedLang==='it'?'selected':''}" data-lang="it">🇮🇹 Italiano</div>
      </div>
      <label style="display:flex; align-items:flex-start; gap:8px; text-align:left; font-size:12.5px; font-weight:400; margin-top:6px;">
        <input type="checkbox" id="profNewProfileConsentCheck" style="margin-top:2px; flex-shrink:0;">
        <span>${t.consentAttestationLabel}</span>
      </label>
      <p class="pix-cpf-error" id="profNewProfileError"></p>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.cancelBtn}</button>
        <button type="button" class="confirm-modal-btn-danger" style="background:var(--leaf);" data-action="create">${t.createBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="cancel"]').onclick = close;

  const avatarRow = overlay.querySelector('#profNewProfileAvatarRow');
  AVATARS.forEach((a,i)=>{
    const el = document.createElement('div');
    el.className = 'avatar-choice' + (i===0 ? ' selected' : '');
    el.innerHTML = `<img src="${avatarImageSrc(a)}" alt="" class="avatar-choice-img">`;
    el.onclick = ()=>{
      selectedAvatar = a;
      avatarRow.querySelectorAll('.avatar-choice').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
    };
    avatarRow.appendChild(el);
  });
  overlay.querySelectorAll('#profNewProfileLangRow .lang-choice').forEach(el=>{
    el.onclick = ()=>{
      selectedLang = el.dataset.lang;
      overlay.querySelectorAll('#profNewProfileLangRow .lang-choice').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
    };
  });

  const nameInput = overlay.querySelector('#profNewProfileName');
  const consentCheck = overlay.querySelector('#profNewProfileConsentCheck');
  const errEl = overlay.querySelector('#profNewProfileError');
  const createBtn = overlay.querySelector('[data-action="create"]');
  nameInput.focus();
  createBtn.onclick = async ()=>{
    const name = nameInput.value.trim();
    if(!name){ nameInput.focus(); return; }
    if(!consentCheck.checked){
      errEl.textContent = t.consentAttestationRequired;
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';
    createBtn.disabled = true;
    createBtn.textContent = '...';
    try{
      const { data, error } = await sb.rpc('create_owned_child_profile', {
        p_name: name, p_avatar: selectedAvatar, p_lang: selectedLang, p_terms_version: CONSENT_ATTESTATION_VERSION
      });
      if(error) throw error;
      close();
      profOwnedProfiles = await loadProfOwnedProfiles();
      profDashboardSelectedId = data.child_profile_id;
      profSelectedIsOwned = true;
      await renderProfDashboardFrame(container);
      openAccessCodeDisplayModal(data.access_code);
    }catch(err){
      createBtn.disabled = false;
      createBtn.textContent = t.createBtn;
      errEl.textContent = (err?.message || '').includes('capacity') ? t.capacityExceededError : t.error;
      errEl.style.display = 'block';
    }
  };
}

// Mesmo padrão de checkout já usado em src/lib/billing.js (startCheckout)
// pro plano de família - aqui chamando create-professional-checkout-session
// em vez de create-checkout-session. Preço é o mesmo (€9,90 / R$58,00) pro
// passe avulso e pro mensal em cada moeda (decisão já tomada); a única
// variável do lado do cliente é quantas crianças extras além das 8
// incluídas ele quer comprar. Moeda segue o mesmo isBrazil() (navigator.
// language) já usado pro checkout de família - sem endereço de cobrança
// coletado, é a mesma aproximação aceita lá.
function openExpandCapacityModal(){
  const t = L().prof;
  const country = isBrazil() ? 'BR' : 'INT';
  const symbol = country === 'BR' ? 'R$' : '€';
  const BASE_PRICE = country === 'BR' ? 58.00 : 9.90;
  const EXTRA_CHILD_PRICE = country === 'BR' ? 17.90 : 3.00;
  let selectedPlan = '30days';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>💳 ${t.expandCapacityModalTitle}</h3>
      <div class="lang-row" id="profPlanRow" style="margin-bottom:14px;">
        <div class="lang-choice selected" data-plan="30days">${t.planLabel30Days}</div>
        <div class="lang-choice" data-plan="monthly">${t.planLabelMonthly}</div>
      </div>
      <label style="display:block; text-align:left; font-size:12.5px; margin-bottom:6px;">${t.extraChildrenLabel}</label>
      <input type="number" id="profExtraChildrenInput" class="pix-cpf-input" min="0" step="1" value="0">
      <p style="text-align:left; font-weight:700; margin:12px 0 0;" id="profCheckoutTotal">${t.checkoutTotalLabel(BASE_PRICE, symbol)}</p>
      <p class="pix-cpf-error" id="profExpandCapacityError"></p>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.cancelBtn}</button>
        <button type="button" class="confirm-modal-btn-danger" style="background:var(--leaf);" data-action="continue">${t.continueToPaymentBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="cancel"]').onclick = close;

  const totalEl = overlay.querySelector('#profCheckoutTotal');
  const extraInput = overlay.querySelector('#profExtraChildrenInput');
  function updateTotal(){
    const extra = Math.max(0, parseInt(extraInput.value, 10) || 0);
    totalEl.textContent = t.checkoutTotalLabel(BASE_PRICE + extra * EXTRA_CHILD_PRICE, symbol);
  }
  extraInput.addEventListener('input', updateTotal);

  overlay.querySelectorAll('#profPlanRow .lang-choice').forEach(el=>{
    el.onclick = ()=>{
      selectedPlan = el.dataset.plan;
      overlay.querySelectorAll('#profPlanRow .lang-choice').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
    };
  });

  const continueBtn = overlay.querySelector('[data-action="continue"]');
  const errEl = overlay.querySelector('#profExpandCapacityError');
  continueBtn.onclick = async ()=>{
    errEl.style.display = 'none';
    continueBtn.disabled = true;
    const originalLabel = continueBtn.textContent;
    continueBtn.textContent = t.checkoutRedirecting;
    try{
      const { data: { session } } = await sb.auth.getSession();
      if(!session) throw new Error('no-session');
      const extraChildren = Math.max(0, parseInt(extraInput.value, 10) || 0);
      const response = await fetch('https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/create-professional-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan: selectedPlan, extraChildren, country }),
      });
      const result = await response.json();
      if(!response.ok || !result.url) throw new Error(result.error || 'checkout_failed');
      window.location.href = result.url;
    }catch(err){
      continueBtn.disabled = false;
      continueBtn.textContent = originalLabel;
      errEl.textContent = t.error;
      errEl.style.display = 'block';
    }
  };
}
