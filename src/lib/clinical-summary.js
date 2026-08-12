// Builds the plain-language clinical-summary paragraph shown on both the
// parents dashboard (as a Premium-gated conversion card) and the
// professional dashboard (unlocked), plus the fire-and-forget "report was
// viewed" notification both dashboards trigger alongside it. Imports
// session-state.js (for notifyReportReady's sb.auth call) and game-shared.js
// (for escapeHtml) - never a dashboard module - so both dashboard modules
// can import from here without one importing the other.
import { sb } from './session-state.js';
import { escapeHtml } from './game-shared.js';

const SUMMARY_STRINGS = {
  pt: {
    theChild: 'A criança',
    noData: (n) => `${n} ainda tem poucas sessões registradas para gerar uma análise completa.`,
    adherenceGood: (n, p) => `${n} manteve uma frequência excelente nas últimas semanas (${p}% das metas atingidas).`,
    adherencePartial: (n, p) => `${n} jogou de forma irregular nas últimas semanas (${p}% das metas atingidas).`,
    adherenceLow: (n, p) => `A frequência de uso foi baixa nas últimas semanas (${p}% das metas atingidas).`,
    focusImproved: (s, d) => `A atenção sustentada melhorou: média de ${s}s por sessão (+${d}% em relação à semana anterior).`,
    focusDeclined: (s, d) => `A duração média de atenção foi de ${s}s por sessão (-${d}% em relação à semana anterior).`,
    focusStable: (s) => `A atenção sustentada está estável, com média de ${s}s por sessão.`,
    focusBaseline: (s) => `Primeira semana de dados de atenção: média de ${s}s por sessão.`,
    impulsivityGood: (i) => `O índice de controle inibitório está em ${i}/100, indicando bom controle.`,
    impulsivityModerate: (i) => `O índice de controle inibitório está em ${i}/100, com impulsividade ocasional.`,
    impulsivityHigh: (i) => `O índice de controle inibitório está em ${i}/100, indicando área de atenção.`,
    syllablesHard: (s) => `Sílabas com maior dificuldade: ${s}.`,
    syllablesMastered: (n) => `${n} sílabas já dominadas no Aventura das Letras.`,
    phoneticSwap: (e, a, n) => `Troca fonológica mais frequente: /${e}/ → /${a}/ (${n} ocorrências).`,
    persistenceGood: (n, r) => `${n} demonstrou persistência, tentando de novo ou pedindo ajuda ${r} vezes em vez de desistir da atividade.`,
    persistenceLow: (n, a) => `Foram registrados ${a} abandonos de atividade nas últimas semanas.`,
  },
  it: {
    theChild: 'Il bambino',
    noData: (n) => `${n} ha ancora poche sessioni registrate per generare un'analisi completa.`,
    adherenceGood: (n, p) => `${n} ha mantenuto una frequenza eccellente nelle ultime settimane (${p}% degli obiettivi raggiunti).`,
    adherencePartial: (n, p) => `${n} ha giocato in modo irregolare nelle ultime settimane (${p}% degli obiettivi raggiunti).`,
    adherenceLow: (n, p) => `La frequenza di utilizzo è stata bassa nelle ultime settimane (${p}% degli obiettivi raggiunti).`,
    focusImproved: (s, d) => `L'attenzione sostenuta è migliorata: media di ${s}s per sessione (+${d}% rispetto alla settimana precedente).`,
    focusDeclined: (s, d) => `La durata media dell'attenzione è stata di ${s}s per sessione (-${d}% rispetto alla settimana precedente).`,
    focusStable: (s) => `L'attenzione sostenuta è stabile, con una media di ${s}s per sessione.`,
    focusBaseline: (s) => `Prima settimana di dati sull'attenzione: media di ${s}s per sessione.`,
    impulsivityGood: (i) => `L'indice di controllo inibitorio è ${i}/100, indicando un buon controllo.`,
    impulsivityModerate: (i) => `L'indice di controllo inibitorio è ${i}/100, con impulsività occasionale.`,
    impulsivityHigh: (i) => `L'indice di controllo inibitorio è ${i}/100, un'area da monitorare.`,
    syllablesHard: (s) => `Sillabe con maggiore difficoltà: ${s}.`,
    syllablesMastered: (n) => `${n} sillabe già padroneggiate nell'Avventura delle Lettere.`,
    phoneticSwap: (e, a, n) => `Sostituzione fonologica più frequente: /${e}/ → /${a}/ (${n} occorrenze).`,
    persistenceGood: (n, r) => `${n} ha dimostrato perseveranza, riprovando o chiedendo aiuto ${r} volte invece di abbandonare l'attività.`,
    persistenceLow: (n, a) => `Sono stati registrati ${a} abbandoni di attività nelle ultime settimane.`,
  },
};

