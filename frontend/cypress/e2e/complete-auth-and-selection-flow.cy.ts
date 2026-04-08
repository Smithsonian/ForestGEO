describe('Complete Authentication and Site/Plot Selection Flow', () => {
  it('renders the unauthenticated login shell', () => {
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: null
    }).as('getUnauthenticatedSession');

    cy.visit('/login');
    cy.wait('@getUnauthenticatedSession');

    cy.get('[data-testid="sidebar"]').should('be.visible');
    cy.contains('ForestGEO').should('be.visible');
    cy.get('[data-testid="login-logout-component"]').should('be.visible');
    cy.contains('Login to access').should('be.visible');
  });

  it('loads the standard-user dashboard context and allows fixed-data navigation', () => {
    cy.setupForestGEOUser('standardUser');
    cy.visitAuthenticatedPage('/dashboard');

    cy.contains('Welcome back').should('be.visible');
    cy.get('@currentUser').then((user: any) => {
      cy.get('[data-testid="login-logout-component"]').should('contain.text', user.user.name).and('contain.text', user.user.email);
      cy.get('[aria-label="Logout button"]').should('exist');
    });

    cy.validateUserPermissions('standardUser');
    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');

    cy.get('[data-testid="selected-site-schema"]').should('contain', 'luquillo');
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '320');

    cy.visit('/fixeddatainput/personnel');
    cy.url().should('include', '/fixeddatainput/personnel');
    cy.get('#main-content').should('be.visible');
  });

  it('shows all sites for admin users and loads BCI plot metadata', () => {
    cy.setupForestGEOUser('adminUser');
    cy.visitAuthenticatedPage('/dashboard');

    cy.validateUserPermissions('adminUser');
    cy.selectSiteAndPlot('Barro Colorado Island', 'BCI 50-ha Plot');

    cy.get('[data-testid="selected-site-schema"]').should('contain', 'bci');
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '1250');
  });

  it('keeps restricted sites disabled for limited users', () => {
    cy.setupForestGEOUser('limitedUser');
    cy.visitAuthenticatedPage('/dashboard');

    cy.validateUserPermissions('limitedUser');
    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');

    cy.visit('/fixeddatainput/attributes');
    cy.url().should('include', '/fixeddatainput/attributes');
    cy.get('#main-content').should('be.visible');
  });

  it('prevents users without site assignments from progressing beyond the dashboard', () => {
    cy.setupForestGEOUser('newUser');
    cy.visitAuthenticatedPage('/dashboard');

    cy.validateUserPermissions('newUser');
    cy.get('[data-testid="pending-site-select"]').should('contain', 'Select a Site');

    cy.visit('/fixeddatainput/personnel');
    cy.url().should('include', '/dashboard');
  });

  it('reloads plot metadata when the selected site changes', () => {
    cy.setupForestGEOUser('standardUser');
    cy.visitAuthenticatedPage('/dashboard');

    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-site-schema"]').should('contain', 'luquillo');
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '320');

    cy.selectSiteAndPlot('Barro Colorado Island', 'BCI 50-ha Plot');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Barro Colorado Island');
    cy.get('[data-testid="selected-site-schema"]').should('contain', 'bci');
    cy.get('[data-testid="selected-plot-quadrats"]').should('contain', '1250');
    cy.get('[data-testid="census-select-component"]').should('be.visible');
  });

  it('keeps the dashboard shell visible when site list loading fails', () => {
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
        expires: '2026-12-31T23:59:59.999Z'
      }
    }).as('getSessionWithoutSites');

    cy.intercept('GET', '/api/fetchall/sites/**', {
      statusCode: 500,
      body: { error: 'Internal Server Error' }
    }).as('getSitesError');

    cy.visit('/dashboard');
    cy.wait('@getSessionWithoutSites');
    cy.wait('@getSitesError');

    cy.get('[data-testid="login-logout-component"]').should('exist');
    cy.contains('Welcome back').should('be.visible');
    cy.get('[data-testid="pending-site-select"]').should('contain', 'Select a Site');
  });

  it('maintains selected site and plot state across page refresh', () => {
    cy.setupForestGEOUser('standardUser');
    cy.visitAuthenticatedPage('/dashboard');

    cy.selectSiteAndPlot('Luquillo', 'Luquillo Main Plot');

    cy.reload();
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.contains('Welcome back').should('be.visible');
  });
});
