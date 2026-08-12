// Supabase data-access layer for the parents dashboard (plus loadProfilesList
// and AVATARS, also used by the main profile-picker screen) - pure queries
// and data transforms, no DOM. Imports session-state.js and game-shared.js
// only, so app.js and dashboards/parents-dashboard.js can both import from
// here without either importing the other.
import { sb, state } from './session-state.js';
import { showError } from './game-shared.js';
import { AVATAR_KEYS } from './avatars.js';

export const AVATARS = AVATAR_KEYS;

export async function loadProfilesList(){
  if(!state.authUserId) return [];
  try{
    const { data, error } = await sb.from('child_profiles').select('*, families!inner(auth_user_id)').eq('families.auth_user_id', state.authUserId).order('created_at', { ascending: true });
    if(error) throw error;
    return data || [];
  } catch(e){
    showError('Erro ao carregar perfis. Verifique sua conexão.');
    return [];
  }
}

export async function loadSessions(profileId){
  try{
    const { data, error } = await sb.from('game_sessions').select('*').eq('profile_id', profileId).order('played_at', { ascending:true });
    if(error) throw error;
    return data || [];
  }catch(e){ return []; }
}
export function getChildDifficulty(child, key){ return (child.difficulty_by_game && child.difficulty_by_game[key]) || 'medio'; }

export async function loadReadingProgress(childId){
  try{
    const { data, error } = await sb.from('reading_progress').select('*').eq('child_profile_id', childId).maybeSingle();
    if(error) throw error;
    return data || null;
  }catch(e){ return null; }
}
export async function loadSubscription(familyId){
  try{
    const { data, error } = await sb.from('subscriptions').select('plan, current_period_end, admin_granted_until').eq('family_id', familyId).maybeSingle();
    if(error) throw error;
    return data || null;
  }catch(e){ return null; }
}
export async function loadLinkedProfessionals(childId){
  try{
    const { data, error } = await sb.from('professional_child_links').select('id, status, professionals(full_name, role)').eq('child_profile_id', childId).eq('status', 'active');
    if(error) throw error;
    return data || [];
  }catch(e){ return []; }
}
export async function loadPendingProfessionalRequests(childId){
  try{
    const { data, error } = await sb.from('professional_child_links').select('id, status, professionals(full_name, role)').eq('child_profile_id', childId).eq('status', 'pending');
    if(error) throw error;
    return data || [];
  }catch(e){ return []; }
}
export async function generateInviteCode(childId){
  const { data, error } = await sb.rpc('create_invite_code', { p_child_profile_id: childId });
  if(error) throw error;
  return data;
}
export async function respondToProfessionalLink(linkId, approve){
  const payload = approve ? { status: 'active', linked_at: new Date().toISOString() } : { status: 'revoked' };
  const { error } = await sb.from('professional_child_links').update(payload).eq('id', linkId);
  if(error) throw error;
}
export async function loadAdherence(childId){
  try{
    const { data, error } = await sb.from('v_adherence_summary')
      .select('game_key, semanas_com_dado, semanas_com_meta_atingida, taxa_adesao_pct').eq('profile_id', childId);
    if(error) throw error;
    return (data || []).filter(r=>r.semanas_com_dado > 0);
  }catch(e){ return []; }
}
// Only fetched for premium families - free families never have this data sent
// over the wire, so the paywall can't be bypassed by just reading network traffic.
export async function loadImpulsivityIndex(childId){
  try{
    const { data, error } = await sb.from('v_impulsivity_index').select('indice').eq('profile_id', childId).maybeSingle();
    if(error) throw error;
    return data?.indice ?? null;
  }catch(e){ return null; }
}
// Extra clinical inputs buildClinicalSummary() needs beyond what the parents
// dashboard already loads elsewhere (adherence, readingProgress, impulsivityIndex).
export async function loadClinicalSummaryExtras(childId){
  try{
    const [{ data: focusEvolution }, { data: workingMemory }, { data: phonologicalSwaps }, { data: syllableDifficulty }, { data: frustration }] = await Promise.all([
      sb.from('v_weekly_focus_evolution').select('game_key, week_start, avg_duration_seconds').eq('profile_id', childId).order('week_start', { ascending: false }),
      sb.from('v_working_memory').select('*').eq('profile_id', childId),
      sb.from('v_phonological_swaps').select('expected, answered, occurrences').eq('profile_id', childId).order('occurrences', { ascending: false }).limit(3),
      sb.from('v_syllable_difficulty').select('syllable, accuracy_pct').eq('profile_id', childId).lt('accuracy_pct', 80).order('accuracy_pct', { ascending: true }).limit(3),
      sb.from('v_frustration_raw').select('game_key, abandons, help_requests, retries').eq('profile_id', childId),
    ]);
    return { focusEvolution: focusEvolution || [], workingMemory: workingMemory || [], phonologicalSwaps: phonologicalSwaps || [], syllableDifficulty: syllableDifficulty || [], frustration: frustration || [] };
  }catch(e){
    return { focusEvolution: [], workingMemory: [], phonologicalSwaps: [], syllableDifficulty: [], frustration: [] };
  }
}

// game_sessions is shared across both apps (game_key includes the 6 Ilha do Foco
// keys plus 'aventura_das_letras'), each row carrying its own played_at/end_time —
// so summing every row's real duration here already covers both apps' screen time.
export function computeWeeklyUsage(sessions){
  const minutesByDay = [0,0,0,0,0,0,0];
  const cutoff = Date.now() - 7*24*60*60*1000;
  sessions.forEach(s=>{
    if(!s.end_time) return;
    const start = new Date(s.played_at);
    if(start.getTime() < cutoff) return;
    const end = new Date(s.end_time);
    minutesByDay[start.getDay()] += Math.max(0, (end - start) / 60000);
  });
  return minutesByDay.map(m=>Math.round(m));
}
