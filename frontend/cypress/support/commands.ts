/// <reference types="cypress" />

/**
 * Mock site data for authentication
 */
const mockSite = {
  siteID: 1,
  siteName: 'Test Site',
  schemaName: 'test_schema',
  locationName: 'Test Location',
  country: 'Test Country',
  usesSubquadrats: false,
  plotShape: 'square',
  plotDimX: 1000,
  plotDimY: 500,
  area: 50,
  areaUnit: 'ha',
  globalID: 'test-global-id',
  sqDimX: 5,
  sqDimY: 5,
  defaultUOMDBH: 'mm',
  defaultUOMHOM: 'm',
  doubleDataEntry: false
};

/**
 * Custom command to log in as an admin user
 * Admin users have 'global' userStatus
 */
Cypress.Commands.add('loginAsAdmin', () => {
  cy.log('🔐 Logging in as Admin User');

  // Mock the session API call BEFORE any page visits
  cy.intercept('GET', '**/api/auth/session**', {
    statusCode: 200,
    body: {
      user: {
        name: 'Admin User',
        email: 'admin@forestgeo.si.edu',
        userStatus: 'global',
        sites: [mockSite],
        allsites: [mockSite]
      },
      expires: '2025-12-31T23:59:59.999Z'
    }
  }).as('sessionAdmin');

  // Also mock the csrf token endpoint that NextAuth uses
  cy.intercept('GET', '**/api/auth/csrf', {
    statusCode: 200,
    body: { csrfToken: 'mock-csrf-token' }
  }).as('csrf');

  cy.log('✅ Admin session mocked');
});

/**
 * Custom command to log in as a DB manager user
 */
Cypress.Commands.add('loginAsDBManager', () => {
  cy.log('🔐 Logging in as DB Manager');

  cy.intercept('GET', '/api/auth/session', {
    statusCode: 200,
    body: {
      user: {
        name: 'DB Manager',
        email: 'dbmanager@forestgeo.si.edu',
        userStatus: 'db manager',
        sites: [mockSite],
        allsites: [mockSite]
      },
      expires: '2025-12-31T23:59:59.999Z'
    }
  }).as('sessionDBManager');

  cy.log('✅ DB Manager session mocked');
});

/**
 * Custom command to log in as a field crew user
 */
Cypress.Commands.add('loginAsFieldCrew', () => {
  cy.log('🔐 Logging in as Field Crew');

  cy.intercept('GET', '/api/auth/session', {
    statusCode: 200,
    body: {
      user: {
        name: 'Field Crew',
        email: 'fieldcrew@forestgeo.si.edu',
        userStatus: 'field crew',
        sites: [mockSite],
        allsites: [mockSite]
      },
      expires: '2025-12-31T23:59:59.999Z'
    }
  }).as('sessionFieldCrew');

  cy.log('✅ Field Crew session mocked');
});

/**
 * Custom command to set up common API mocks
 */
Cypress.Commands.add('setupCommonMocks', () => {
  cy.log('🔧 Setting up common API mocks');

  // Mock plots data
  cy.intercept('POST', '/api/fetchall/plots**', {
    statusCode: 200,
    body: {
      output: [
        {
          plotID: 1,
          plotName: 'Test Plot',
          locationName: 'Test Location',
          countryName: 'Test Country',
          dimensionX: 1000,
          dimensionY: 500,
          area: 50,
          plotShape: 'square',
          plotDescription: 'Test plot for E2E tests',
          numQuadrats: 100,
          coordUnit: 'm'
        }
      ],
      totalCount: 1
    }
  }).as('fetchPlots');

  // Mock census data
  cy.intercept('POST', '/api/fetchall/census**', {
    statusCode: 200,
    body: {
      output: [
        {
          censusID: 1,
          plotID: 1,
          plotCensusNumber: 1,
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          description: 'Test census'
        }
      ],
      totalCount: 1
    }
  }).as('fetchCensus');

  // Mock sites data
  cy.intercept('POST', '/api/fetchall/sites**', {
    statusCode: 200,
    body: {
      output: [mockSite],
      totalCount: 1
    }
  }).as('fetchSites');

  // Mock administrative sites data
  cy.intercept('GET', '/api/administrative/fetch/sites**', {
    statusCode: 200,
    body: [mockSite]
  }).as('fetchAdminSites');

  cy.log('✅ Common mocks set up');
});

/**
 * Programmatic login via the E2E credentials provider.
 * Sends a real sign-in request to NextAuth, which sets a valid session cookie.
 * Requires the app to be running with NEXT_PUBLIC_E2E_TESTING=true.
 *
 * This replaces cy.intercept()-based session mocking for tests that need
 * to hit real API endpoints.
 */
Cypress.Commands.add('loginViaCredentials', (email = 'e2e-admin@forestgeo.si.edu', userStatus = 'global') => {
  cy.log(`Logging in via credentials provider as ${userStatus}`);

  // 1. Fetch the CSRF token that NextAuth requires
  cy.request('/api/auth/csrf').then(csrfResponse => {
    const csrfToken = csrfResponse.body.csrfToken;

    // 2. POST to the credentials provider callback to obtain a session cookie
    cy.request({
      method: 'POST',
      url: '/api/auth/callback/e2e-credentials',
      form: true,
      body: {
        email,
        userStatus,
        csrfToken
      },
      followRedirect: false
    }).then(loginResponse => {
      // NextAuth responds with a redirect (302) on success.
      // The session cookie is now set in the browser.
      expect(loginResponse.status).to.be.oneOf([200, 302]);
      cy.log(`Logged in as ${email} (${userStatus})`);
    });
  });
});

/**
 * Asserts that a data-grid row identified by `rowText` is present (and, when
 * `cellText` is given, that the row also contains `cellText`).
 *
 * Wide grids (e.g. View All Historical Data has 53 columns; treeTag is column
 * #37, speciesCode #43) column-virtualize their far-right cells out of the DOM,
 * so a plain `cy.contains('[role="row"]', 'TREE101')` finds nothing even though
 * the grid is correctly populated. This command scrolls the visible grid fully
 * right first so those identity columns render, then asserts.
 *
 * Use this ONLY for the wide grids where the asserted column is off-screen. For
 * grids whose target column is visible by default (e.g. the measurements summary
 * grid, treeTag #12), assert directly — scrolling right would virtualize it out.
 */
Cypress.Commands.add('gridRowShouldContain', (rowText: string, cellText?: string) => {
  cy.get('.MuiDataGrid-virtualScroller:visible').first().scrollTo('right', { ensureScrollable: false });
  if (cellText !== undefined) {
    cy.contains('[role="row"]', rowText).should('contain', cellText);
  } else {
    cy.contains('[role="row"]', rowText).should('be.visible');
  }
});

declare global {
  namespace Cypress {
    interface Chainable {
      loginAsAdmin(): Chainable<void>;
      loginAsDBManager(): Chainable<void>;
      loginAsFieldCrew(): Chainable<void>;
      setupCommonMocks(): Chainable<void>;
      /**
       * Programmatic login via NextAuth E2E credentials provider.
       * Sets a real session cookie — no intercept mocking needed.
       */
      loginViaCredentials(email?: string, userStatus?: string): Chainable<void>;
      /**
       * Assert a wide-grid row is present (and optionally contains cellText),
       * scrolling the grid right first so column-virtualized cells render.
       */
      gridRowShouldContain(rowText: string, cellText?: string): Chainable<void>;
    }
  }
}
