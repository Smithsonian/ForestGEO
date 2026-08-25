/// <reference types="cypress" />

/**
 * TIER B CONFIDENCE ANCHOR — the ONLY real-DB column-mapping spec.
 *
 * Every other column-mapping e2e spec stubs /api/sqlpacketload (and the rest of the
 * bulk pipeline) so it can assert wiring fast and offline. This one does the
 * opposite: it drives a browser-built column mapping through the GENUINE server
 * pipeline — sqlpacketload (server-authoritative CSV resolution) ->
 * setupbulkprocedure (bulkingestionprocess) -> setupbulkcollapser — against a LOCAL
 * Docker MySQL, and asserts the two mapped rows actually land in coremeasurements
 * with their DBH values keyed to the canonical column.
 *
 * It runs OUT of the PR gate: it needs `docker compose up -d mysql` and the Next dev
 * server pointed at local MySQL (AZURE_SQL_* = 127.0.0.1). The `test:e2e:realdb`
 * npm script wires both up and runs ONLY this spec via cypress.realdb.config.cjs.
 *
 * Why a richer mapping than the stubbed specs' MINIMAL_MAPPING ({ date: 'Measured' }):
 * CSV resolution uses allowAliasFill=false, so ONLY explicitly-mapped headers and
 * headers whose normalized form already equals a canonical field are keyed. The
 * nonstandard fixture's QuadratName/X/Y/Diameter_cm normalize to quadratname/x/y/
 * diametercm — none of which equal the required canonical fields quadrat/lx/ly (nor
 * the optional dbh) — so they MUST be mapped for the rows to validate and for the
 * DBH value to reach MeasuredDBH. Tag/SpCode already key canonically via passthrough.
 */

import { CONTINUE_UPLOAD_LABEL } from '../../support/column-mapping-helpers';

// `loginViaCredentials` is registered in cypress/support/commands.ts (loaded at runtime
// via support/e2e.ts) but that file is outside this tsconfig's include, so re-declare the
// command signature here for the type-checker. Runtime behavior is unaffected.
declare global {
  namespace Cypress {
    interface Chainable {
      loginViaCredentials(email?: string, userStatus?: string): Chainable<void>;
    }
  }
}

const NONSTANDARD_FIXTURE = 'measurements-nonstandard-headers.csv';
const OPEN_MAPPING_BUTTON = '[data-testid="open-column-mapping"]';
const MAPPING_DIALOG = '[data-testid="column-mapping-dialog"]';

// Full mapping required for the nonstandard fixture to fully ingest. Each canonical
// field -> the fixture's source header. Tag/SpCode are intentionally omitted because
// their normalized headers already match the canonical keys via passthrough; every
// other field needs an explicit mapping because CSV resolution uses allowAliasFill=false
// (so e.g. StemID/QuadratName/X/Y/Diameter_cm never auto-resolve to stemtag/quadrat/lx/
// ly/dbh). StemID->stemtag is required because bulkingestionprocess rejects rows with a
// missing StemTag ("Missing required field: StemTag").
const FULL_MAPPING = {
  stemtag: 'StemID',
  quadrat: 'QuadratName',
  lx: 'X',
  ly: 'Y',
  dbh: 'Diameter_cm',
  date: 'Measured'
} as const;

// The fixture carries two data rows with these DBH values; proving they land in
// coremeasurements.MeasuredDBH proves server-authoritative dbh<-Diameter_cm keying.
const EXPECTED_DBH_VALUES = [12.3, 8.1];
const EXPECTED_ROW_COUNT = 2;

// Condition-based completion: poll coremeasurements until the two SUCCESSFUL rows
// (StemGUID NOT NULL) appear. The loop stops on the DB CONDITION, never on a fixed
// timer — the inter-poll gap is a backoff, not the completion signal.
const POLL_RETRIES = 60;
const POLL_INTERVAL_MS = 2000;