export function buildClinicalSummary(detail, lang){
  const t = lang === 'it' ? SUMMARY_STRINGS.it : SUMMARY_STRINGS.pt;
  const lines = [];

  const { profile, focusEvolution, workingMemory, impulsivityIndex,
          syllableDifficulty, phonologicalSwaps, frustration,
          adherence, readingProgress } = detail;

  const name = escapeHtml(profile?.name || t.theChild);

  // 1. Adesão
  const totalAdh = adherence || [];
  const overallAdh = totalAdh.length > 0
    ? Math.round(totalAdh.reduce((s, a) => s + (a.taxa_adesao_pct || 0), 0) / totalAdh.length)
    : null;

  if (overallAdh !== null) {
    lines.push(overallAdh >= 80
      ? t.adherenceGood(name, overallAdh)
      : overallAdh >= 50
      ? t.adherencePartial(name, overallAdh)
      : t.adherenceLow(name, overallAdh));
  }

  // 2. Atenção sustentada — pega as 2 semanas mais recentes (do primeiro jogo com dado) e compara
  const focusByGame = {};
  (focusEvolution || []).forEach(f => {
    if (!focusByGame[f.game_key]) focusByGame[f.game_key] = [];
    focusByGame[f.game_key].push(f);
  });
  const focusGames = Object.values(focusByGame);
  if (focusGames.length > 0) {
    const latest = focusGames[0];
    if (latest.length >= 2 && latest[1].avg_duration_seconds) {
      const curr = latest[0].avg_duration_seconds;
      const prev = latest[1].avg_duration_seconds;
      const delta = Math.round(((curr - prev) / prev) * 100);
      lines.push(delta > 0
        ? t.focusImproved(Math.round(curr), delta)
        : delta < -5
        ? t.focusDeclined(Math.round(curr), Math.abs(delta))
        : t.focusStable(Math.round(curr)));
    } else if (latest.length >= 1) {
      lines.push(t.focusBaseline(Math.round(latest[0].avg_duration_seconds)));
    }
  }

  // 3. Índice de impulsividade
  if (impulsivityIndex !== null && impulsivityIndex !== undefined) {
    if (impulsivityIndex >= 80) lines.push(t.impulsivityGood(impulsivityIndex));
    else if (impulsivityIndex >= 60) lines.push(t.impulsivityModerate(impulsivityIndex));
    else lines.push(t.impulsivityHigh(impulsivityIndex));
  }

  // 4. Análise fonética — sílabas difíceis
  if (syllableDifficulty && syllableDifficulty.length > 0) {
    const hard = syllableDifficulty.slice(0, 3).map(s => `${s.syllable} (${s.accuracy_pct}%)`).join(', ');
    lines.push(t.syllablesHard(hard));
  } else if (readingProgress?.mastered_syllables?.length > 0) {
    lines.push(t.syllablesMastered(readingProgress.mastered_syllables.length));
  }

  // 5. Trocas fonológicas
  if (phonologicalSwaps && phonologicalSwaps.length > 0) {
    const topSwap = phonologicalSwaps[0];
    lines.push(t.phoneticSwap(topSwap.expected, topSwap.answered, topSwap.occurrences));
  }

  // 6. Tolerância à frustração - abandons é universal aos 7 jogos; retries
  // (botão "Jogar de novo" de História/Caça ao Alvo) e help_requests (pedido
  // de ajuda, vários jogos) são os dois sinais reais de persistência - nenhum
  // dos dois é universal sozinho, então soma os dois pra não subestimar uma
  // criança que só teve chance de mostrar um dos dois comportamentos.
  const totAbandons = (frustration || []).reduce((s, f) => s + (f.abandons || 0), 0);
  const totHelpRequests = (frustration || []).reduce((s, f) => s + (f.help_requests || 0), 0);
  const totRetries = (frustration || []).reduce((s, f) => s + (f.retries || 0), 0);
  const totPersistence = totHelpRequests + totRetries;
  if (totAbandons === 0 && totPersistence > 0) lines.push(t.persistenceGood(name, totPersistence));
  else if (totAbandons > 2) lines.push(t.persistenceLow(name, totAbandons));

  if (lines.length === 0) return t.noData(name);

  return lines.join(' ');
}

// Best-effort, fire-and-forget: tells notify-report-ready a premium report was
// just shown to someone (parent or professional) so it can WhatsApp the family
// if they're linked to a lead with opt-in - capped server-side to once per
// ~20h per child, since this fires every time the report view opens, not just
// on some notion of "freshly generated" (the report has no such event - it's
// built client-side, from buildClinicalSummary(), every time it's viewed).
export function notifyReportReady(childProfileId){
  if(!childProfileId) return;
  sb.auth.getSession().then(({ data: { session } })=>{
    if(!session) return;
    fetch(`${SUPABASE_URL}/functions/v1/notify-report-ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ childProfileId }),
    }).catch(()=>{});
  });
}
