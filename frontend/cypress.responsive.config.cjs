// cypress.responsive.config.cjs
// Specialized configuration for responsive and cross-browser testing

const path = require('path');
const { defineConfig } = require('cypress');
const { ProvidePlugin, DefinePlugin } = require('webpack');

module.exports = defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    experimentalInteractiveRunEvents: false,
    specPattern: 'cypress/e2e/responsive/**/*.cy.{js,ts,jsx,tsx}',
    baseUrl: 'http://localhost:3000',

    // Responsive testing specific settings
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    responseTimeout: 15000,

    // Screenshot and video settings for visual regression
    screenshotOnRunFailure: true,
    screenshotsFolder: 'cypress/screenshots/responsive',
    videosFolder: 'cypress/videos/responsive',

    env: {
      // Custom environment variables for responsive testing
      RESPONSIVE_TEST_MODE: true,
      VISUAL_REGRESSION: true,
      DEVICE_TESTING: true
    },

    setupNodeEvents(on, config) {
      // Task for device simulation
      on('task', {
        log(message) {
          console.log(message);
          return null;
        },

        // Task to get browser info for cross-browser testing
        getBrowserInfo() {
          return {
            name: config.browser?.name || 'unknown',
            version: config.browser?.version || 'unknown',
            family: config.browser?.family || 'unknown'
          };
        },

        // Task to manage responsive test results
        saveResponsiveTestResult({ device, test, result, screenshot }) {
          const fs = require('fs');
          const resultsPath = path.join(__dirname, 'cypress', 'results', 'responsive-tests.json');

          let results = [];
          if (fs.existsSync(resultsPath)) {
            results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
          }

          results.push({
            timestamp: new Date().toISOString(),
            device,
            test,
            result,
            screenshot,
            browser: config.browser?.name || 'unknown'
          });

          // Ensure directory exists
          fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
          fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

          return null;
        }
      });

      // Browser launch options for different browsers
      on('before:browser:launch', (browser = {}, launchOptions) => {
        console.log(`Launching browser: ${browser.name} (${browser.version})`);

        if (browser.family === 'chromium') {
          // Chrome/Edge specific flags for responsive testing
          launchOptions.args.push(
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--force-device-scale-factor=1'
          );

          // Enable mobile simulation
          if (browser.name === 'chrome') {
            launchOptions.args.push('--enable-touch-events');
          }
        }

        if (browser.family === 'firefox') {
          // Firefox specific settings
          launchOptions.preferences['layout.css.devPixelsPerPx'] = '1.0';
          launchOptions.preferences['browser.viewport.desktopWidth'] = 1280;
        }

        return launchOptions;
      });

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
            '@/': path.resolve(__dirname, './'),
            'next-auth/react': path.resolve(__dirname, 'cypress/mocks/nextauthmock.js'),
            'next/navigation': path.resolve(__dirname, 'cypress/mocks/nextNavMock.js'),
            '@/ailogger': path.resolve(__dirname, 'cypress/mocks/ailoggerMock.js'),
            '@/config/utils': path.resolve(__dirname, 'cypress/mocks/utilsMock.js')
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
              NODE_ENV: 'development',
              RESPONSIVE_TEST_MODE: 'true'
            })
          })
        ]
      }
    },
    supportFile: 'cypress/support/component.ts',
    specPattern: 'cypress/components/responsive/**/*.cy.{js,ts,jsx,tsx}'
  },

  // Retries for flaky responsive tests
  retries: {
    runMode: 2,
    openMode: 0
  }
});