// Attribute-code anchor. Standard canonical headers (tag/stemtag/spcode/quadrat/lx/ly/dbh/
// codes/date) resolve via passthrough, so no mapping dialog is needed. The fixture is
// authored with NO trailing newline and QUOTED code cells so the REAL Papa parser must
// handle both edge cases. Row 201's codes cell is the quoted semicolon list "A;D" (two
// valid codes); row 202's is the quoted comma list "A,D" — ONE code the DB cannot match,
// proving the production tokenizer (bulkingestionprocess STAGE 9) never splits on commas.
const ATTRIBUTE_FIXTURE = 'measurements-attribute-codes.csv';
const SEMI_TAG = '201';
const COMMA_TAG = '202';
const SEMI_EXPECTED_CODES = ['A', 'D'];
// ValidateFindInvalidAttributeCodes — db/sql/corequeries.sql line 273, linked in
// db/sql/storedprocedures.sql STAGE 9 as ErrorSource='validation' AND ErrorCode='14'.
const ATTRIBUTE_CODE_VALIDATION_ERRORCODE = '14';
const ATTRIBUTE_ROW_COUNT = 2;

/** Inter-poll backoff that does not use cy.wait(ms); the assertion gate is the DB condition. */
function backoff(ms: number): Cypress.Chainable {
  return cy.wrap(null, { log: false }).then(() => new Cypress.Promise(resolve => setTimeout(resolve, ms)));
}

