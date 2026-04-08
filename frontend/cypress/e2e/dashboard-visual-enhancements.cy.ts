/// <reference types="cypress" />

type DashboardSetupOptions = {
  changelogBody?: unknown[];
  metricsStatusCode?: number;
};

function openDashboardWithActiveCensus(options: DashboardSetupOptions = {}) {
  cy.setupForestGEOUser('standardUser');
  cy.mockCoreDataValidity();

  if (options.changelogBody !== undefined) {
    cy.intercept('GET', '/api/changelog/overview/unifiedchangelog/**', {
      statusCode: 200,
      body: options.changelogBody
    }).as('getChangelogOverride');
  }

  if (options.metricsStatusCode && options.metricsStatusCode !== 200) {
    cy.intercept('GET', '/api/dashboardmetrics/all/**', {
      statusCode: options.metricsStatusCode,
      body: { error: 'Dashboard metrics failed' }
    }).as('getDashboardMetricsError');
  }

  cy.visitAuthenticatedPage('/dashboard');
  cy.contains('Welcome back', { timeout: 10000 }).should('be.visible');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);

  if (options.metricsStatusCode && options.metricsStatusCode !== 200) {
    cy.wait('@getDashboardMetricsError');
  } else {
    cy.wait('@getDashboardMetrics');
  }

  if (options.changelogBody !== undefined) {
    cy.wait('@getChangelogOverride');
  } else {
    cy.wait('@getChangelog');
  }
}

function getProfileCard() {
  return cy.contains('Your Profile').closest('.MuiCard-root');
}

function getRecentActivityCard() {
  return cy.contains('Recent Activity').closest('.MuiCard-root');
}

describe('Dashboard Visual Enhancements E2E', () => {
  it('renders the welcome header and current context summary', () => {
    openDashboardWithActiveCensus();

    cy.get('@currentUser').then((user: any) => {
      cy.contains(`Welcome back, ${user.user.name}!`).should('be.visible');
    });
    cy.contains("Here's what's happening with your census data").should('be.visible');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 5');
  });

  it('renders the current core counts and tree classification cards', () => {
    openDashboardWithActiveCensus();

    cy.contains('Core Counts').should('be.visible');
    cy.contains('Total Trees').should('be.visible');
    cy.contains('1,234').should('be.visible');
    cy.contains('Total Stems').should('be.visible');
    cy.contains('2,468').should('be.visible');
    cy.contains('2.0 stems per tree').should('be.visible');

    cy.contains('Tree-Stem Classification').should('be.visible');
    cy.contains('Old Trees').should('be.visible');
    cy.contains('1,000').should('be.visible');
    cy.contains('New Recruits').should('be.visible');
    cy.contains('968').should('be.visible');
    cy.contains('Multi-Stems').should('be.visible');
    cy.contains('500').should('be.visible');
  });

  it('renders quadrat coverage and personnel summaries from the aggregated metrics', () => {
    openDashboardWithActiveCensus();

    cy.contains('Quadrat Coverage').should('be.visible');
    cy.contains('95%').should('be.visible');
    cy.contains('95 populated').should('be.visible');
    cy.contains('95 with data').should('be.visible');
    cy.contains('5 pending').should('be.visible');
    cy.contains('100 total').should('be.visible');
    cy.contains('Quadrats needing measurements:').should('be.visible');
    cy.contains('Q001').should('be.visible');

    cy.contains('Active Personnel').should('be.visible');
    cy.contains('5').should('be.visible');
    cy.contains('people assigned to this census').should('be.visible');
  });

  it('renders the profile card with the current user metadata and actions', () => {
    openDashboardWithActiveCensus();

    cy.get('@currentUser').then((user: any) => {
      getProfileCard().within(() => {
        cy.contains('Assigned Role').should('be.visible');
        cy.contains(user.user.userStatus).should('be.visible');
        cy.contains('Registered Email').should('be.visible');
        cy.contains(user.user.email).should('exist');
        cy.contains('Site Access').should('be.visible');
        cy.contains('Luquillo').should('exist');
        cy.contains('Barro Colorado Island').should('exist');
        cy.contains('Report incorrect info').should('be.visible');
      });
    });
  });

  it('renders recent activity entries and expands the details panel', () => {
    openDashboardWithActiveCensus();

    getRecentActivityCard().within(() => {
      cy.contains('Latest changes to census data').should('be.visible');
      cy.get('[class*="MuiAccordion"]').should('have.length.greaterThan', 0).first().click();
      cy.contains('Previous State').should('be.visible');
      cy.contains('New State').should('be.visible');
    });
  });

  it('shows the current empty-state copy when there is no recent activity', () => {
    openDashboardWithActiveCensus({ changelogBody: [] });

    getRecentActivityCard().within(() => {
      cy.contains('No Recent Activity').should('be.visible');
      cy.contains("There haven't been any changes to your census data recently.").should('be.visible');
    });
  });

  it('keeps the dashboard content visible after changing the selected census', () => {
    openDashboardWithActiveCensus();

    cy.get('body').click(0, 0, { force: true });
    cy.get('[data-testid="census-select-component"]').scrollIntoView().should('be.visible');
    cy.get('[aria-label^="Select a Census"]').click({ force: true });
    cy.get('[role="listbox"]', { timeout: 10000 })
      .filter(':visible')
      .within(() => {
        cy.contains('[role="option"]', 'Census: 4').click({ force: true });
      });

    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 4');
    cy.contains('Core Counts').should('be.visible');
    cy.contains('Quadrat Coverage').should('be.visible');
    cy.contains('Recent Activity').should('be.visible');
  });

  it('shows the aggregated metrics error banner when the metrics request fails', () => {
    openDashboardWithActiveCensus({ metricsStatusCode: 500 });

    cy.contains(/Failed to load dashboard data:/).should('be.visible');
  });

  it('keeps the current dashboard sections accessible on mobile viewports', () => {
    cy.viewport(375, 667);
    openDashboardWithActiveCensus();

    cy.get('[aria-label="Menu"]').should('be.visible');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 5');
  });
});
