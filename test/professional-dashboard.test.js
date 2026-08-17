import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared with parents-dashboard.test.js's idea, but professional-dashboard.js
// talks to `sb` directly (no parents-data.js-style loader layer sits in
// front of it) - so this file needs the full chainable-and-awaitable
// Supabase stub, configured per table/view/rpc. Inlined for the same
// vi.hoisted-can't-reach-normal-imports reason as in parents-dashboard.test.js.
const { sbStub, setPremium, setResponseTimeRows, setIndicatorsRows, setActivityDifficultyRows, setThermoResponseTimeRows, setThermoDiversityRow, setCestasPlanningIndexRow, setCestasDeliberationRow, setCestasRestartsRow, setCocosSmallQtyAccuracyRow, setCocosLargeQtyAccuracyRow, setCocosDeliberationRow } = vi.hoisted(() => {
  function chainable(result){
    let proxy;
    const obj = { then(resolve){ resolve(result); return Promise.resolve(result); }, catch(){ return proxy; } };
    proxy = new Proxy(obj, { get(target, prop){ return prop in target ? target[prop] : () => proxy; } });
    return proxy;
  }
  let isPremium = true;
  let responseTimeRows = [];
  let indicatorsRows = [];
  let activityDifficultyRows = [];
  let thermoResponseTimeRows = [];
  let thermoDiversityRow = null;
  let cestasPlanningIndexRow = null;
  let cestasDeliberationRow = null;
  let cestasRestartsRow = null;
  let cocosSmallQtyAccuracyRow = null;
  let cocosLargeQtyAccuracyRow = null;
  let cocosDeliberationRow = null;
  const emptyView = { data: [], error: null };
  const tableResults = {
    professionals: { data: { id: 'prof-1' }, error: null },
    professional_child_links: { data: [{ id: 'link-1', status: 'active', child_profile_id: 'child-1', child_profiles: { id: 'child-1', name: 'Ana' } }], error: null },
    child_profiles: { data: { id: 'child-1', name: 'Ana', stars_by_game: { semaforo: 3 } }, error: null },
    reading_progress: { data: { mastered_syllables: ['ba', 'be'], read_words: ['bola'], challenges_completed: 2 }, error: null },
    v_adherence_summary: { data: [{ game_key: 'semaforo', semanas_com_dado: 3, semanas_com_meta_atingida: 2, taxa_adesao_pct: 66 }], error: null },
    v_phonological_swaps: emptyView, v_error_type_summary: emptyView, v_syllable_difficulty: emptyView,
    v_weekly_focus_evolution: emptyView, v_working_memory: emptyView,
    v_rule_adaptation: emptyView, v_perseverative_errors: emptyView, v_frustration_raw: emptyView,
    v_wait_task_compliance: emptyView, v_instruction_following: emptyView,
    game_sessions: emptyView,
  };
  return {
    setPremium: (v) => { isPremium = v; },
    setResponseTimeRows: (rows) => { responseTimeRows = rows; },
    setIndicatorsRows: (rows) => { indicatorsRows = rows; },
    setActivityDifficultyRows: (rows) => { activityDifficultyRows = rows; },
    setThermoResponseTimeRows: (rows) => { thermoResponseTimeRows = rows; },
    setThermoDiversityRow: (row) => { thermoDiversityRow = row; },
    setCestasPlanningIndexRow: (row) => { cestasPlanningIndexRow = row; },
    setCestasDeliberationRow: (row) => { cestasDeliberationRow = row; },
    setCestasRestartsRow: (row) => { cestasRestartsRow = row; },
    setCocosSmallQtyAccuracyRow: (row) => { cocosSmallQtyAccuracyRow = row; },
    setCocosLargeQtyAccuracyRow: (row) => { cocosLargeQtyAccuracyRow = row; },
    setCocosDeliberationRow: (row) => { cocosDeliberationRow = row; },
    sbStub: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'prof-user-id' } } }),
        getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
        signOut: async () => ({}),
      },
      from: (table) => chainable(
        table === 'v_response_time_trend' ? { data: responseTimeRows, error: null }
        : table === 'child_metrics_daily' ? { data: indicatorsRows, error: null }
        : table === 'v_activity_difficulty' ? { data: activityDifficultyRows, error: null }
        : table === 'v_thermo_response_time' ? { data: thermoResponseTimeRows, error: null }
        : table === 'v_thermo_strategy_diversity' ? { data: thermoDiversityRow, error: null }
        : table === 'v_cestas_planning_index' ? { data: cestasPlanningIndexRow, error: null }
        : table === 'v_cestas_deliberation_time' ? { data: cestasDeliberationRow, error: null }
        : table === 'v_cestas_voluntary_restarts' ? { data: cestasRestartsRow, error: null }
        : table === 'v_cocos_small_qty_accuracy' ? { data: cocosSmallQtyAccuracyRow, error: null }
        : table === 'v_cocos_large_qty_accuracy' ? { data: cocosLargeQtyAccuracyRow, error: null }
        : table === 'v_cocos_deliberation_time' ? { data: cocosDeliberationRow, error: null }
        : (tableResults[table] ?? emptyView)
      ),
      rpc: async (name) => {
        if (name === 'has_premium_access') return { data: isPremium, error: null };
        if (name === 'redeem_invite_code') return { data: { success: true, child_name: 'Beto' }, error: null };
        return { data: null, error: null };
      },
    },
  };
});

