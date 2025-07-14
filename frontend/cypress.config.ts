import { defineConfig } from 'cypress';
import { DefinePlugin, ProvidePlugin } from 'webpack';

export default defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    experimentalInteractiveRunEvents: false,
    specPattern: 'cypress/e2e/**/*.cy.{js,ts,jsx,tsx}', // E2E tests location
    baseUrl: 'http://localhost:3000', // Define the base URL for tests
    setupNodeEvents(on, config) {
      return config;
    }
  },
  component: {
    devServer: {
      framework: 'next',
      bundler: 'webpack',
      webpackConfig: {
        resolve: {
          mainFields: ['main', 'module', 'browser'],
          alias: { '@mui/material/esm': '@mui/material' },
          fallback: { process: require.resolve('process/browser') }
        },
        plugins: [
          new ProvidePlugin({
            process: 'process/browser'
          }),
          new DefinePlugin({
            'process.env.NEXTAUTH_URL': JSON.stringify('http://localhost:3000')
          })
        ]
      }
    },
    supportFile: 'cypress/support/component.ts',
    specPattern: 'cypress/components/**/*.cy.{js,ts,jsx,tsx}' // Component tests location
  }
});
