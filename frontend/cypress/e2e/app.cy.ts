describe('Navigation', () => {
  it('should navigate to the about page', () => {
    // Start from the index page (uses baseUrl from cypress.config.cjs)
    cy.visit('/');
  });
});
