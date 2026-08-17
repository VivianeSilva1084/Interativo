// The parents dashboard: per-child tabs, seeds/session summary, per-game
// star-history charts, weekly screen-time chart, adherence, linked-
// professionals + invite codes, the Premium clinical-summary card (or its
// paywall conversion card), and the danger zone (reset progress / delete
// account). Entered by pin-gate.js's parentsSavePin/parentsCheckPin once the
// PIN gate is passed. Imports session-state.js, game-shared.js, i18n.js,
// lib/game-progress.js, lib/clinical-summary.js, lib/billing.js and
// lib/parents-data.js - never pin-gate.js, professional-dashboard.js or
// app.js - so pin-gate.js and app.js can both import parentsOpenDashboard/
// openAddChildProfileModal without a circular dependency.
import { sb, state } from '../lib/session-state.js';
import { showError, escapeHtml, openDeleteAccountModal } from '../lib/game-shared.js';
import { L } from '../lib/i18n.js';
import { GAME_KEYS, defaultProfileData } from '../lib/game-progress.js';
import { buildClinicalSummary, notifyReportReady } from '../lib/clinical-summary.js';
import { isBrazil, startCheckout, openPixCpfModal, manageSubscription } from '../lib/billing.js';
import {
  AVATARS, loadProfilesList, loadSessions, getChildDifficulty, loadReadingProgress, loadSubscription,
  loadLinkedProfessionals, loadPendingProfessionalRequests, generateInviteCode, respondToProfessionalLink,
  loadAdherence, loadImpulsivityIndex, loadClinicalSummaryExtras, computeWeeklyUsage,
} from '../lib/parents-data.js';
import { avatarImageSrc } from '../lib/avatars.js';

let parentsChildren = [];
let parentsActiveChildId = null;
export function resetParentsDashboardState(){ parentsChildren = []; parentsActiveChildId = null; }

// Guards against overlapping renders (e.g. a double-tap on the child tab, or
// the initial dashboard load racing a checkout-redirect refresh): each call
// takes a token, and only the LATEST call is allowed to touch the DOM once
// its awaits resolve. Without this, two overlapping calls could each finish
// their own body.innerHTML='' + full render, with the second one's content
// appended on top of the first's instead of replacing it - the whole body
// (danger zone, clinical summary, everything) would render twice.
let parentsDashboardRenderToken = 0;

function renderWeeklyChart(container, minutesByDay, dayLabels){
  container.innerHTML = '';
  const bars = document.createElement('div');
  bars.className = 'weekly-bars';
  const max = Math.max(1, ...minutesByDay);
  minutesByDay.forEach((m,i)=>{
    const col = document.createElement('div');
    col.className = 'weekly-bar-col';
    const bar = document.createElement('div');
    bar.className = 'weekly-bar';
    bar.style.height = `${Math.max(3, (m/max)*100)}%`;
    bar.title = `${m} min`;
    const label = document.createElement('div');
    label.className = 'weekly-bar-label';
    label.textContent = dayLabels[i];
    col.appendChild(bar);
    col.appendChild(label);
    bars.appendChild(col);
  });
  container.appendChild(bars);
}

export async function parentsOpenDashboard(){
  document.getElementById('parentsGate').style.display = 'none';
  document.getElementById('parentsDashboard').style.display = 'block';
  document.getElementById('parentsAddProfileBtn').textContent = '➕ ' + L().addProfileBtn;
  parentsChildren = await loadProfilesList();
  const tabsWrap = document.getElementById('parentsChildTabs');
  const body = document.getElementById('parentsDashboardBody');
  if(!parentsChildren.length){
    tabsWrap.innerHTML = '';
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = L().parents.noChildren;
    body.appendChild(p);
    return;
  }
  if(!parentsChildren.some(c=>c.id === parentsActiveChildId)) parentsActiveChildId = parentsChildren[0].id;
  renderParentsChildTabs();
  await renderParentsDashboardBody();
}
function renderParentsChildTabs(){
  const wrap = document.getElementById('parentsChildTabs');
  wrap.innerHTML = '';
  if(parentsChildren.length < 2) return;
  parentsChildren.forEach(c=>{
    const btn = document.createElement('button');
    btn.className = 'diff-btn' + (c.id === parentsActiveChildId ? ' selected' : '');
    btn.innerHTML = `<img src="${avatarImageSrc(c.avatar)}" alt="" class="child-tab-avatar-img"> ${escapeHtml(c.name)}`;
    btn.onclick = async ()=>{
      parentsActiveChildId = c.id;
      renderParentsChildTabs();
      await renderParentsDashboardBody();
    };
    wrap.appendChild(btn);
  });
}

