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
// Called right before opening the dashboard on a fresh login, so a
// previous session's selected child doesn't leak into this one.
export function resetProfDashboardSelection(){ profDashboardSelectedId = null; }

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
          <div class="prof-dash-sidebar-label">${t.linkedChildren}</div>
          <div id="profSidebarList"></div>
          <div class="prof-dash-redeem">
            <div class="prof-dash-sidebar-label">${t.redeemLabel}</div>
            <input type="text" id="profRedeemInput" class="prof-dash-redeem-input" placeholder="${t.redeemPlaceholder}">
            <button class="prof-dash-redeem-btn" id="profRedeemBtn">${t.redeemBtn}</button>
            <div id="profRedeemMsg" class="prof-dash-redeem-msg"></div>
          </div>
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

  renderProfSidebarList(container);

  container.querySelector('#profMethodologyLink').addEventListener('click', openMethodologyModal);

  container.querySelector('#profDashLangToggle').addEventListener('click', async ()=>{
    state.lang = state.lang === 'it' ? 'pt' : 'it';
    await renderProfDashboardFrame(container);
    if(profDashboardSelectedId) await loadAndRenderProfChildDetail(container);
  });

  container.querySelector('#profRedeemBtn').addEventListener('click', ()=>handleRedeemInviteCode(container));
  container.querySelector('#profRedeemInput').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') handleRedeemInviteCode(container);
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

function renderProfSidebarList(container){
  const t = L().prof;
  const listEl = container.querySelector('#profSidebarList');
  if(!listEl) return;
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
      await renderProfDashboardFrame(container); // already calls loadAndRenderProfChildDetail when profDashboardSelectedId is set
    });
  });
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
      renderProfSidebarList(container);
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
}
