import testData from '../fixtures/forestgeo-test-data.json';

export type UserProfile = 'standardUser' | 'adminUser' | 'limitedUser' | 'newUser';
export type ValidityStatus = 200 | 412 | 500;

function getVisibleJoyListbox() {
  return cy.get('[role="listbox"]', { timeout: 10000 }).filter(':visible').first();
}

function selectVisibleJoyOption(optionText: string) {
  getVisibleJoyListbox().within(() => {
    cy.contains('[role="option"]', optionText).scrollIntoView().click({ force: true });
  });
}

function routeSuffixForSidebarLink(sectionLabel: string, linkLabel: string) {
  const routeMap: Record<string, Record<string, string>> = {
    'Census Hub': {
      'Census Overview': '/measurementshub/censusoverview',
      'View Data': '/measurementshub/summary',
      'View Errors': '/measurementshub/errors',
      'Post-Census Statistics': '/measurementshub/postvalidation',
      'Recent Changes': '/measurementshub/recentchanges',
      'Uploaded Files': '/measurementshub/uploadedfiles',
      'View All Historical Data': '/measurementshub/viewfulltable',
      Validations: '/measurementshub/validations'
    },
    'Stem & Plot Details': {
      'Stem Codes': '/fixeddatainput/attributes',
      Personnel: '/fixeddatainput/personnel',
      Quadrats: '/fixeddatainput/quadrats',
      'Species List': '/fixeddatainput/alltaxonomies'
    }
  };

  return routeMap[sectionLabel]?.[linkLabel];
}

/**
 * Helper class to generate realistic ForestGEO test data for any user scenario
 */