describe('Tier B: mapped CSV reaches coremeasurements through the real pipeline', () => {
  let schema: string;

  before(() => {
    cy.task('seedColumnMappingSchema').then((result: any) => {
      schema = result.schema;
      expect(schema, 'seeded schema name returned to the spec').to.be.a('string').and.not.be.empty;
    });
  });

  after(() => {
    cy.task('teardownColumnMappingSchema');
  });

  beforeEach(() => {
    cy.task('resetColumnMappingTables');
    // Real JWT cookie so the server-side auth() in sqlpacketload/setupbulkprocedure
    // succeeds (the client /api/auth/session stub alone does not satisfy auth()).
    cy.loginViaCredentials();
  });

  it('ingests the two mapped rows with DBH values keyed to MeasuredDBH', () => {
    cy.enterUploadParseStep(NONSTANDARD_FIXTURE);

    // The unmapped required `date` forces the dialog; open it and apply the full mapping.
    cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').click();
    cy.applyColumnMapping(FULL_MAPPING);
    cy.get(MAPPING_DIALOG).should('not.exist');

    // Fire the REAL pipeline. Continue Upload is enabled only once every required field is satisfied.
    cy.contains('button', CONTINUE_UPLOAD_LABEL, { timeout: 15000 }).should('not.be.disabled').click();

    // Poll coremeasurements until the two successful rows surface (sqlpacketload ->
    // bulkingestionprocess -> collapser is asynchronous from the browser's view).
    const successQuery = () =>
      `SELECT cm.CoreMeasurementID, cm.MeasuredDBH, t.TreeTag
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       WHERE cm.StemGUID IS NOT NULL
       ORDER BY cm.MeasuredDBH DESC`;

    function waitForIngestion(attempt: number): Cypress.Chainable {
      return cy.task('queryCoremeasurements', { query: successQuery() }).then((rows: any) => {
        const ingested = Array.isArray(rows) ? rows : [];
        if (ingested.length >= EXPECTED_ROW_COUNT) {
          return cy.wrap(ingested);
        }
        if (attempt >= POLL_RETRIES) {
          // Surface ingestion-failure reasons (the rows landed in coremeasurements with
          // StemGUID NULL + measurement_error_log) so a regression names WHY, not just "0 rows".
          return cy
            .task('queryCoremeasurements', {
              query: `SELECT me.ErrorMessage FROM \`${schema}\`.measurement_error_log mel JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID`
            })
            .then((errs: any) => {
              throw new Error(
                `coremeasurements never reached ${EXPECTED_ROW_COUNT} ingested rows after ${POLL_RETRIES} polls (saw ${ingested.length}). ` +
                  `Ingestion errors: ${JSON.stringify(errs)}`
              );
            });
        }
        return backoff(POLL_INTERVAL_MS).then(() => waitForIngestion(attempt + 1));
      });
    }

    waitForIngestion(0).then((rows: any) => {
      const ingested = rows as Array<{ MeasuredDBH: number | string; TreeTag: string }>;
      expect(ingested, 'exactly two successful rows ingested').to.have.length(EXPECTED_ROW_COUNT);

      const measuredDbhValues = ingested.map(r => Number(r.MeasuredDBH)).sort((a, b) => b - a);
      expect(measuredDbhValues, 'DBH values mapped from Diameter_cm into MeasuredDBH').to.deep.equal([...EXPECTED_DBH_VALUES].sort((a, b) => b - a));

      const treeTags = ingested.map(r => String(r.TreeTag)).sort();
      expect(treeTags, 'both fixture tree tags ingested').to.deep.equal(['101', '102']);
    });
  });

  it('materializes quoted semicolon codes into cmattributes and surfaces a quoted comma list as one invalid code (no trailing newline)', () => {
    cy.enterUploadParseStep(ATTRIBUTE_FIXTURE);

    // Standard canonical headers resolve via passthrough — no mapping dialog required.
    // Continue Upload enables once the real Papa parse completes over the no-trailing-newline
    // file; firing it drives the genuine sqlpacketload -> bulkingestionprocess pipeline.
    cy.contains('button', CONTINUE_UPLOAD_LABEL, { timeout: 15000 }).should('not.be.disabled').click();

    // Poll until BOTH rows ingest as successful (StemGUID NOT NULL). Row 202 still succeeds —
    // an invalid attribute code is a soft validation, not a hard failure — which also proves
    // the final row survived a file with no trailing newline (the real parser kept it).
    const bothRowsQuery = () =>
      `SELECT t.TreeTag AS tag
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       WHERE cm.StemGUID IS NOT NULL AND t.TreeTag IN ('${SEMI_TAG}', '${COMMA_TAG}')`;

    function waitForBothRows(attempt: number): Cypress.Chainable {
      return cy.task('queryCoremeasurements', { query: bothRowsQuery() }).then((rows: any) => {
        const ingested = Array.isArray(rows) ? rows : [];
        if (ingested.length >= ATTRIBUTE_ROW_COUNT) {
          return cy.wrap(ingested);
        }
        if (attempt >= POLL_RETRIES) {
          throw new Error(`both attribute-code rows never ingested after ${POLL_RETRIES} polls (saw ${ingested.length})`);
        }
        return backoff(POLL_INTERVAL_MS).then(() => waitForBothRows(attempt + 1));
      });
    }

    const codesForTag = (tag: string) =>
      `SELECT cma.Code AS code
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       INNER JOIN \`${schema}\`.cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
       WHERE t.TreeTag = '${tag}'
       ORDER BY cma.Code`;

    const attributeErrorCountForTag = (tag: string) =>
      `SELECT COUNT(*) AS n
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       INNER JOIN \`${schema}\`.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       INNER JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE t.TreeTag = '${tag}' AND me.ErrorSource = 'validation' AND me.ErrorCode = '${ATTRIBUTE_CODE_VALIDATION_ERRORCODE}'`;

    waitForBothRows(0).then(() => {
      // Semicolon list -> exactly two cmattributes rows (A and D).
      cy.task('queryCoremeasurements', { query: codesForTag(SEMI_TAG) }).then((rows: any) => {
        const codes = (Array.isArray(rows) ? rows : []).map((r: any) => String(r.code));
        expect(codes, `quoted "A;D" splits into two cmattributes rows for tag ${SEMI_TAG}`).to.deep.equal(SEMI_EXPECTED_CODES);
      });

      // Comma list -> the whole "A,D" is ONE code that matches no attribute, so nothing materializes.
      cy.task('queryCoremeasurements', { query: codesForTag(COMMA_TAG) }).then((rows: any) => {
        const codes = (Array.isArray(rows) ? rows : []).map((r: any) => String(r.code));
        expect(codes, `quoted "A,D" materializes NO cmattributes rows for tag ${COMMA_TAG}`).to.deep.equal([]);
      });

      // ...and the comma row surfaces exactly one validation/14 attribute-code error.
      cy.task('queryCoremeasurements', { query: attributeErrorCountForTag(COMMA_TAG) }).then((rows: any) => {
        const count = Number((Array.isArray(rows) ? rows : [])[0]?.n ?? -1);
        expect(count, `comma list surfaces exactly one validation/14 error for tag ${COMMA_TAG}`).to.equal(1);
      });

      // The valid semicolon row carries no attribute-code error.
      cy.task('queryCoremeasurements', { query: attributeErrorCountForTag(SEMI_TAG) }).then((rows: any) => {
        const count = Number((Array.isArray(rows) ? rows : [])[0]?.n ?? -1);
        expect(count, `semicolon list carries no attribute-code error for tag ${SEMI_TAG}`).to.equal(0);
      });
    });
  });
});

export {};
