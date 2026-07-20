// cypress.realdb.config.cjs
//
// Tier B real-pipeline anchor config. SEPARATE from cypress.config.cjs so the
// shared, Azure-bound `queryDB` task is never touched: every DB task here is
// pinned to the LOCAL Docker MySQL (127.0.0.1:3306, root/testpassword) that the
// `test:e2e:realdb` script also points the Next dev server at via AZURE_SQL_*.
//
// The specs under cypress/e2e/column-mapping-realdb/** prove a browser-built
// column mapping survives the REAL sqlpacketload + bulkingestionprocess server
// pipeline all the way into coremeasurements, and that the error-correction
// edit flow resolves in place (resolve-and-remove.cy.ts). CI assignment: the
// upload-only anchor gates PRs (e2e-tests.yml realdb-smoke); the full directory
// runs nightly (nightly.yml realdb-full). resolve-and-remove's edit-apply step
// needs AUTH_FUNCTIONS_POLL_URL pointed at the test-only /api/e2e-auth-poll
// stub — `npm run test:e2e:realdb` and the nightly job both wire it.
const { defineConfig } = require('cypress');
const { getSharedWebpackConfig, getLogTask } = require('./cypress/support/shared-config.cjs');
const mysql = require('mysql2/promise');

// The shared DB-setup module is TypeScript. Cypress runs this config in a plain
// CommonJS Node process with no TS loader, so register a require hook that transpiles
// .ts on the fly via esbuild (already a project dependency — no new packages). The
// module only imports mysql2/fs/path/uuid (no `@/` aliases), so transpilation alone
// is sufficient; tsconfig path resolution is not required.
const esbuild = require('esbuild');
const fs = require('fs');

require.extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { code } = esbuild.transformSync(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'node18',
    sourcefile: filename
  });
  module._compile(code, filename);
};

const { setupTestDatabase, teardownTestDatabase, MEASUREMENT_TABLES_DELETE_ORDER } = require('./tests/setup/local-db-setup.ts');

// The reset task clears the measurement pipeline using the SAME canonical FK-safe
// delete order that the shared test setup defines (MEASUREMENT_TABLES_DELETE_ORDER),
// so this config no longer duplicates that FK knowledge or drifts from the real FK
// chain. The anchor drives the sqlpacketload -> bulkingestionprocess path, which
// populates exactly these measurement tables; no session-tracking table is written,
// so none needs clearing here. (The old inline list also named `upload_sessions`,
// which loadSchema does not even create in the test DB — its CREATE sits behind a
// `--` banner that the schema splitter drops — so the prior per-DELETE `.catch`
// was silently swallowing a missing-table error on every reset.)
const REALDB_RESET_TABLES = [...MEASUREMENT_TABLES_DELETE_ORDER];

// The harness site (app/e2e-upload-harness) advertises schemaName 'forestgeo_testing'
// with plotID 1 / censusID 1. That schema name is on the sqlpacketload whitelist
// (isValidSchema accepts forestgeo_*), and a fresh setupTestDatabase seeds its first
// plot + census as IDs 1, so the harness's selected scope maps onto real seeded rows.
const REALDB_SCHEMA = 'forestgeo_testing';

const LOCAL_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  user: process.env.TEST_DB_USER || 'root',
  password: process.env.TEST_DB_PASSWORD || 'testpassword',
  port: Number(process.env.TEST_DB_PORT || 3306),
  database: REALDB_SCHEMA,
  multipleStatements: true
};

// The fixture rows reference species codes ABC/DEF and quadrat Q01. Q01 is part of
// the default seed; ABC/DEF are not, and bulkingestionprocess fails any row whose
// species code is unknown (MISSING_SPECIES_FOR_TREE). Seed them so the two mapped
// rows ingest into coremeasurements instead of landing as failures.
const FIXTURE_SPECIES = [
  { code: 'ABC', name: 'Anonymous abc' },
  { code: 'DEF', name: 'Anonymous def' }
];

// Kept at module scope so reset/query/teardown tasks reuse the setup connection.
let setupHandle = null;

async function ensureFixtureSpecies(connection) {
  for (const sp of FIXTURE_SPECIES) {
    await connection.query(
      `INSERT INTO species (SpeciesCode, SpeciesName, IDLevel, IsActive)
       VALUES (?, ?, 'species', 1)
       ON DUPLICATE KEY UPDATE SpeciesName = VALUES(SpeciesName)`,
      [sp.code, sp.name]
    );
  }
}

async function runQuery(query) {
  const connection = await mysql.createConnection(LOCAL_DB_CONFIG);
  try {
    const [results] = await connection.query(query);
    return results;
  } finally {
    await connection.end();
  }
}

module.exports = defineConfig({
  e2e: {
    experimentalRunAllSpecs: true,
    experimentalInteractiveRunEvents: false,
    experimentalMemoryManagement: true,
    numTestsKeptInMemory: 5,
    // Scope to the realdb anchor only — this config is never the PR-gate runner.
    specPattern: 'cypress/e2e/column-mapping-realdb/**/*.cy.{js,ts,jsx,tsx}',
    supportFile: 'cypress/support/e2e.ts',
    baseUrl: 'http://localhost:3000',
    env: {
      NEXT_PUBLIC_E2E_TESTING: 'true',
      realdbSchema: REALDB_SCHEMA
    },
    setupNodeEvents(on, config) {
      on('task', {
        log: getLogTask(),

        // Build the schema + stored procs + validation defs + reference rows in
        // local MySQL, then add the fixture species the anchor needs. Returns the
        // schema name so the spec can assert against the right database.
        async seedColumnMappingSchema() {
          setupHandle = await setupTestDatabase({ ...LOCAL_DB_CONFIG });
          await ensureFixtureSpecies(setupHandle.connection);
          return { schema: REALDB_SCHEMA };
        },

        // Clear the measurement pipeline tables between tests so each run starts from
        // a known-empty coremeasurements/temporarymeasurements. FK-safe delete order.
        async resetColumnMappingTables() {
          const connection = await mysql.createConnection(LOCAL_DB_CONFIG);
          try {
            await connection.query('SET FOREIGN_KEY_CHECKS = 0');
            // Reuse the canonical FK-safe delete order from the shared test setup so
            // this config never drifts from the schema's real FK chain. Every table in
            // REALDB_RESET_TABLES is created by loadSchema's full tablestructures.sql,
            // so a failing DELETE is a genuine error and is allowed to throw.
            for (const table of REALDB_RESET_TABLES) {
              await connection.query(`DELETE FROM \`${REALDB_SCHEMA}\`.${table}`);
            }
            await connection.query('SET FOREIGN_KEY_CHECKS = 1');
          } finally {
            await connection.end();
          }
          return null;
        },

        // Run an arbitrary SELECT against the seeded schema. The spec polls this until
        // the ingested coremeasurements rows appear (condition-based, no fixed waits).
        async queryCoremeasurements({ query }) {
          return runQuery(query);
        },

        async teardownColumnMappingSchema() {
          if (setupHandle) {
            await teardownTestDatabase(setupHandle.connection, { database: REALDB_SCHEMA });
            setupHandle = null;
          }
          return null;
        }
      });

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
