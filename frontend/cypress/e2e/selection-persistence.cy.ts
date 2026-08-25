/**
 * F7 regression spec: a full page reload (F5) and a direct visit to a deep URL
 * must keep the persisted site/plot/census selection instead of wiping
 * localStorage['forestgeo-storage'] and bouncing the user to /dashboard.
 *
 * The bug reproduced as: selections persisted correctly, then some boot-time
 * writer replaced the persisted state with `{"state":{}}` within ~2s of page
 * load, after which every reload/deep-link redirected to /dashboard.
 */

const STORAGE_KEY = 'forestgeo-storage';
const SITE_NAME = 'Luquillo';
const PLOT_NAME = 'Luquillo Main Plot';
const CENSUS_NUMBER = 1;
const SUMMARY_PATH = '/measurementshub/summary';
const DASHBOARD_PATH = '/dashboard';
// The observed wipe landed within ~2s of page load; wait past it so the
// assertions catch delayed writers, not just the initial hydrated state.
const SETTLE_WINDOW_MS = 4000;

interface PersistedSelections {
  currentSite?: unknown;
  currentPlot?: unknown;
  currentCensus?: unknown;
  currentQuadrat?: unknown;
}

const readPersistedSelections = (win: Cypress.AUTWindow): PersistedSelections => {
  const raw = win.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw).state ?? {}) : {};
};

describe('selection persistence across reload and deep links (F7)', () => {
  beforeEach(() => {
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
    cy.visitAuthenticatedPage(DASHBOARD_PATH);
    cy.selectSitePlotAndCensus(SITE_NAME, PLOT_NAME, CENSUS_NUMBER);
  });

  it('keeps site/plot/census in localStorage after the app settles', () => {
    cy.wait(SETTLE_WINDOW_MS);
    cy.window().then(win => {
      const state = readPersistedSelections(win);
      expect(state.currentSite, 'currentSite persisted').to.exist;
      expect(state.currentPlot, 'currentPlot persisted').to.exist;
      expect(state.currentCensus, 'currentCensus persisted').to.exist;
    });
  });

  it('survives a hard reload on a deep page without bouncing to /dashboard', () => {
    cy.visit(SUMMARY_PATH);
    cy.location('pathname').should('eq', SUMMARY_PATH);

    cy.reload();
    cy.location('pathname').should('eq', SUMMARY_PATH);

    // Outlast the boot-time wipe window, then confirm both URL and storage held.
    cy.wait(SETTLE_WINDOW_MS);
    cy.location('pathname').should('eq', SUMMARY_PATH);
    cy.window().then(win => {
      const state = readPersistedSelections(win);
      expect(state.currentSite, 'currentSite survived reload').to.exist;
      expect(state.currentPlot, 'currentPlot survived reload').to.exist;
      expect(state.currentCensus, 'currentCensus survived reload').to.exist;
    });
  });

  it('keeps a direct deep-link visit on the target page when a selection is persisted', () => {
    cy.visit(SUMMARY_PATH);
    cy.wait(SETTLE_WINDOW_MS);
    cy.location('pathname').should('eq', SUMMARY_PATH);
    cy.window().then(win => {
      expect(readPersistedSelections(win).currentSite, 'currentSite still persisted after deep-link boot').to.exist;
    });
  });

  it('still clears the persisted selection when the user explicitly deselects the site', () => {
    cy.get('[aria-label="Select a Site"]').click({ force: true });
    cy.get('[role="listbox"]')
      .filter(':visible')
      .first()
      .within(() => {
        cy.contains('[role="option"]', 'None').click({ force: true });
      });

    // Deselecting the site is a designed app reset; the guard must not block it.
    // The deselect cascades through async dispatches (cookie round-trips), so
    // retry the storage assertion until the cascade finishes.
    cy.get('[data-testid="pending-site-select"]').should('exist');
    cy.window().should(win => {
      const state = readPersistedSelections(win);
      expect(state.currentSite, 'currentSite cleared by explicit deselect').to.not.exist;
      expect(state.currentPlot, 'currentPlot cleared by explicit deselect').to.not.exist;
      expect(state.currentCensus, 'currentCensus cleared by explicit deselect').to.not.exist;
    });
  });
});
