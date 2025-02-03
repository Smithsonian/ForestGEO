import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on, config) {},
    specPattern: 'cypress/e2e/**/*.cy.{js,ts,jsx,tsx}' // Ensures e2e tests go in `cypress/e2e`
  },
  component: {
    devServer: {
      framework: 'next',
      bundler: 'webpack'
    },
    specPattern: 'cypress/component/**/*.cy.{js,ts,jsx,tsx}' // Ensures component tests go in `cypress/component`
  }
});
