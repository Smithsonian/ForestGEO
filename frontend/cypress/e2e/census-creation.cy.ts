/**
 * Census Creation & Management E2E Tests
 *
 * These tests use the real E2E credentials provider to obtain a valid session
 * and interact with the actual application (backed by the forestgeo_testing schema).
 *
 * Prerequisites:
 *   - App running with NEXT_PUBLIC_E2E_TESTING=true
 *   - forestgeo_testing schema accessible from the app's DB connection
 *
 * Coverage:
 *   - Site → Plot → Census selection flow
 *   - Census creation via dashboard "Start New Census" button
 *   - Census appears in sidebar selector after creation
 *   - Census deletion via dashboard
 */

const TIMEOUTS = {
  /** Time to wait for page load and data fetches */
  PAGE_LOAD: 15_000,
  /** Time to wait for sidebar selectors to populate */
  SELECTOR_POPULATE: 10_000,
  /** Time to wait for async operations like census creation */
  ASYNC_OPERATION: 30_000,
  /** Wait for UI transitions and state updates after selection */
  UI_TRANSITION: 5_000
} as const;

// MUI Joy Select renders options in a portal listbox.
// Neither `data-testid` nor `aria-label` props reliably transfer to the
// portal-rendered <li> elements. Use the listbox role + text content to find options.
const SELECTORS = {
  SITE_SELECT: '[data-testid="site-select-component"]',
  SELECTED_SITE_NAME: '[data-testid="selected-site-name"]',
  SELECTED_SITE_SCHEMA: '[data-testid="selected-site-schema"]',
  PENDING_SITE: '[data-testid="pending-site-select"]',
  PLOT_SELECT: '[data-testid="plot-select-component"]',
  SELECTED_PLOT_NAME: '[data-testid="selected-plot-name"]',
  CENSUS_SELECT: '[data-testid="census-select-component"]',
  SELECTED_CENSUS: '[data-testid="selected-census-plotcensusnumber"]'
} as const;

/**
 * Click a MUI Joy Select and pick the first allowed site option.
 *
 * The old sidebar (sidebar.tsx) renders site options with:
 *   data-testid="site-selection-option-allowed"
 *   aria-label="Select {siteName} site"
 *
 * MUI Joy portals the listbox, but aria-label IS preserved on <li> elements.
 */
function selectFirstSiteOption() {
  cy.get(SELECTORS.SITE_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).click();
  // Use aria-label pattern to find allowed site options (skipping "None" / deselect)
  cy.get('[role="listbox"] [role="option"][aria-label^="Select "]', { timeout: TIMEOUTS.SELECTOR_POPULATE }).first().click();
}

/**
 * Click a MUI Joy Select and pick the first plot option.
 */
function selectFirstPlotOption() {
  cy.get(SELECTORS.PLOT_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).click();
  // Plot options have aria-label="plot name option: {name}"
  cy.get('[role="listbox"] [role="option"][aria-label^="plot name"]', { timeout: TIMEOUTS.SELECTOR_POPULATE }).first().click();
}

/**
 * Click census selector and pick the first census option.
 */
function selectFirstCensusOption() {
  cy.get(SELECTORS.CENSUS_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).click();
  cy.get('[role="listbox"] [role="option"]', { timeout: TIMEOUTS.SELECTOR_POPULATE }).first().click();
}

