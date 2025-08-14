// cypress.config.cjs
const path = require('path');
const { defineConfig } = require('cypress');
const { ProvidePlugin, DefinePlugin } = require('webpack');

module.exports = defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    experimentalInteractiveRunEvents: false,
    specPattern: 'cypress/e2e/**/*.cy.{js,ts,jsx,tsx}',
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(_on, config) {
      return config;
    }
  },
  component: {
    devServer: {
      framework: 'next',
      bundler: 'webpack',
      webpackConfig: {
        resolve: {
          extensions: ['.js', '.jsx', '.ts', '.tsx'],
          mainFields: ['main', 'module', 'browser'],
          alias: {
            '@/': path.resolve(__dirname, 'frontend/'),
            'next-auth/react': path.resolve(__dirname, 'cypress/mocks/nextauthmock.js'),
            'next/navigation': path.resolve(__dirname, 'cypress/mocks/nextNavMock.js'),
            '@/ailogger': path.resolve(__dirname, 'cypress/mocks/ailoggerMock.js')
          },
          fallback: {
            process: require.resolve('process/browser')
          }
        },
        plugins: [
          new ProvidePlugin({
            process: 'process/browser'
          }),
          new DefinePlugin({
            'process.env': JSON.stringify({
              NEXTAUTH_URL: 'http://localhost:3000',
              NODE_ENV: 'development'
            })
          })
        ]
      }
    },
    supportFile: 'cypress/support/component.ts',
    specPattern: 'cypress/components/**/*.cy.{js,ts,jsx,tsx}'
  }
});
