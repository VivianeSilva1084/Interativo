import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock factories - and vi.hoisted itself - are hoisted above the whole
// file, including regular top-level consts and even the module-scope
// `import` bindings they'd otherwise close over. So the chainable-Supabase-
// stub helper (also used by professional-dashboard.test.js, imported
// normally there) is inlined here rather than imported, since a hoisted
// callback can't reach a normally-imported name.
const { sbStub } = vi.hoisted(() => {
  function chainable(result){
    let proxy;
    const obj = { then(resolve){ resolve(result); return Promise.resolve(result); }, catch(){ return proxy; } };
    proxy = new Proxy(obj, { get(target, prop){ return prop in target ? target[prop] : () => proxy; } });
    return proxy;
  }
  return {
    sbStub: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
        signOut: async () => ({}),
      },
      // game_events count > 0 -> the free-plan conversion card shows its
      // "upgrade" content instead of the "play a session first" empty state.
      // child_profiles needs a real id back - openAddChildProfileModal reads
      // newRow.id off the insert result to make the freshly-created profile
      // the active tab.
      from: (table) => chainable(
        table === 'game_events' ? { count: 3 }
        : table === 'child_profiles' ? { data: { id: 'new-child-id' }, error: null }
        : { data: null, error: null }
      ),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

vi.mock('../src/lib/session-state.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, sb: sbStub };
});

vi.mock('../src/lib/clinical-summary.js', () => ({
  buildClinicalSummary: vi.fn(() => 'mocked clinical summary text'),
  notifyReportReady: vi.fn(),
}));

vi.mock('../src/lib/billing.js', () => ({
  isBrazil: vi.fn(() => true),
  startCheckout: vi.fn(),
  openPixCpfModal: vi.fn(),
  manageSubscription: vi.fn(),
}));

vi.mock('../src/lib/parents-data.js', () => ({
  AVATARS: ['🦫', '🐢'],
  loadProfilesList: vi.fn(),
  loadSessions: vi.fn(async () => []),
  getChildDifficulty: vi.fn(() => 'medio'),
  loadReadingProgress: vi.fn(async () => null),
  loadSubscription: vi.fn(async () => null),
  loadLinkedProfessionals: vi.fn(async () => []),
  loadPendingProfessionalRequests: vi.fn(async () => []),
  generateInviteCode: vi.fn(),
  respondToProfessionalLink: vi.fn(),
  loadAdherence: vi.fn(async () => []),
  loadImpulsivityIndex: vi.fn(async () => null),
  loadClinicalSummaryExtras: vi.fn(async () => ({ focusEvolution: [], workingMemory: [], phonologicalSwaps: [], syllableDifficulty: [], frustration: [] })),
  computeWeeklyUsage: vi.fn(() => [0, 0, 0, 0, 0, 0, 0]),
}));

import { parentsOpenDashboard, openAddChildProfileModal, resetParentsDashboardState } from '../src/dashboards/parents-dashboard.js';
import { buildClinicalSummary, notifyReportReady } from '../src/lib/clinical-summary.js';
import { startCheckout, openPixCpfModal, manageSubscription } from '../src/lib/billing.js';
import * as parentsData from '../src/lib/parents-data.js';
import { state } from '../src/lib/session-state.js';

function buildDom(){
  document.body.innerHTML = `
    <div id="parentsGate"></div>
    <div id="parentsDashboard"></div>
    <button id="parentsAddProfileBtn"></button>
    <div id="parentsChildTabs"></div>
    <div id="parentsDashboardBody"></div>
  `;
}

const child = { id: 'child-1', name: 'Ana', avatar: '🦫', seeds: 10, difficulty_by_game: {} };

describe('parents dashboard', () => {
  beforeEach(() => {
    buildDom();
    resetParentsDashboardState();
    state.lang = 'pt';
    state.familyId = 'family-1';
    Object.values(parentsData).forEach(fn => fn.mockClear?.());
    buildClinicalSummary.mockClear();
    notifyReportReady.mockClear();
    startCheckout.mockClear();
    openPixCpfModal.mockClear();
    manageSubscription.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the empty state and no tabs when the family has no child profiles yet', async () => {
    parentsData.loadProfilesList.mockResolvedValue([]);

    await parentsOpenDashboard();

    expect(document.getElementById('parentsDashboardBody').textContent).toContain('');
    expect(document.querySelectorAll('#parentsChildTabs button').length).toBe(0);
  });

  it('renders one tab per child, but only when there is more than one', async () => {
    parentsData.loadProfilesList.mockResolvedValue([child]);
    await parentsOpenDashboard();
    expect(document.querySelectorAll('#parentsChildTabs button').length).toBe(0); // single child -> tabs are redundant, hidden

    parentsData.loadProfilesList.mockResolvedValue([child, { ...child, id: 'child-2', name: 'Beto' }]);
    await parentsOpenDashboard();
    expect(document.querySelectorAll('#parentsChildTabs button').length).toBe(2);
  });

  it('shows the free-plan conversion card (wired to billing) when the family is not premium', async () => {
    parentsData.loadProfilesList.mockResolvedValue([child]);
    parentsData.loadSubscription.mockResolvedValue({ plan: 'free' });

    await parentsOpenDashboard();

    const conversionCard = document.querySelector('.parents-conversion-card');
    expect(conversionCard).not.toBeNull();
    expect(document.querySelector('.parents-premium-badge')).toBeNull();

    conversionCard.querySelector('[data-method="card"]').click();
    expect(startCheckout).toHaveBeenCalledWith(expect.anything(), '30days');

    const pixBtn = conversionCard.querySelector('[data-method="pix"]');
    pixBtn.click();
    expect(openPixCpfModal).toHaveBeenCalledWith('30days', expect.any(Function));
  });

  it('shows the premium badge and the real clinical summary, and pings notifyReportReady', async () => {
    parentsData.loadProfilesList.mockResolvedValue([child]);
    parentsData.loadSubscription.mockResolvedValue({ plan: 'premium' });
    parentsData.loadImpulsivityIndex.mockResolvedValue(72);

    await parentsOpenDashboard();

    expect(document.querySelector('.parents-premium-badge')).not.toBeNull();
    expect(document.querySelector('.parents-conversion-card')).toBeNull();
    expect(buildClinicalSummary).toHaveBeenCalledWith(expect.objectContaining({ impulsivityIndex: 72 }), 'pt');
    expect(notifyReportReady).toHaveBeenCalledWith(child.id);

    document.querySelector('.parents-manage-sub-btn').click();
    expect(manageSubscription).toHaveBeenCalled();
  });

  it('never renders the body twice when two renders overlap (e.g. a double-tap on the child tab)', async () => {
    // Regression test: renderParentsDashboardBody used to clear the container
    // only once, at the very start, before its awaits. Two overlapping calls
    // (a fast double-tap, or the initial open racing another trigger) could
    // each finish their own full render, with the second one's content
    // appended on top of the first's instead of replacing it - the clinical
    // summary card and the danger zone would end up duplicated in the DOM.
    parentsData.loadProfilesList.mockResolvedValue([child]);
    parentsData.loadSubscription.mockResolvedValue({ plan: 'premium' });

    await Promise.all([parentsOpenDashboard(), parentsOpenDashboard()]);

    expect(document.querySelectorAll('#parentsDashboardBody .parents-danger-zone').length).toBe(1);
    expect(document.querySelectorAll('#parentsDashboardBody .parents-summary').length).toBe(1);
  });

  it('creates a new child profile and reloads the dashboard on success', async () => {
    parentsData.loadProfilesList
      .mockResolvedValueOnce([]) // initial dashboard open: no children yet
      .mockResolvedValueOnce([child]); // reload after the modal creates one
    await parentsOpenDashboard();

    openAddChildProfileModal();
    document.getElementById('parentsNewProfileName').value = 'Ana';
    document.getElementById('parentsNewProfileConsentCheck').checked = true;
    document.querySelector('[data-action="create"]').click();
    await vi.waitFor(() => expect(document.querySelector('.confirm-modal-overlay')).toBeNull());

    expect(parentsData.loadProfilesList).toHaveBeenCalledTimes(2);
  });
});