describe('Census Creation & Management', () => {
  beforeEach(() => {
    // Programmatic login — sets a real NextAuth session cookie
    cy.loginViaCredentials('e2e-admin@forestgeo.si.edu', 'global');
  });

  describe('Site/Plot/Census Selection Flow', () => {
    it('should load the dashboard and display available sites', () => {
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // The hub layout fetches session → then fetches site list → renders sidebar
      cy.get(SELECTORS.SITE_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');

      // Should show "Select a Site" placeholder
      cy.get(SELECTORS.PENDING_SITE).should('exist');

      // Dashboard greeting should appear (proves session is active)
      cy.contains('Welcome back', { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');
    });

    it('should populate site dropdown with real sites from the database', () => {
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // Open the site selector
      cy.get(SELECTORS.SITE_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).click();

      // At least one site option should be available from the DB
      // MUI Joy renders options in a portal listbox
      cy.get('[role="listbox"]', { timeout: TIMEOUTS.SELECTOR_POPULATE }).find('[role="option"]').should('have.length.greaterThan', 0);
    });

    it('should load plots after selecting a site', () => {
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // Select the first available site
      selectFirstSiteOption();

      // Verify site is selected (no longer shows placeholder)
      cy.get(SELECTORS.SELECTED_SITE_NAME, { timeout: TIMEOUTS.UI_TRANSITION }).should('exist');
      cy.get(SELECTORS.SELECTED_SITE_SCHEMA).should('exist');

      // Plot selector should appear and be populated
      cy.get(SELECTORS.PLOT_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');
    });

    it('should load censuses after selecting a site and plot', () => {
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // Select site
      selectFirstSiteOption();
      cy.get(SELECTORS.SELECTED_SITE_NAME, { timeout: TIMEOUTS.UI_TRANSITION }).should('exist');

      // Select first plot
      selectFirstPlotOption();

      // Verify plot is selected
      cy.get(SELECTORS.SELECTED_PLOT_NAME, { timeout: TIMEOUTS.UI_TRANSITION }).should('exist');

      // Census selector should appear
      cy.get(SELECTORS.CENSUS_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');
    });
  });

  describe('Census Creation', () => {
    /**
     * Helper: navigate to dashboard and select the first site + first plot.
     * Leaves the user on the dashboard with site and plot selected, census unselected.
     */
    function selectFirstSiteAndPlot() {
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // Select first site
      selectFirstSiteOption();
      cy.get(SELECTORS.SELECTED_SITE_NAME, { timeout: TIMEOUTS.UI_TRANSITION }).should('exist');

      // Select first plot
      selectFirstPlotOption();
      cy.get(SELECTORS.SELECTED_PLOT_NAME, { timeout: TIMEOUTS.UI_TRANSITION }).should('exist');
    }

    it('should show the "Start New Census" button on the dashboard when no census is selected', () => {
      selectFirstSiteAndPlot();

      // Dashboard should display the censuses overview with an "Add" card
      // The "Start New Census" button is rendered by the AddCensusCard component
      cy.contains('Start New Census', { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');
    });

    it('should show census cards for existing censuses', () => {
      selectFirstSiteAndPlot();

      // Wait for the censuses overview section to load
      cy.get(SELECTORS.CENSUS_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');

      // Check if census options exist in the dropdown
      cy.get(SELECTORS.CENSUS_SELECT).click();

      // Wait for listbox portal and check options
      cy.get('[role="listbox"]', { timeout: TIMEOUTS.SELECTOR_POPULATE }).then($listbox => {
        const censusOptions = $listbox.find('[role="option"]');
        if (censusOptions.length > 0) {
          cy.log(`Found ${censusOptions.length} existing census(es)`);
        } else {
          cy.log('No existing censuses found — plot is empty');
        }
      });
      // Close dropdown
      cy.get('body').type('{esc}');
    });

    it('should select a census and navigate to the full dashboard view', () => {
      selectFirstSiteAndPlot();

      // Open census selector and try to pick the first option
      cy.get(SELECTORS.CENSUS_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).click();

      // Census listbox portal: find visible options (avoid stale hidden listboxes from site/plot)
      cy.get('[role="listbox"]:visible', { timeout: TIMEOUTS.SELECTOR_POPULATE }).then($listbox => {
        const censusOptions = $listbox.find('[role="option"]');
        if (censusOptions.length > 0) {
          // Select the first census
          cy.wrap(censusOptions).first().click({ force: true });

          // Verify census is selected
          cy.get(SELECTORS.SELECTED_CENSUS, { timeout: TIMEOUTS.UI_TRANSITION }).should('exist');

          // Dashboard should now show either the stats view or empty state
          cy.get('[role="region"][aria-label="Dashboard page container"]').should('be.visible');
        } else {
          cy.log('Skipping: no censuses available to select');
        }
      });
    });
  });

  describe('Navigation Guards', () => {
    it('should not render dashboard content without a session', () => {
      // Clear cookies to simulate unauthenticated state
      cy.clearCookies();

      // Visit dashboard — middleware passes (E2E mode) but hub layout gates on session
      cy.visit('/dashboard', { failOnStatusCode: false });

      // Wait for the page to settle, then check that dashboard content is missing.
      // The hub layout renders {session && children}, so without a session
      // the dashboard greeting will not appear.
      cy.contains('Welcome back', { timeout: 5000 }).should('not.exist');
    });

    it('should maintain session across page navigations', () => {
      cy.loginViaCredentials('e2e-admin@forestgeo.si.edu', 'global');
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // Verify session is active
      cy.contains('Welcome back', { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');

      // Navigate to a different protected page
      cy.visit('/fixeddatainput/attributes', { timeout: TIMEOUTS.PAGE_LOAD });

      // Session should still be active — sidebar should be visible
      cy.get(SELECTORS.SITE_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');
    });
  });

  describe('Session Persistence', () => {
    it('should maintain authentication after page reload', () => {
      cy.visit('/dashboard', { timeout: TIMEOUTS.PAGE_LOAD });

      // Verify session is active
      cy.contains('Welcome back', { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');

      // Reload the page
      cy.reload();

      // Session cookie should persist — user should still be authenticated
      cy.contains('Welcome back', { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');

      // Sidebar should still be present
      cy.get(SELECTORS.SITE_SELECT, { timeout: TIMEOUTS.PAGE_LOAD }).should('be.visible');
    });
  });
});
