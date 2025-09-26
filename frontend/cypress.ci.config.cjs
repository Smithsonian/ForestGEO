// cypress.ci.config.cjs
// Optimized configuration for CI/CD responsive testing

const path = require('path');
const { defineConfig } = require('cypress');
const { ProvidePlugin, DefinePlugin } = require('webpack');

module.exports = defineConfig({
  e2e: {
    experimentalRunAllSpecs: false, // Run specs individually for better error isolation
    specPattern: 'cypress/e2e/responsive/**/*.cy.{js,ts,jsx,tsx}',
    baseUrl: 'http://localhost:3000',

    // CI optimized settings
    viewportWidth: 1280,
    viewportHeight: 720,
    defaultCommandTimeout: 8000, // Reduced timeout for CI
    requestTimeout: 10000, // Reduced timeout for CI
    responseTimeout: 10000, // Reduced timeout for CI

    // CI specific settings
    screenshotOnRunFailure: true,
    screenshotsFolder: 'cypress/screenshots/ci-responsive',
    videosFolder: 'cypress/videos/ci-responsive',
    video: false, // Disable video recording in CI to save space

    // Retry failed tests in CI
    retries: {
      runMode: 2, // Retry failed tests twice in CI
      openMode: 0 // No retries in interactive mode
    },

    env: {
      // CI environment variables
      CI_MODE: true,
      RESPONSIVE_TEST_MODE: true,
      DEVICE_SUBSET: true, // Use subset of devices for faster CI runs
      SKIP_VISUAL_REGRESSION: false, // Keep visual regression for CI
      TEST_TIMEOUT: 8000
    },

    setupNodeEvents(on, config) {
      // CI optimizations
      on('task', {
        log(message) {
          console.log(`[CI-RESPONSIVE] ${message}`);
          return null;
        },

        // Simplified result tracking for CI
        saveCITestResult({ test, result, browser, device }) {
          const fs = require('fs');
          const resultsPath = path.join(__dirname, 'cypress', 'results', 'ci-responsive-results.json');

          let results = [];
          if (fs.existsSync(resultsPath)) {
            results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
          }

          results.push({
            timestamp: new Date().toISOString(),
            test,
            result: result ? 'PASS' : 'FAIL',
            browser,
            device,
            ci: true
          });

          fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
          fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
          return null;
        }
      });

      // CI browser launch optimizations
      on('before:browser:launch', (browser = {}, launchOptions) => {
        if (browser.family === 'chromium') {
          // CI optimized Chrome flags
          launchOptions.args.push(
            '--disable-dev-shm-usage', // Prevents memory issues in CI
            '--disable-gpu', // Disable GPU in CI
            '--no-sandbox', // Required for CI containers
            '--disable-web-security', // Allow cross-origin requests
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=VizDisplayCompositor',
            '--force-device-scale-factor=1',
            '--headless=new', // Use new headless mode
            '--memory-pressure-off', // Prevent memory pressure throttling
            '--max_old_space_size=4096' // Increase memory limit
          );
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
          alias: {
            '@/': path.resolve(__dirname, './'),
            'next-auth/react': path.resolve(__dirname, 'cypress/mocks/nextauthmock.js'),
            'next/navigation': path.resolve(__dirname, 'cypress/mocks/nextNavMock.js'),
            '@/ailogger': path.resolve(__dirname, 'cypress/mocks/ailoggerMock.js')
          }
        },
        plugins: [
          new ProvidePlugin({
            process: 'process/browser'
          }),
          new DefinePlugin({
            'process.env': JSON.stringify({
              NODE_ENV: 'test',
              CI: 'true',
              RESPONSIVE_TEST_CI: 'true'
            })
          })
        ]
      }
    },
    supportFile: 'cypress/support/component.ts'
  }
});