// Lets parents create a child profile from inside the (PIN-gated) parents
// dashboard, for families who land here straight from the marketing funnel
// (?parents=1) and never touch the child-facing "Quem vai jogar hoje?"
// screen - profile creation should be a parent action, not a child one.
export function openAddChildProfileModal(){
  const t = L();
  let selectedAvatar = AVATARS[0];
  let selectedLang = state.lang === 'it' ? 'it' : 'pt';

  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal parents-add-profile-modal">
      <h3>➕ ${t.addProfileBtn}</h3>
      <label>${t.labelName}</label>
      <input type="text" class="pix-cpf-input" id="parentsNewProfileName" maxlength="20" placeholder="${t.namePlaceholder}">
      <label style="margin-top:14px;">${t.labelAvatar}</label>
      <div class="avatar-row" id="parentsNewProfileAvatarRow"></div>
      <label>${t.labelLang}</label>
      <div class="lang-row" id="parentsNewProfileLangRow">
        <div class="lang-choice ${selectedLang==='pt'?'selected':''}" data-lang="pt">🇧🇷 Português</div>
        <div class="lang-choice ${selectedLang==='it'?'selected':''}" data-lang="it">🇮🇹 Italiano</div>
      </div>
      <label style="display:flex; align-items:flex-start; gap:8px; text-align:left; font-size:12.5px; font-weight:400; margin-top:6px;">
        <input type="checkbox" id="parentsNewProfileConsentCheck" style="margin-top:2px; flex-shrink:0;">
        <span>${t.parentalConsentLabel}</span>
      </label>
      <p class="pix-cpf-error" id="parentsNewProfileError"></p>
      <div class="confirm-modal-actions">
        <button type="button" class="confirm-modal-btn-secondary" data-action="cancel">${t.parents.pixCpfCancelBtn}</button>
        <button type="button" class="confirm-modal-btn-danger" style="background:var(--leaf);" data-action="create">${t.createProfileBtn}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = ()=> overlay.remove();
  overlay.addEventListener('click', (e)=>{ if(e.target === overlay) close(); });
  overlay.querySelector('[data-action="cancel"]').onclick = close;

  const avatarRow = overlay.querySelector('#parentsNewProfileAvatarRow');
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
  overlay.querySelectorAll('#parentsNewProfileLangRow .lang-choice').forEach(el=>{
    el.onclick = ()=>{
      selectedLang = el.dataset.lang;
      overlay.querySelectorAll('#parentsNewProfileLangRow .lang-choice').forEach(x=>x.classList.remove('selected'));
      el.classList.add('selected');
    };
  });

  const nameInput = overlay.querySelector('#parentsNewProfileName');
  const consentCheck = overlay.querySelector('#parentsNewProfileConsentCheck');
  const errEl = overlay.querySelector('#parentsNewProfileError');
  const createBtn = overlay.querySelector('[data-action="create"]');
  nameInput.focus();
  createBtn.onclick = async ()=>{
    const name = nameInput.value.trim();
    if(!name){ nameInput.focus(); return; }
    if(!consentCheck.checked){
      errEl.textContent = t.parentalConsentRequired;
      errEl.style.display = 'block';
      return;
    }
    errEl.style.display = 'none';
    createBtn.disabled = true;
    createBtn.textContent = '...';
    const data = defaultProfileData(name, selectedAvatar, selectedLang);
    try{
      const { data: newRow, error } = await sb.from('child_profiles').insert({
        family_id: state.familyId,
        name: name,
        avatar: selectedAvatar,
        lang: selectedLang,
        seeds: data.seeds,
        stars_by_game: data.starsByGame,
        difficulty_by_game: data.difficultyByGame,
        unlocked_stickers: data.unlockedStickers
      }).select().single();
      if(error) throw error;
      // Best-effort, same as the child-facing "criar perfil" flow - a failure
      // here shouldn't block the parent from using the profile, but is logged.
      const { error: consentInsertError } = await sb.from('parental_consents').insert({
        family_id: state.familyId,
        child_profile_id: newRow.id,
        terms_version: 'v1',
      });
      if(consentInsertError) console.error('Failed to record parental consent:', consentInsertError);
      close();
      parentsChildren = await loadProfilesList();
      parentsActiveChildId = newRow.id;
      renderParentsChildTabs();
      await renderParentsDashboardBody();
    }catch(e){
      errEl.textContent = t.parents.dashboardError;
      errEl.style.display = 'block';
      createBtn.disabled = false;
      createBtn.textContent = t.createProfileBtn;
    }
  };
}
async function renderParentsDashboardBody(){
  const myToken = ++parentsDashboardRenderToken;
  const t = L();
  const body = document.getElementById('parentsDashboardBody');
  const child = parentsChildren.find(c=>c.id === parentsActiveChildId);
  if(!child){ if(myToken === parentsDashboardRenderToken) body.innerHTML = ''; return; }

  try{
    const { data: { session } } = await sb.auth.getSession();
    if(!session) throw new Error('no-session');
  }catch(e){
    if(myToken !== parentsDashboardRenderToken) return; // a newer render started meanwhile - let it win
    body.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'parents-dash-error';
    err.innerHTML = `<p>${t.parents.sessionExpired}</p>`;
    body.appendChild(err);
    return;
  }

  let sessions, reading, subscription, professionals, adherence, pendingRequests;
  try{
    [sessions, reading, subscription, professionals, adherence, pendingRequests] = await Promise.all([
      loadSessions(child.id),
      loadReadingProgress(child.id),
      loadSubscription(state.familyId),
      loadLinkedProfessionals(child.id),
      loadAdherence(child.id),
      loadPendingProfessionalRequests(child.id)
    ]);
  }catch(e){
    if(myToken !== parentsDashboardRenderToken) return; // a newer render started meanwhile - let it win
    body.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'parents-dash-error';
    err.innerHTML = `<p>${t.parents.dashboardError}</p>`;
    const retryBtn = document.createElement('button');
    retryBtn.className = 'big-cta';
    retryBtn.textContent = t.parents.retryBtn;
    retryBtn.onclick = renderParentsDashboardBody;
    err.appendChild(retryBtn);
    body.appendChild(err);
    return;
  }

  if(myToken !== parentsDashboardRenderToken) return; // a newer render started meanwhile - let it win
  body.innerHTML = '';

  const locale = state.lang === 'it' ? 'it-IT' : 'pt-BR';
  // game_sessions is shared with Aventura das Letras (game_key: 'aventura_das_letras'),
  // so the Ilha do Foco summary/grid must filter down to this app's own game keys.
  const ilhaDoFocoSessions = sessions.filter(s=>GAME_KEYS.includes(s.game_key));

  const isPremium = subscription?.plan === 'premium';
  if(isPremium){
    const topline = document.createElement('div');
    topline.className = 'parents-topline';
    topline.innerHTML = `
      <span class="parents-premium-badge">👑 ${t.parents.premiumBadge}</span>
      <button type="button" class="parents-manage-sub-btn">${t.parents.manageSubBtn}</button>
    `;
    topline.querySelector('.parents-manage-sub-btn').addEventListener('click', (e)=> manageSubscription(e.currentTarget));
    body.appendChild(topline);
  }

  const masteredSyllables = reading?.mastered_syllables || [];
  if(masteredSyllables.length > 0){
    const tip = document.createElement('div');
    tip.className = 'parents-tip';
    tip.innerHTML = `<span class="tip-emoji">🦫</span><div><div class="tip-title">${t.parents.kapiTipTitle}</div><div class="tip-text">${t.parents.kapiTip(escapeHtml(child.name), masteredSyllables.length)}</div></div>`;
    body.appendChild(tip);
  }

  const summary = document.createElement('div');
  summary.className = 'parents-summary';
  const lastPlayed = ilhaDoFocoSessions.length ? new Date(ilhaDoFocoSessions[ilhaDoFocoSessions.length-1].played_at).toLocaleDateString(locale) : t.parents.never;
  summary.innerHTML = `
    <div class="parents-stat"><span class="v">🌰 ${child.seeds || 0}</span><span class="l">${t.parents.statsSeeds}</span></div>
    <div class="parents-stat"><span class="v">${ilhaDoFocoSessions.length}</span><span class="l">${t.parents.statsSessions}</span></div>
    <div class="parents-stat"><span class="v">${lastPlayed}</span><span class="l">${t.parents.statsLast}</span></div>`;
  body.appendChild(summary);

  // ---- Aventura das Letras ----
  const readingTitle = document.createElement('div');
  readingTitle.className = 'parents-section-title';
  readingTitle.innerHTML = `📚 ${t.parents.readingTitle}`;
  body.appendChild(readingTitle);
  const readingSubtitle = document.createElement('div');
  readingSubtitle.className = 'parents-section-subtitle';
  readingSubtitle.textContent = t.parents.readingSubtitle;
  body.appendChild(readingSubtitle);

  const readingOpenLink = document.createElement('a');
  readingOpenLink.className = 'parents-reading-open-btn';
  readingOpenLink.href = 'https://jogo-pra-tdh.vercel.app/';
  readingOpenLink.target = '_blank';
  readingOpenLink.rel = 'noopener';
  readingOpenLink.textContent = t.parents.readingOpenBtn;
  body.appendChild(readingOpenLink);

  const readingCard = document.createElement('div');
  readingCard.className = 'parents-reading-card';
  if(!reading){
    readingCard.innerHTML = `<p class="chart-empty">${t.parents.notPlayedHere}</p>`;
  } else {
    let html = '';
    if(masteredSyllables.length){
      html += `<div class="parents-reading-label">${t.parents.readingMasteredLabel}</div>
        <div class="syllable-chips">${masteredSyllables.map(s=>`<span class="syllable-chip">${s}</span>`).join('')}</div>`;
    }
    html += `<div class="parents-reading-row"><span>${t.parents.readingWordsRead}</span><span>${reading.read_words?.length ?? 0}</span></div>`;
    html += `<div class="parents-reading-row"><span>${t.parents.readingChallenges}</span><span>${reading.challenges_completed ?? 0}</span></div>`;
    readingCard.innerHTML = html;
  }
  body.appendChild(readingCard);

  // ---- Ilha do Foco ----
  const gridTitle = document.createElement('div');
  gridTitle.className = 'parents-section-title';
  gridTitle.innerHTML = `🧩 ${t.parents.ilhaDoFocoTitle}`;
  body.appendChild(gridTitle);
  const gridSubtitle = document.createElement('div');
  gridSubtitle.className = 'parents-section-subtitle';
  gridSubtitle.textContent = t.parents.ilhaDoFocoSubtitle;
  body.appendChild(gridSubtitle);

  const ilhaDoFocoOpenLink = document.createElement('a');
  ilhaDoFocoOpenLink.className = 'parents-reading-open-btn';
  ilhaDoFocoOpenLink.href = 'https://interativo-pi.vercel.app/';
  ilhaDoFocoOpenLink.target = '_blank';
  ilhaDoFocoOpenLink.rel = 'noopener';
  ilhaDoFocoOpenLink.textContent = t.parents.ilhaDoFocoOpenBtn;
  body.appendChild(ilhaDoFocoOpenLink);

  if(ilhaDoFocoSessions.length === 0){
    const empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = t.parents.notPlayedHere;
    body.appendChild(empty);
  } else {
    const grid = document.createElement('div');
    grid.className = 'parents-grid';
    GAME_KEYS.forEach(key=>{
      const gameSessions = ilhaDoFocoSessions.filter(s=>s.game_key === key);
      const tile = t.tiles[key];
      const card = document.createElement('div');
      card.className = 'parents-card';
      const head = document.createElement('div');
      head.className = 'parents-card-head';
      head.innerHTML = `<span class="emoji">${tile.emoji}</span><span class="title">${tile.title}</span><span class="diff-tag">${t.diff[getChildDifficulty(child, key)]}</span>`;
      card.appendChild(head);
      const chartWrap = document.createElement('div');
      chartWrap.className = 'trend-chart-wrap';
      card.appendChild(chartWrap);
      renderTrendChart(chartWrap, gameSessions);
      if(gameSessions.length){
        const list = document.createElement('ul');
        list.className = 'parents-recent';
        gameSessions.slice(-3).reverse().forEach(s=>{
          const li = document.createElement('li');
          const d = new Date(s.played_at).toLocaleDateString(locale);
          li.textContent = `${d} — ${'⭐'.repeat(s.stars)}${'☆'.repeat(3-s.stars)} — ${t.diff[s.difficulty] || s.difficulty}`;
          list.appendChild(li);
        });
        card.appendChild(list);
      }
      grid.appendChild(card);
    });
    body.appendChild(grid);
  }

  // ---- Weekly screen time ----
  const weeklyTitle = document.createElement('div');
  weeklyTitle.className = 'parents-section-title';
  weeklyTitle.innerHTML = `⏱️ ${t.parents.weeklyUsageTitle}`;
  body.appendChild(weeklyTitle);

  const weeklyCard = document.createElement('div');
  weeklyCard.className = 'weekly-chart-card';
  renderWeeklyChart(weeklyCard, computeWeeklyUsage(sessions), t.parents.dayLabels);
  body.appendChild(weeklyCard);

  // ---- Adherence (last 9 weeks) ----
  const adherenceTitle = document.createElement('div');
  adherenceTitle.className = 'parents-section-title';
  adherenceTitle.innerHTML = `📅 ${t.parents.adherenceTitle}`;
  body.appendChild(adherenceTitle);

  const adherenceCard = document.createElement('div');
  adherenceCard.className = 'parents-card';
  if(adherence.length === 0){
    adherenceCard.innerHTML = `<p class="chart-empty">${t.parents.adherenceNone}</p>`;
  } else {
    adherenceCard.innerHTML = adherence.map(r=>{
      const pct = Math.round(parseFloat(r.taxa_adesao_pct));
      const gameLabel = r.game_key === 'aventura_das_letras' ? t.parents.readingTitle : (t.tiles[r.game_key]?.title || r.game_key);
      const phrase = pct >= 100 ? t.parents.adherenceSupportHigh : pct >= 50 ? t.parents.adherenceSupportMid : t.parents.adherenceSupportLow;
      return `<div class="parents-adherence-row">
        <div class="parents-adherence-line">${t.parents.adherenceLine(gameLabel, pct, r.semanas_com_meta_atingida, r.semanas_com_dado)}</div>
        <div class="parents-adherence-phrase">${phrase}</div>
      </div>`;
    }).join('');
  }
  body.appendChild(adherenceCard);

  // ---- Linked professionals ----
  const profTitle = document.createElement('div');
  profTitle.className = 'parents-section-title';
  profTitle.innerHTML = `🛡️ ${t.parents.professionalsTitle}`;
  body.appendChild(profTitle);

  if(pendingRequests.length){
    const pendingWrap = document.createElement('div');
    pendingWrap.className = 'parents-pending-requests';
    pendingRequests.forEach(req=>{
      const row = document.createElement('div');
      row.className = 'parents-pending-row';
      const name = escapeHtml(req.professionals?.full_name || '?');
      const role = req.professionals?.role ? (t.parents.professionalRoles[req.professionals.role] || req.professionals.role) : '';
      row.innerHTML = `
        <div class="txt"><strong>${name}</strong>${role ? ` — ${role}` : ''}</div>
        <div class="parents-pending-actions">
          <button class="parents-approve-btn">${t.parents.approveBtn}</button>
          <button class="parents-reject-btn">${t.parents.rejectBtn}</button>
        </div>
      `;
      const setBusy = (busy)=> row.querySelectorAll('button').forEach(b=>b.disabled = busy);
      row.querySelector('.parents-approve-btn').addEventListener('click', async ()=>{
        setBusy(true);
        try{ await respondToProfessionalLink(req.id, true); await renderParentsDashboardBody(); }
        catch(e){ setBusy(false); }
      });
      row.querySelector('.parents-reject-btn').addEventListener('click', async ()=>{
        setBusy(true);
        try{ await respondToProfessionalLink(req.id, false); await renderParentsDashboardBody(); }
        catch(e){ setBusy(false); }
      });
      pendingWrap.appendChild(row);
    });
    body.appendChild(pendingWrap);
  }

  const profCard = document.createElement('div');
  profCard.className = 'parents-professionals-card';
  const namesText = professionals.length
    ? professionals.map(p=>escapeHtml(p.professionals?.full_name)).filter(Boolean).join(', ')
    : t.parents.professionalsNone(escapeHtml(child.name));
  profCard.innerHTML = `<div class="txt">${namesText}</div><button class="parents-invite-btn">➕ ${t.parents.inviteBtn}</button>`;
  body.appendChild(profCard);

  const inviteCodeWrap = document.createElement('div');
  inviteCodeWrap.style.display = 'none';
  body.appendChild(inviteCodeWrap);

  profCard.querySelector('.parents-invite-btn').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t.parents.generatingCode;
    try{
      const code = await generateInviteCode(child.id);
      inviteCodeWrap.style.display = 'block';
      inviteCodeWrap.innerHTML = `
        <div class="parents-invite-code-card">
          <div class="invite-code-value">${code}</div>
          <button class="parents-copy-btn">${t.parents.copyCodeBtn}</button>
          <p class="invite-code-hint">${t.parents.inviteCodeHint}</p>
        </div>
      `;
      inviteCodeWrap.querySelector('.parents-copy-btn').addEventListener('click', async ()=>{
        const copyBtn = inviteCodeWrap.querySelector('.parents-copy-btn');
        try{ await navigator.clipboard.writeText(code); }catch(err){ /* clipboard may be unavailable; code is still shown on screen */ }
        copyBtn.textContent = t.parents.copiedLabel;
        setTimeout(()=>{ copyBtn.textContent = t.parents.copyCodeBtn; }, 1800);
      });
    }catch(err){
      inviteCodeWrap.style.display = 'block';
      inviteCodeWrap.innerHTML = `<p class="chart-empty">${t.parents.inviteCodeError}</p>`;
    }finally{
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });

  // ---- Clinical report (premium) ----
  const clinicalTitle = document.createElement('div');
  clinicalTitle.className = 'parents-section-title';
  clinicalTitle.innerHTML = `🩺 ${t.parents.clinicalReportTitle}`;
  body.appendChild(clinicalTitle);

  if(isPremium){
    const impulsivityIndex = await loadImpulsivityIndex(child.id);
    if(myToken !== parentsDashboardRenderToken) return; // a newer render started meanwhile - let it win
    const clinicalCard = document.createElement('div');
    clinicalCard.className = 'parents-card';
    clinicalCard.innerHTML = `
      <div class="parents-reading-row"><span>${t.parents.impulsivityIndex}</span><span>${impulsivityIndex !== null ? impulsivityIndex + '/100' : t.parents.never}</span></div>
      <div class="parents-reading-row"><span>${t.parents.readingMasteredLabel}</span><span>${masteredSyllables.length}</span></div>
      <div class="parents-reading-row"><span>${t.parents.statsSessions}</span><span>${ilhaDoFocoSessions.length}</span></div>
    `;
    body.appendChild(clinicalCard);

    const extras = await loadClinicalSummaryExtras(child.id);
    if(myToken !== parentsDashboardRenderToken) return; // a newer render started meanwhile - let it win
    const summaryText = buildClinicalSummary({
      profile: { name: child.name },
      focusEvolution: extras.focusEvolution, workingMemory: extras.workingMemory,
      impulsivityIndex, syllableDifficulty: extras.syllableDifficulty,
      phonologicalSwaps: extras.phonologicalSwaps, frustration: extras.frustration,
      adherence, readingProgress: reading,
      cocosSmallQtyAccuracy: extras.cocosSmallQtyAccuracy, cocosLargeQtyAccuracy: extras.cocosLargeQtyAccuracy,
    }, state.lang);
    const summaryCard = document.createElement('div');
    summaryCard.className = 'parents-card';
    summaryCard.innerHTML = `<div style="font-size:13.5px; color:var(--cream); line-height:1.6; font-style:italic;">${summaryText}</div>`;
    body.appendChild(summaryCard);
    notifyReportReady(child.id);
  } else {
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { count: totalEventos } = await sb.from('game_events')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', child.id)
      .gte('occurred_at', sevenDaysAgo.toISOString());
    if(myToken !== parentsDashboardRenderToken) return; // a newer render started meanwhile - let it win
    const n = totalEventos || 0;

    const conversionCard = document.createElement('div');
    conversionCard.className = 'parents-conversion-card';
    if(n === 0){
      conversionCard.innerHTML = `
        <div class="conversion-title">🔒 ${t.parents.clinicalConversionTitle}</div>
        <p class="conversion-empty-body">${t.parents.clinicalConversionEmptyBody}</p>
      `;
    } else {
      const footerFor = (plan) => {
        if(plan === '30days') return isBrazil() ? t.parents.clinicalConversionFooter30DaysBRL : t.parents.clinicalConversionFooter30DaysEUR;
        return isBrazil() ? t.parents.clinicalConversionFooterBRL : t.parents.clinicalConversionFooterEUR;
      };
      conversionCard.dataset.plan = '30days';
      conversionCard.innerHTML = `
        <div class="conversion-title">🔒 ${t.parents.clinicalConversionTitle}</div>
        <div class="conversion-stat-box">
          <span class="stat-emoji">📊</span>
          <div>
            <div class="conversion-stat-number">${t.parents.clinicalConversionInteractions(n)}</div>
            <div class="conversion-stat-sub">${t.parents.clinicalConversionLast7Days}</div>
          </div>
        </div>
        <p class="conversion-body">${t.parents.clinicalConversionBody}</p>
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
      const footerEl = conversionCard.querySelector('.conversion-footer');
      conversionCard.querySelectorAll('.plan-toggle-btn').forEach(btn => {
        btn.addEventListener('click', ()=>{
          conversionCard.dataset.plan = btn.dataset.plan;
          conversionCard.querySelectorAll('.plan-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
          footerEl.textContent = footerFor(btn.dataset.plan);
        });
      });
      conversionCard.querySelector('[data-method="card"]').addEventListener('click', (e)=> startCheckout(e.currentTarget, conversionCard.dataset.plan));
      const pixBtn = conversionCard.querySelector('[data-method="pix"]');
      if(pixBtn) pixBtn.addEventListener('click', ()=> openPixCpfModal(conversionCard.dataset.plan, renderParentsDashboardBody));
    }
    body.appendChild(conversionCard);
  }

  // ---- Danger zone: reset progress ----
  const dangerTitle = document.createElement('div');
  dangerTitle.className = 'parents-section-title';
  dangerTitle.innerHTML = `⚠️ ${t.parents.dangerZoneTitle}`;
  body.appendChild(dangerTitle);

  const dangerCard = document.createElement('div');
  dangerCard.className = 'parents-danger-zone';
  dangerCard.innerHTML = `
    <p class="danger-desc">${t.parents.resetProgressDesc}</p>
    <button class="parents-reset-btn">${t.parents.resetProgressBtn(escapeHtml(child.name))}</button>
    <div style="margin-top:14px;">
      <button type="button" class="delete-account-link">${t.parents.deleteAccountBtn}</button>
    </div>
  `;
  dangerCard.querySelector('.parents-reset-btn').addEventListener('click', async (e)=>{
    if(!confirm(t.parents.resetProgressConfirm(child.name))) return;
    const btn = e.currentTarget;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = t.parents.resettingProgress;
    try{
      const { error } = await sb.rpc('reset_child_progress', { p_child_profile_id: child.id });
      if(error) throw error;
      await renderParentsDashboardBody();
    }catch(err){
      btn.disabled = false;
      btn.textContent = originalLabel;
      showError(t.parents.resetProgressError);
    }
  });
  dangerCard.querySelector('.delete-account-link').addEventListener('click', ()=>{
    openDeleteAccountModal({
      warningHtml: t.parents.deleteAccountWarning(escapeHtml(child.name)),
      onConfirm: async (close)=>{
        try{
          const { data, error } = await sb.rpc('delete_my_account');
          if(error) throw error;
          close();
          try{ await sb.auth.signOut(); }catch(e){ /* account row is already gone server-side; local cleanup is what matters */ }
          alert(t.parents.accountDeletedMsg);
        }catch(err){
          close();
          showError(t.parents.deleteAccountError);
        }
      }
    });
  });
  body.appendChild(dangerCard);
}

function renderTrendChart(container, sessions){
  container.innerHTML = '';
  const t = L();
  if(!sessions.length){
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = t.parents.noSessions;
    container.appendChild(p);
    return;
  }
  const pts = sessions.slice(-12);
  const W = 280, H = 84, padX = 14, padY = 14;
  const stepX = pts.length > 1 ? (W - padX*2) / (pts.length - 1) : 0;
  const yFor = (stars) => H - padY - (stars/3) * (H - padY*2);
  const locale = state.lang === 'it' ? 'it-IT' : 'pt-BR';

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  container.appendChild(tip);

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'trend-chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t.parents.chartAriaLabel);

  [0,1,2,3].forEach(v=>{
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', padX); line.setAttribute('x2', W - padX);
    line.setAttribute('y1', yFor(v)); line.setAttribute('y2', yFor(v));
    line.setAttribute('class', 'trend-grid');
    svg.appendChild(line);
  });

  const linePoints = pts.map((s,i)=> `${padX + i*stepX},${yFor(s.stars)}`).join(' ');
  const polyline = document.createElementNS(svgNS, 'polyline');
  polyline.setAttribute('points', linePoints);
  polyline.setAttribute('class', 'trend-line');
  svg.appendChild(polyline);

  pts.forEach((s,i)=>{
    const cx = padX + i*stepX, cy = yFor(s.stars);
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', 4);
    c.setAttribute('class', 'trend-dot');
    c.setAttribute('tabindex', '0');
    const dateStr = new Date(s.played_at).toLocaleDateString(locale, { day:'2-digit', month:'2-digit' });
    const label = `${dateStr} · ${'⭐'.repeat(s.stars)}${'☆'.repeat(3-s.stars)} · ${t.diff[s.difficulty] || s.difficulty}`;
    const show = ()=>{
      tip.textContent = label;
      tip.style.left = (cx/W*100) + '%';
      tip.style.top = (cy/H*100) + '%';
      tip.style.display = 'block';
    };
    const hide = ()=>{ tip.style.display = 'none'; };
    c.addEventListener('mouseenter', show);
    c.addEventListener('mouseleave', hide);
    c.addEventListener('focus', show);
    c.addEventListener('blur', hide);
    svg.appendChild(c);
  });

  container.appendChild(svg);
}
