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

declare global {
  namespace Cypress {
    interface Chainable {
      loginAsAdmin(): Chainable<void>;
      loginAsDBManager(): Chainable<void>;
      loginAsFieldCrew(): Chainable<void>;
      setupCommonMocks(): Chainable<void>;
    }
  }
}
