import testData from '../fixtures/forestgeo-test-data.json';

export type UserProfile = 'standardUser' | 'adminUser' | 'limitedUser' | 'newUser';

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
      // Default to first available site's plots
      const userSites = this.getUserSites(userType);
      const defaultSite = userSites[0]?.schemaName || 'luquillo';
      req.reply({
        statusCode: 200,
        body: this.getPlotsForSite(defaultSite)
      });
    }).as('getPlots');

    cy.intercept('GET', '/api/fetchall/census/**', req => {
      // Default to first plot's census
      req.reply({
        statusCode: 200,
        body: this.getCensusForPlot(1)
      });
    }).as('getCensus');

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
      selectSiteAndPlot(siteName: string, plotName?: string): Chainable<void>;
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

Cypress.Commands.add('selectSiteAndPlot', (siteName: string, plotName?: string) => {
  // Select site
  cy.get('[data-testid="site-select-component"]').should('be.visible');
  cy.get('[aria-label="Select a Site"]').click();
  cy.contains(siteName).click();

  // Verify site selection
  cy.get('[data-testid="selected-site-name"]').should('contain', siteName);

  // Wait for plots to load
  cy.wait('@getPlots');

  // Select plot if specified
  if (plotName) {
    cy.get('[data-testid="plot-select-component"]').should('be.visible');
    cy.get('[aria-label="Select a Plot"]').click();
    cy.contains(plotName).click();

    // Verify plot selection
    cy.get('[data-testid="selected-plot-name"]').should('contain', plotName);
  }
});

Cypress.Commands.add('validateUserPermissions', (userType: UserProfile) => {
  const scenarios = TestDataHelper.getTestScenarios();
  const scenario = scenarios[`${userType}Flow` as keyof typeof scenarios];

  // Check that accessible sites are selectable
  cy.get('[aria-label="Select a Site"]').click();

  scenario.accessibleSites.forEach(siteName => {
    cy.contains(siteName).should('be.visible').and('not.be.disabled');
  });

  // Check that restricted sites are either not visible or disabled
  scenario.restrictedSites.forEach(siteName => {
    cy.get('body').then($body => {
      if ($body.find(`[data-testid="site-selection-option-other"]:contains("${siteName}")`).length > 0) {
        // Site is visible but should be disabled
        cy.contains(siteName).parent().should('be.disabled');
      }
      // If not visible, that's also acceptable for restricted sites
    });
  });
});
