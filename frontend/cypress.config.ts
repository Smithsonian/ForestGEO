import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    specPattern: 'cypress/e2e/**/*.cy.{js,ts,jsx,tsx}', // E2E tests location
    baseUrl: 'http://localhost:3000', // Define the base URL for tests
    setupNodeEvents(on, config) {
      // Add node event listeners here if needed
    }
  },
  component: {
    devServer: {
      framework: 'next',
      bundler: 'webpack'
    },
    specPattern: 'cypress/components/**/*.cy.{js,ts,jsx,tsx}' // Component tests location
  }
});
