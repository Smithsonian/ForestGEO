// cypress.config.cjs
const path = require('path');
const { defineConfig } = require('cypress');
const { getSharedWebpackConfig, getLogTask } = require('./cypress/support/shared-config.cjs');

module.exports = defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    experimentalInteractiveRunEvents: false,
    experimentalMemoryManagement: true,
    numTestsKeptInMemory: 5,
    specPattern: 'cypress/e2e/**/*.cy.{js,ts,jsx,tsx}',
    // The Tier B real-pipeline anchor lives under column-mapping-realdb/ and depends on DB
    // tasks registered ONLY in cypress.realdb.config.cjs. Exclude it from the default suite
    // (test:e2e / test:e2e:ci / test:all / nightly) so those runs don't fail on its unregistered
    // tasks; it runs exclusively via `npm run test:e2e:realdb`.
    excludeSpecPattern: 'cypress/e2e/column-mapping-realdb/**/*',
    baseUrl: 'http://localhost:3000',
    env: {
      // E2E Testing mode - bypasses middleware authentication
      // This allows Cypress to mock authentication with cy.intercept()
      // ⚠️ SECURITY: Only used during E2E tests, never in production
      NEXT_PUBLIC_E2E_TESTING: 'true'
    },
    setupNodeEvents(on, config) {
      // Add log task for ingestion report output
      on('task', {
        log: getLogTask()
      });

      // Set environment variable for Next.js dev server during E2E tests
      process.env.NEXT_PUBLIC_E2E_TESTING = 'true';

      return config;
    }
  },
  component: {
    devServer: {
      framework: 'next',
      bundler: 'webpack',
      webpackConfig: getSharedWebpackConfig(__dirname, {
        NEXT_PUBLIC_E2E_TESTING: 'true'
      })
    },
    supportFile: 'cypress/support/component.ts',
    specPattern: 'cypress/components/**/*.cy.{js,ts,jsx,tsx}'
  }
});
