import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared with parents-dashboard.test.js's idea, but professional-dashboard.js
// talks to `sb` directly (no parents-data.js-style loader layer sits in
// front of it) - so this file needs the full chainable-and-awaitable
// Supabase stub, configured per table/view/rpc. Inlined for the same
// vi.hoisted-can't-reach-normal-imports reason as in parents-dashboard.test.js.
const { sbStub, setPremium } = vi.hoisted(() => {
  function chainable(result){
    let proxy;
    const obj = { then(resolve){ resolve(result); return Promise.resolve(result); }, catch(){ return proxy; } };
    proxy = new Proxy(obj, { get(target, prop){ return prop in target ? target[prop] : () => proxy; } });
    return proxy;
  }
  let isPremium = true;
  const emptyView = { data: [], error: null };
  const tableResults = {
    professionals: { data: { id: 'prof-1' }, error: null },
    professional_child_links: { data: [{ id: 'link-1', status: 'active', child_profile_id: 'child-1', child_profiles: { id: 'child-1', name: 'Ana' } }], error: null },
    child_profiles: { data: { id: 'child-1', name: 'Ana', stars_by_game: { semaforo: 3 } }, error: null },
    reading_progress: { data: { mastered_syllables: ['ba', 'be'], read_words: ['bola'], challenges_completed: 2 }, error: null },
    v_impulsivity_index: { data: { indice: 85 }, error: null },
    v_adherence_summary: { data: [{ game_key: 'semaforo', semanas_com_dado: 3, semanas_com_meta_atingida: 2, taxa_adesao_pct: 66 }], error: null },
    v_phonological_swaps: emptyView, v_error_type_summary: emptyView, v_syllable_difficulty: emptyView,
    v_weekly_focus_evolution: emptyView, v_response_time_trend: emptyView, v_working_memory: emptyView,
    v_rule_adaptation: emptyView, v_perseverative_errors: emptyView, v_frustration_raw: emptyView,
    v_wait_task_compliance: emptyView, v_instruction_following: emptyView,
    game_sessions: emptyView,
  };
  return {
    setPremium: (v) => { isPremium = v; },
    sbStub: {
      auth: {
        getUser: async () => ({ data: { user: { id: 'prof-user-id' } } }),
        getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
        signOut: async () => ({}),
      },
      from: (table) => chainable(tableResults[table] ?? emptyView),
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