vi.mock('../src/lib/session-state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sb: sbStub };
});

vi.mock('../src/lib/clinical-summary.js', () => ({
  buildClinicalSummary: vi.fn(() => 'mocked clinical summary'),
  notifyReportReady: vi.fn(),
}));

import { openProfessionalDashboard, resetProfDashboardSelection } from '../src/dashboards/professional-dashboard.js';
import { notifyReportReady } from '../src/lib/clinical-summary.js';
import { state } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="hubHeader"></div>
    <div id="screen-professional" class="screen"></div>
    <div id="profDashboardContainer"></div>
  `;
}

describe('professional dashboard', () => {
  beforeEach(() => {
    buildDom();
    resetProfDashboardSelection();
    state.lang = 'pt';
    setPremium(true);
    setResponseTimeRows([]);
    setIndicatorsRows([]);
    setActivityDifficultyRows([]);
    setThermoResponseTimeRows([]);
    setThermoDiversityRow(null);
    setCestasPlanningIndexRow(null);
    setCestasDeliberationRow(null);
    setCestasRestartsRow(null);
    setCocosSmallQtyAccuracyRow(null);
    setCocosLargeQtyAccuracyRow(null);
    setCocosDeliberationRow(null);
    notifyReportReady.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists the linked child, auto-selects it, and shows the real clinical summary when premium', async () => {
    await openProfessionalDashboard();
    // renderProfDashboardBody -> loadProfDashboardChildren -> renderProfDashboardFrame
    // -> (profDashboardSelectedId auto-set to the first active child) -> loadAndRenderProfChildDetail,
    // all internally awaited - by the time openProfessionalDashboard() resolves, the detail should be in.
    await vi.waitFor(() => {
      expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull();
    });

    expect(document.querySelector('.prof-dash-child-btn').textContent).toContain('Ana');
    expect(document.getElementById('profDashDetail').textContent).toContain('mocked clinical summary');
    expect(notifyReportReady).toHaveBeenCalledWith('child-1');
    // Ilha do Foco star row for the one game with stars_by_game data
    expect(document.getElementById('profDashDetail').innerHTML).toContain('★');
  });

  it('locks the clinical/phonetic/etc. cards behind the upsell copy when the child is not premium', async () => {
    setPremium(false);
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    expect(document.getElementById('profDashDetail').textContent).not.toContain('mocked clinical summary');
    expect(notifyReportReady).not.toHaveBeenCalled();
    // At least one card gets the dashed "locked" styling used throughout for premium-gated sections.
    expect(document.getElementById('profDashDetail').innerHTML).toContain('dashed #C79A3D');
  });

  it('shows the response-time consistency (CV) line only for games with enough trials to compute it', async () => {
    setResponseTimeRows([
      { game_key: 'semaforo', month: '2026-08-01', avg_response_time_ms: 900, best_response_time_ms: 300, cv_response_time: 0.42, n_trials: 22 },
      { game_key: 'cacaalvo', month: '2026-08-01', avg_response_time_ms: 700, best_response_time_ms: 200, cv_response_time: null, n_trials: 6 },
    ]);
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    const html = document.getElementById('profDashDetail').innerHTML;
    expect(html).toContain('0.42 · 22'); // semaforo: enough trials, CV rendered
    expect(html).not.toContain('null'); // cacaalvo: below the 15-trial gate, no CV line at all
  });

  it('shows the Relatório de Indicadores card, aggregating child_metrics_daily into 7-day windows', async () => {
    const daysAgoISO = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    setIndicatorsRows([
      // current window (0-6 days ago): attention avg 80, control avg 70, memory only 2 non-null days (insufficient, needs 3)
      { metric_date: daysAgoISO(1), attention_index: 90, impulsivity_index: 80, memory_score: null },
      { metric_date: daysAgoISO(2), attention_index: 80, impulsivity_index: 70, memory_score: 75 },
      { metric_date: daysAgoISO(3), attention_index: 70, impulsivity_index: 60, memory_score: 65 },
      // prior window (21-27 days ago): attention avg 60 (-> +20 delta), control avg 70 (-> stable)
      { metric_date: daysAgoISO(22), attention_index: 60, impulsivity_index: 70, memory_score: null },
      { metric_date: daysAgoISO(23), attention_index: 55, impulsivity_index: 70, memory_score: null },
      { metric_date: daysAgoISO(24), attention_index: 65, impulsivity_index: 70, memory_score: null },
    ]);
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    const html = document.getElementById('profDashDetail').innerHTML;
    expect(html).toContain('Relatório de Indicadores');
    expect(html).toContain('80%'); // atenção atual
    expect(html).toContain('70%'); // controle inibitório atual
    expect(html).toContain('▲ +20 pts'); // atenção subiu vs. 4 semanas atrás
    expect(html).toContain('≈ estável'); // controle inibitório não mudou
    expect(html).toContain('Dados insuficientes nesta janela'); // memória: só 2 dias com dado, piso é 3
    // The old standalone "Índice de controle inibitório" badge card is gone -
    // it's redundant with "Controle inibitório" inside the new report now.
    expect(html).not.toContain('prof-dash-impulsivity-badge');
  });

  it('shows per-activity difficulty for the 8 Aventura das Letras minigames that share one game_key', async () => {
    setActivityDifficultyRows([
      { game_key: 'aventura_das_letras', activity_key: 'silaba_escondida', attempts: 12, accuracy_pct: 40 },
      { game_key: 'aventura_das_letras', activity_key: 'mundo_das_silabas', attempts: 20, accuracy_pct: 85 },
    ]);
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    const html = document.getElementById('profDashDetail').innerHTML;
    expect(html).toContain('Dificuldade por atividade');
    // Friendly PT labels from activityLabels, not the raw slug
    expect(html).toContain('Sílaba Escondida');
    expect(html).toContain('Mundo das Sílabas');
    expect(html).toContain('40% (12×)');
    expect(html).toContain('85% (20×)');
  });

  it('shows Termômetro decision times and strategy diversity, with no correct/incorrect framing', async () => {
    setThermoResponseTimeRows([
      { target_type: 'emotion', avg_response_ms: 3200, n: 10 },
      { target_type: 'strategy', avg_response_ms: 1800, n: 10 },
    ]);
    setThermoDiversityRow({ strategies_used: 3, total_rounds: 10 });
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    const html = document.getElementById('profDashDetail').innerHTML;
    expect(html).toContain('Termômetro das Emoções');
    expect(html).toContain('3200ms');
    expect(html).toContain('1800ms');
    expect(html).toContain('3/4');
  });

  it('shows Cestas da Ilha planning efficiency, deliberation time, and voluntary restarts', async () => {
    setCestasPlanningIndexRow({ avg_efficiency: 0.8, n: 3 });
    setCestasDeliberationRow({ avg_response_ms: 4500, n: 5 });
    setCestasRestartsRow({ restarts: 2 });
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    const html = document.getElementById('profDashDetail').innerHTML;
    expect(html).toContain('Cestas da Ilha');
    expect(html).toContain('80%'); // eficiência de planejamento
    expect(html).toContain('4500ms'); // tempo de deliberação
    expect(html).toContain('Reinícios voluntários');
  });

  it('shows Quantos Cocos? accuracy by quantity range and small-quantity response time', async () => {
    setCocosSmallQtyAccuracyRow({ accuracy_pct: 92, n: 6 });
    setCocosLargeQtyAccuracyRow({ accuracy_pct: 68, n: 6 });
    setCocosDeliberationRow({ avg_response_ms: 1800, n: 6 });
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    const html = document.getElementById('profDashDetail').innerHTML;
    expect(html).toContain('Quantos Cocos?');
    expect(html).toContain('92%'); // acurácia 1-3 cocos
    expect(html).toContain('68%'); // acurácia 4+ cocos
    expect(html).toContain('1800ms'); // tempo de resposta em quantidades pequenas
  });

  it('redeems an invite code and refreshes the sidebar with the newly-linked child', async () => {
    await openProfessionalDashboard();
    await vi.waitFor(() => expect(document.querySelector('.prof-dash-child-btn')).not.toBeNull());

    document.getElementById('profRedeemInput').value = 'ABC123';
    document.getElementById('profRedeemBtn').click();

    await vi.waitFor(() => {
      expect(document.getElementById('profRedeemMsg').textContent).toContain('Beto');
    });
    expect(document.getElementById('profRedeemMsg').className).toContain('success');
  });
});
