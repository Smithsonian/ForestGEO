// cypress/support/shared-config.cjs
// Shared configuration for all Cypress config files

const path = require('path');
const { ProvidePlugin, DefinePlugin } = require('webpack');

/**
 * Common webpack configuration for Cypress component testing
 */
function getSharedWebpackConfig(dirname, envVars = {}) {
  return {
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      mainFields: ['main', 'module', 'browser'],
      alias: {
        '@/': path.resolve(dirname, './'),
        'next-auth/react': path.resolve(dirname, 'cypress/mocks/nextauthmock.js'),
        'next/navigation': path.resolve(dirname, 'cypress/mocks/nextNavMock.js'),
        '@/ailogger': path.resolve(dirname, 'cypress/mocks/ailoggerMock.js'),
        '@/config/utils': path.resolve(dirname, 'cypress/mocks/utilsMock.js')
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
          ...envVars
        })
      })
    ]
  };
}

/**
 * Common Chromium browser flags for all configs
 */
const COMMON_CHROMIUM_FLAGS = [
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-web-security',
  '--disable-features=VizDisplayCompositor',
  '--force-device-scale-factor=1'
];

/**
 * Common log task for all configs
 */
function getLogTask(prefix = '') {
  return function log(message) {
    console.log(prefix ? `[${prefix}] ${message}` : message);
    return null;
  };
}

module.exports = {
  getSharedWebpackConfig,
  COMMON_CHROMIUM_FLAGS,
  getLogTask
};