export class TestDataHelper {
  /**
   * Get user session data for different user types
   */
  static getUserSession(userType: UserProfile = 'standardUser') {
    const profile = testData.userProfiles[userType];
    const userSites = testData.sites.allSites.filter(site => profile.sites.includes(site.siteID));
    const allSites = testData.sites.allSites.filter(site => profile.allsites.includes(site.siteID));

    return {
      user: {
        name: profile.name,
        email: profile.email,
        userStatus: profile.userStatus,
        sites: userSites,
        allsites: allSites,
        permissions: profile.permissions,
        affiliation: profile.affiliation
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours from now
    };
  }

  /**
   * Get all sites (what admin sees vs what regular users see)
   */
  static getAllSites() {
    return testData.sites.allSites;
  }

  /**
   * Get user-accessible sites based on user profile
   */
  static getUserSites(userType: UserProfile = 'standardUser') {
    const profile = testData.userProfiles[userType];
    return testData.sites.allSites.filter(site => profile.sites.includes(site.siteID));
  }

  /**
   * Get plots for a specific site
   */
  static getPlotsForSite(schemaName: string) {
    return testData.plots[schemaName as keyof typeof testData.plots] || [];
  }

  /**
   * Get census data for a specific plot
   */
  static getCensusForPlot(plotId: number) {
    const plotKey = `plot${plotId}` as keyof typeof testData.census;
    return testData.census[plotKey] || [];
  }

  /**
   * Get sample quadrats (representative sample)
   */
  static getSampleQuadrats() {
    return testData.quadrats.sample;
  }

  /**
   * Generate realistic API intercepts for a user session
   */
  static generateApiIntercepts(userType: UserProfile = 'standardUser') {
    const userSession = this.getUserSession(userType);

    return {
      // Session endpoint
      session: {
        method: 'GET',
        url: '/api/auth/session',
        response: {
          statusCode: 200,
          body: userSession
        }
      },

      // Sites endpoint - returns all sites but user can only access some
      sites: {
        method: 'GET',
        url: '/api/fetchall/sites/**',
        response: {
          statusCode: 200,
          body: this.getAllSites()
        }
      },

      // Plots endpoint - dynamic based on site selection
      plots: (schemaName: string) => ({
        method: 'GET',
        url: `/api/fetchall/plots/**`,
        response: {
          statusCode: 200,
          body: this.getPlotsForSite(schemaName)
        }
      }),

      // Census endpoint - dynamic based on plot selection
      census: (plotId: number) => ({
        method: 'GET',
        url: '/api/fetchall/census/**',
        response: {
          statusCode: 200,
          body: this.getCensusForPlot(plotId)
        }
      }),

      // Quadrats endpoint
      quadrats: {
        method: 'GET',
        url: '/api/fetchall/quadrats/**',
        response: {
          statusCode: 200,
          body: this.getSampleQuadrats()
        }
      }
    };
  }

  /**
   * Set up complete test environment for a user type
   */
  static setupTestEnvironment(userType: UserProfile = 'standardUser') {
    const intercepts = this.generateApiIntercepts(userType);

    // Set up all intercepts
    cy.intercept(intercepts.session.method, intercepts.session.url, intercepts.session.response).as('getSession');
    cy.intercept(intercepts.sites.method, intercepts.sites.url, intercepts.sites.response).as('getSites');
    cy.intercept(intercepts.quadrats.method, intercepts.quadrats.url, intercepts.quadrats.response).as('getQuadrats');

    // Dynamic intercepts that depend on user selections
    cy.intercept('GET', '/api/fetchall/plots/**', req => {
      const url = new URL(req.url);
      const schemaName = url.searchParams.get('schema');
      const userSites = this.getUserSites(userType);
      const defaultSite = userSites[0]?.schemaName || 'luquillo';
      const resolvedSchema = schemaName || defaultSite;
      req.reply({
        statusCode: 200,
        body: this.getPlotsForSite(resolvedSchema)
      });
    }).as('getPlots');

    cy.intercept('GET', '/api/fetchall/census/**', req => {
      const url = new URL(req.url);
      const plotIDFromQuery = Number(url.searchParams.get('plotID'));
      const pathMatch = url.pathname.match(/\/api\/fetchall\/census\/(\d+)\//);
      const plotIDFromPath = pathMatch ? Number(pathMatch[1]) : NaN;
      const resolvedPlotID = Number.isFinite(plotIDFromQuery) && plotIDFromQuery > 0 ? plotIDFromQuery : Number.isFinite(plotIDFromPath) ? plotIDFromPath : 1;

      req.reply({
        statusCode: 200,
        body: this.getCensusForPlot(resolvedPlotID)
      });
    }).as('getCensus');

    // Dashboard metrics aggregated endpoint
    cy.intercept('GET', '/api/dashboardmetrics/all/**', {
      statusCode: 200,
      body: {
        countTrees: {
          CountTrees: 1234
        },
        countStems: {
          CountStems: 2468
        },
        activeUsers: {
          CountActiveUsers: 5
        },
        stemTypes: {
          CountOldStems: 1000,
          CountMultiStems: 500,
          CountNewRecruits: 968
        },
        progressTachometer: {
          TotalQuadrats: 100,
          PopulatedQuadrats: 95,
          PopulatedPercent: 95,
          UnpopulatedQuadrats: 'Q001;Q002;Q003;Q004;Q005'
        }
      }
    }).as('getDashboardMetrics');

    // Changelog endpoint for recent activity
    cy.intercept('GET', '/api/changelog/overview/unifiedchangelog/**', {
      statusCode: 200,
      body: [
        {
          changeID: 1,
          tableName: 'measurements',
          operation: 'UPDATE',
          oldRowState: { dbh: 10.5, hom: 1.3 },
          newRowState: { dbh: 11.2, hom: 1.3 },
          changeTimestamp: new Date().toISOString()
        },
        {
          changeID: 2,
          tableName: 'trees',
          operation: 'INSERT',
          oldRowState: {},
          newRowState: { treeTag: 'T001', speciesID: 1 },
          changeTimestamp: new Date(Date.now() - 3600000).toISOString()
        }
      ]
    }).as('getChangelog');

    return {
      userSession: this.getUserSession(userType),
      availableSites: this.getUserSites(userType),
      allSites: this.getAllSites()
    };
  }

  /**
   * Validate that user can only select sites they have access to
   */
  static validateUserAccess(userType: UserProfile, selectedSiteId: number): boolean {
    const profile = testData.userProfiles[userType];
    return profile.sites.includes(selectedSiteId);
  }

  /**
   * Get expected site/plot combinations for testing workflows
   */
  static getTestScenarios() {
    return {
      // Standard user with access to Luquillo and BCI
      standardUserFlow: {
        userType: 'standardUser' as UserProfile,
        accessibleSites: ['Luquillo', 'Barro Colorado Island'],
        restrictedSites: ['Pasoh', 'Lambir', 'Harvard Forest'],
        expectedPlots: {
          luquillo: ['Luquillo Main Plot'],
          bci: ['BCI 50-ha Plot']
        }
      },

      // Admin user with access to all sites
      adminUserFlow: {
        userType: 'adminUser' as UserProfile,
        accessibleSites: ['Luquillo', 'Barro Colorado Island', 'Pasoh', 'Lambir', 'Harvard Forest'],
        restrictedSites: [],
        expectedPlots: {
          luquillo: ['Luquillo Main Plot'],
          bci: ['BCI 50-ha Plot'],
          pasoh: ['Pasoh Main Plot'],
          harvard: ['Harvard Forest Plot']
        }
      },

      // Limited user with access to only one site
      limitedUserFlow: {
        userType: 'limitedUser' as UserProfile,
        accessibleSites: ['Luquillo'],
        restrictedSites: ['Barro Colorado Island', 'Pasoh', 'Lambir', 'Harvard Forest'],
        expectedPlots: {
          luquillo: ['Luquillo Main Plot']
        }
      },

      // New user with no site access
      newUserFlow: {
        userType: 'newUser' as UserProfile,
        accessibleSites: [],
        restrictedSites: ['Luquillo', 'Barro Colorado Island', 'Pasoh', 'Lambir', 'Harvard Forest'],
        expectedPlots: {}
      }
    };
  }
}

/**
 * Cypress command to set up a user session with realistic data
 */
declare global {
  namespace Cypress {
    interface Chainable {
      setupForestGEOUser(userType?: UserProfile): Chainable<void>;
      visitAuthenticatedPage(path?: string): Chainable<void>;
      selectSiteAndPlot(siteName: string, plotName?: string): Chainable<void>;
      selectSitePlotAndCensus(siteName: string, plotName: string, censusNumber: number): Chainable<void>;
      mockCoreDataValidity(validityByType?: Partial<Record<'attributes' | 'species' | 'quadrats', ValidityStatus>>): Chainable<void>;
      openSidebarLink(sectionLabel: string, linkLabel: string): Chainable<void>;
      openCensusHubLink(label: string): Chainable<void>;
      openFixedDataLink(label: string): Chainable<void>;
      validateUserPermissions(userType: UserProfile): Chainable<void>;
    }
  }
}

// Custom Cypress commands
Cypress.Commands.add('setupForestGEOUser', (userType: UserProfile = 'standardUser') => {
  // Clear any existing state
  cy.clearCookies();
  cy.clearLocalStorage();

  // Set up test environment
  const { userSession, availableSites } = TestDataHelper.setupTestEnvironment(userType);

  // Store user context for use in tests
  cy.wrap(userSession).as('currentUser');
  cy.wrap(availableSites).as('availableSites');
});

Cypress.Commands.add('visitAuthenticatedPage', (path = '/dashboard') => {
  cy.visit(path);
  cy.get('[data-testid="login-logout-component"]', { timeout: 10000 }).should('exist');
});

Cypress.Commands.add('selectSiteAndPlot', (siteName: string, plotName?: string) => {
  // Select site
  cy.get('[data-testid="site-select-component"]').scrollIntoView().should('be.visible');
  cy.get('body').then($body => {
    if ($body.find('[role="listbox"]:visible').length > 0) {
      cy.get('[aria-label="Select a Site"]').click({ force: true });
      cy.get('[role="listbox"]:visible').should('not.exist');
    }
  });
  cy.get('[aria-label="Select a Site"]').click({ force: true });
  selectVisibleJoyOption(siteName);

  // Verify site selection
  cy.get('[data-testid="selected-site-name"]').should('contain', siteName);
  cy.get('[data-testid="plot-select-component"]', { timeout: 10000 }).should('be.visible');

  // Select plot if specified
  if (plotName) {
    cy.get('[data-testid="plot-select-component"]').scrollIntoView().should('be.visible');
    cy.get('body').click(0, 0, { force: true });
    cy.get('[aria-label="Select a Plot"]').click({ force: true });
    selectVisibleJoyOption(plotName);

    // Verify plot selection
    cy.get('[data-testid="selected-plot-name"]').should('contain', plotName);
    cy.get('[data-testid="census-select-component"]', { timeout: 10000 }).should('be.visible');
  }
});

Cypress.Commands.add('selectSitePlotAndCensus', (siteName: string, plotName: string, censusNumber: number) => {
  cy.selectSiteAndPlot(siteName, plotName);

  cy.get('body').click(0, 0, { force: true });
  cy.get('[data-testid="census-select-component"]').scrollIntoView().should('be.visible');
  cy.get('[aria-label^="Select a Census"]').click({ force: true });
  selectVisibleJoyOption(`Census: ${censusNumber}`);
  cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', `Census: ${censusNumber}`);
});

Cypress.Commands.add('mockCoreDataValidity', (validityByType = {}) => {
  cy.intercept('GET', '**/api/cmprevalidation/**', req => {
    const url = new URL(req.url);
    const typeMatch = url.pathname.match(/\/api\/cmprevalidation\/([^/]+)/);
    const validityType = (typeMatch?.[1] as 'attributes' | 'species' | 'quadrats' | undefined) ?? 'attributes';
    const statusCode = validityByType[validityType] ?? 200;

    req.reply({
      statusCode,
      body: statusCode === 500 ? { error: `Failed to validate ${validityType}` } : { message: statusCode === 200 ? 'Valid data exists' : 'No data exists' }
    });
  }).as('checkCoreDataValidity');

  cy.intercept('GET', '**/api/validations/run?*', {
    statusCode: 200,
    body: { run: null }
  }).as('getValidationRun');
});

Cypress.Commands.add('openSidebarLink', (sectionLabel: string, linkLabel: string) => {
  cy.contains(`[data-testid^="navigate-list-item-expanded-button-${sectionLabel}-"]`, linkLabel)
    .scrollIntoView()
    .should('be.visible')
    .and('not.be.disabled')
    .click();

  const expectedRoute = routeSuffixForSidebarLink(sectionLabel, linkLabel);
  if (expectedRoute) {
    cy.url().should('include', expectedRoute);
  }
});

Cypress.Commands.add('openCensusHubLink', (label: string) => {
  cy.openSidebarLink('Census Hub', label);
});

Cypress.Commands.add('openFixedDataLink', (label: string) => {
  cy.openSidebarLink('Stem & Plot Details', label);
});

Cypress.Commands.add('validateUserPermissions', (userType: UserProfile) => {
  const scenarios = TestDataHelper.getTestScenarios();
  const scenario = scenarios[`${userType}Flow` as keyof typeof scenarios];

  // Check that accessible sites are selectable
  cy.get('[data-testid="site-select-component"]').scrollIntoView().should('be.visible');
  cy.get('[aria-label="Select a Site"]').click({ force: true });

  getVisibleJoyListbox().within(() => {
    scenario.accessibleSites.forEach(siteName => {
      cy.contains('[data-testid="site-selection-option-allowed"]', siteName).should('exist').and('not.have.attr', 'aria-disabled', 'true');
    });

    scenario.restrictedSites.forEach(siteName => {
      cy.contains('[data-testid="site-selection-option-other"]', siteName).scrollIntoView().should('exist').and('have.attr', 'aria-disabled', 'true');
    });
  });

  cy.get('body').then($body => {
    if ($body.find('[role="listbox"]:visible').length > 0) {
      cy.get('[aria-label="Select a Site"]').click({ force: true });
    }
  });
});
