import { TestDataHelper } from '../support/test-data-helpers';

describe('Complete Authentication and Site/Plot Selection Flow', () => {
  beforeEach(() => {
    // Set up test environment with realistic ForestGEO data
    cy.setupForestGEOUser('standardUser');
  });

  it('completes full authentication and site/plot selection workflow as standard user', () => {
    // Step 1: Visit login page
    cy.visit('/login');

    // Verify we're on login page and unauthenticated
    cy.get('[data-testid="sidebar"]').should('be.visible');
    cy.contains('ForestGEO').should('be.visible');
    cy.get('[data-testid="login-logout-component"]').should('be.visible');
    cy.contains('Login to access').should('be.visible');

    // Step 2: Simulate successful authentication
    cy.get('[aria-label="Login button"]').click();

    // Step 3: Should redirect to dashboard after successful login
    cy.url().should('include', '/dashboard');

    // Wait for session to be established
    cy.wait('@getSession');

    // Verify authenticated state with realistic user data
    cy.get('@currentUser').then((user: any) => {
      cy.get('[data-testid="login-logout-component"]').within(() => {
        cy.contains(user.user.name).should('be.visible');
        cy.contains(user.user.email).should('be.visible');
        cy.get('[aria-label="Logout button"]').should('be.visible');
      });
    });

    // Step 4: Verify user can only see their assigned sites
    cy.validateUserPermissions('standardUser');

    // Step 5: Select Luquillo site (user has access)
    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');

    // Verify realistic site information is displayed
    cy.get('[data-testid="selected-site-schema"]').should('contain', 'luquillo');

    // Verify realistic plot information is displayed
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '320'); // Luquillo has 320 quadrats

    // Step 6: Verify data loading cascade with real census data
    cy.wait('@getCensus');
    cy.wait('@getQuadrats');

    // Step 7: Test navigation to protected page works
    cy.visit('/fixeddatainput/personnel');
    cy.url().should('include', '/fixeddatainput/personnel');
    cy.get('#main-content').should('be.visible');
  });

  it('tests admin user with access to all sites', () => {
    // Set up admin user environment
    cy.setupForestGEOUser('adminUser');

    cy.visit('/dashboard');
    cy.wait('@getSession');

    // Admin should see all sites
    cy.get('[aria-label="Select a Site"]').click();

    // Verify admin can see all ForestGEO sites
    cy.contains('Luquillo').should('be.visible');
    cy.contains('Barro Colorado Island').should('be.visible');
    cy.contains('Pasoh').should('be.visible');
    cy.contains('Lambir').should('be.visible');
    cy.contains('Harvard Forest').should('be.visible');

    // Test selecting BCI (50-ha plot with extensive census history)
    cy.selectSiteAndPlot('Barro Colorado Island', 'BCI 50-ha Plot');

    // Verify BCI-specific data
    cy.get('[data-testid="selected-site-schema"]').should('contain', 'bci');
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '1250'); // BCI has 1250 quadrats
  });

  it('tests limited user with access to only one site', () => {
    // Set up limited user environment
    cy.setupForestGEOUser('limitedUser');

    cy.visit('/dashboard');
    cy.wait('@getSession');

    // Limited user should only see Luquillo
    cy.validateUserPermissions('limitedUser');

    // Should be able to select their one accessible site
    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');

    // Verify they can work with their assigned site
    cy.visit('/fixeddatainput/attributes');
    cy.url().should('include', '/fixeddatainput/attributes');
  });

  it('tests new user with no site assignments', () => {
    // Set up new user environment (no site access)
    cy.setupForestGEOUser('newUser');

    cy.visit('/dashboard');
    cy.wait('@getSession');

    // New user should see all sites but can't access any
    cy.get('[aria-label="Select a Site"]').click();

    // All sites should be disabled/inaccessible
    cy.validateUserPermissions('newUser');

    // Should not be able to proceed to protected pages
    cy.visit('/fixeddatainput/personnel');
    cy.url().should('include', '/dashboard'); // Should redirect back
  });

  it('tests site change workflow maintains data integrity', () => {
    cy.visit('/dashboard');
    cy.wait('@getSession');

    // Start with Luquillo
    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');

    // Verify Luquillo-specific data
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '320');

    // Change to BCI (if user has access)
    cy.get('@availableSites').then((sites: any) => {
      const bciSite = sites.find((site: any) => site.siteName === 'Barro Colorado Island');
      if (bciSite) {
        cy.selectSiteAndPlot('Barro Colorado Island', 'BCI 50-ha Plot');

        // Verify BCI-specific data loaded
        cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '1250');

        // Verify census data updated for new site
        cy.wait('@getCensus');
      }
    });
  });

  it('handles site/plot selection changes and data refresh', () => {
    // Set up authenticated session
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: {
          name: 'Test User',
          email: 'test@forestgeo.si.edu',
          userStatus: 'active',
          sites: [
            { siteID: 1, siteName: 'Luquillo', schemaName: 'luquillo' },
            { siteID: 2, siteName: 'BCI', schemaName: 'bci' }
          ],
          allsites: [
            { siteID: 1, siteName: 'Luquillo', schemaName: 'luquillo' },
            { siteID: 2, siteName: 'BCI', schemaName: 'bci' }
          ]
        },
        expires: '2024-12-31T23:59:59.999Z'
      }
    }).as('getSessionWithSites');

    cy.visit('/dashboard');
    cy.wait('@getSessionWithSites');

    // Select initial site and plot
    cy.get('[data-testid="site-select-component"]').should('be.visible');
    cy.get('[aria-label="Select a Site"]').click();
    cy.wait('@getSites');
    cy.contains('Luquillo').click();

    cy.wait('@getPlots');
    cy.get('[data-testid="plot-select-component"]').click();
    cy.get('[data-testid="plot-selection-option"]').first().click();

    // Verify initial selections
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');

    // Change site selection
    cy.get('[aria-label="Select a Site"]').click();
    cy.contains('BCI').click();

    // Plot selection should be cleared and new plots should load
    cy.wait('@getPlots');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'BCI');

    // Plot dropdown should be available for new site
    cy.get('[data-testid="plot-select-component"]').should('be.visible');
  });

  it('handles authentication errors gracefully', () => {
    // Mock authentication failure
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 401,
      body: { error: 'Unauthorized' }
    }).as('getSessionError');

    cy.visit('/dashboard');
    cy.wait('@getSessionError');

    // Should redirect to login page
    cy.url().should('include', '/login');
    cy.contains('Login to access').should('be.visible');
  });

  it('handles API errors for site/plot data gracefully', () => {
    // Set up authenticated session
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: {
          name: 'Test User',
          email: 'test@forestgeo.si.edu',
          userStatus: 'active',
          sites: [],
          allsites: []
        },
        expires: '2024-12-31T23:59:59.999Z'
      }
    }).as('getSessionForError');

    // Mock API error for sites
    cy.intercept('GET', '/api/fetchall/sites/**', {
      statusCode: 500,
      body: { error: 'Internal Server Error' }
    }).as('getSitesError');

    cy.visit('/dashboard');
    cy.wait('@getSessionForError');

    // Site loading should handle error gracefully
    cy.wait('@getSitesError');

    // Should still show the site selection component
    cy.get('[data-testid="pending-site-select"]').should('be.visible');
  });

  it('maintains selection state across page navigation', () => {
    // Set up full authenticated session with selections
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: {
          name: 'Test User',
          email: 'test@forestgeo.si.edu',
          userStatus: 'active',
          sites: [{ siteID: 1, siteName: 'Luquillo', schemaName: 'luquillo' }],
          allsites: [{ siteID: 1, siteName: 'Luquillo', schemaName: 'luquillo' }]
        },
        expires: '2024-12-31T23:59:59.999Z'
      }
    }).as('getSessionForNavigation');

    cy.visit('/dashboard');
    cy.wait('@getSessionForNavigation');

    // Make site and plot selections
    cy.get('[aria-label="Select a Site"]').click();
    cy.wait('@getSites');
    cy.contains('Luquillo').click();

    cy.wait('@getPlots');
    cy.get('[data-testid="plot-select-component"]').click();
    cy.get('[data-testid="plot-selection-option"]').first().click();

    // Navigate to different page
    cy.visit('/fixeddatainput/attributes');

    // Selections should be maintained
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('be.visible');
  });
});
