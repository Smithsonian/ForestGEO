// cypress.config.cjs
const path = require('path');
const { defineConfig } = require('cypress');
const { getSharedWebpackConfig, getLogTask } = require('./cypress/support/shared-config.cjs');
const mysql = require('mysql2/promise');

// Database connection configuration
const DB_CONFIG = {
  host: 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: 'azureroot',
  password: 'P@ssw0rd',
  database: 'forestgeo_testing',
  port: 3306,
  ssl: { rejectUnauthorized: false },
  multipleStatements: true
};

module.exports = defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    experimentalInteractiveRunEvents: false,
    experimentalMemoryManagement: true,
    numTestsKeptInMemory: 5,
    specPattern: 'cypress/e2e/**/*.cy.{js,ts,jsx,tsx}',
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
        log: getLogTask(),

        // Database query task for E2E tests
        async queryDB({ query }) {
          const connection = await mysql.createConnection(DB_CONFIG);
          try {
            const [results] = await connection.execute(query);
            await connection.end();
            return results;
          } catch (error) {
            await connection.end();
            throw error;
          }
        }
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
