/// <reference types="cypress" />

/**
 * TIER B REAL-DB ANCHOR — full error-correction loop (resolve-and-remove).
 *
 * Sibling of csv-mapping-to-coremeasurements.cy.ts. Where that spec proves an
 * invalid attribute code INGESTS-yet-surfaces (row lands with a real StemGUID +
 * a validation/14 error, code NOT materialized), THIS spec proves the correction
 * that follows, end to end and with NO mocks of any layer:
 *
 *   1. Upload a batch (real browser Papa parse -> sqlpacketload ->
 *      bulkingestionprocess) carrying a VALID row (codes "A;D") and a BAD row
 *      whose quoted comma list "A,D" is ONE code the DB cannot match.
 *   2. PRE-EDIT (real DB reads): the bad row has a non-null StemGUID/
 *      CoreMeasurementID, carries a validation/14 link in measurement_error_log,
 *      and has NO cmattributes row. Capture its CoreMeasurementID + StemGUID.
 *   3. Correct the code through the REAL Errors Explorer edit flow: enter row
 *      edit mode, replace the invalid code with a valid one, run the genuine
 *      /api/edits/preview, then Apply (driving the destructive-confirm dialog as
 *      a user would).
 *   4. POST-EDIT (real DB reads): the validation/14 link is GONE, cmattributes
 *      now holds the corrected code, and CoreMeasurementID + StemGUID are the
 *      SAME as captured — the correction updated in place, it did not delete +
 *      recreate the measurement.
 *
 * The REAL resolution mechanism this asserts against (config/editplan/writers/
 * measurementssummary.ts, writeMeasurementsSummary): an Attributes edit DELETEs +
 * re-INSERTs cmattributes for the new code set, then HARD-DELETEs the
 * measurement_error_log links where me.ErrorSource='validation' for that
 * MeasurementID and resets IsValidated=NULL. It is a DELETE of the link row (not
 * a resolved-flag, not a re-validation), and the coremeasurements row is UPDATEd
 * in place — hence identity stability is the true proof of an in-place fix.
 *
 * Runs OUT of the PR gate via npm run test:e2e:realdb (needs local MySQL + the
 * Next dev server pointed at 127.0.0.1). The edit-APPLY step additionally needs
 * the dev server to satisfy the edit-plan fresh-authorization check
 * (AUTH_FUNCTIONS_POLL_URL) for the e2e user; /api/edits/apply 401s without it.
 */

import { CONTINUE_UPLOAD_LABEL } from '../../support/column-mapping-helpers';
import { ATTRIBUTE_CODE_VALIDATION_ERROR } from '@/tests/setup/ingestion-outcome';

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

// Reused verbatim from the attribute-code anchor: standard canonical headers resolve via
// passthrough (no mapping dialog), the file has NO trailing newline, and the code cells are
// QUOTED. Row 201's "A;D" materializes two valid cmattributes; row 202's "A,D" is ONE code
// the DB cannot match — it ingests successfully but surfaces the validation/14 error and
// materializes nothing. Row 202 is the row this spec corrects.
const ATTRIBUTE_FIXTURE = 'measurements-attribute-codes.csv';
const VALID_ROW_TAG = '201';
const BAD_ROW_TAG = '202';

// The seeded active attribute codes are A/D/M/B/R (tests/setup/local-db-setup.ts). The
// correction replaces the invalid "A,D" token with a single valid code; cmattributes must
// then hold exactly this code for the measurement.
const CORRECTED_ATTRIBUTE_CODE = 'A';
const CORRECTED_CMATTRIBUTES = [CORRECTED_ATTRIBUTE_CODE];

// The Errors Explorer edit surface for a successfully-ingested (StemGUID NOT NULL) row is
// measurementssummary, and the analyzer reads the current Attributes from cm.RawCodes ("A,D",
// one token) — so replacing it with the single code "A" DROPS a code and the plan is
// `destructive`, opening the PreviewDialog with a typed-confirm gate. Token mirrors
// components/editplan/previewdialog.tsx DESTRUCTIVE_CONFIRM_TOKEN.
const DESTRUCTIVE_CONFIRM_TOKEN = 'APPLY';

const ERRORS_HARNESS_ROUTE = '/e2e-errors-harness';
const ERRORS_HARNESS_TESTID = '[data-testid="e2e-errors-harness"]';
const PREVIEW_APPLY = '[data-testid="edit-preview-apply"]';
const PREVIEW_TYPED_CONFIRM = '[data-testid="edit-preview-typed-confirm-input"]';
const PREVIEW_DESTRUCTIVE_SEVERITY = '[data-testid="edit-preview-severity-destructive"]';

// validation/14 = ValidateFindInvalidAttributeCodes, surfaced by bulkingestionprocess
// STAGE 9. Sourced from the shared constant so a code drift breaks in one place.
const VALIDATION_SOURCE = ATTRIBUTE_CODE_VALIDATION_ERROR.source;
const VALIDATION_CODE = ATTRIBUTE_CODE_VALIDATION_ERROR.code;

// Condition-based completion: poll the DB until the CONDITION holds; the inter-poll gap is a
// backoff, never the completion signal. Matches the sibling anchor's polling contract.
const POLL_RETRIES = 60;
const POLL_INTERVAL_MS = 2000;

/** Inter-poll backoff that does NOT use cy.wait(ms); the assertion gate is the DB condition. */
function backoff(ms: number): Cypress.Chainable {
  return cy.wrap(null, { log: false }).then(() => new Cypress.Promise(resolve => setTimeout(resolve, ms)));
}

describe('Tier B: error correction removes the validation link, materializes the fix, and keeps identity stable', () => {
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
    // Real JWT cookie so the server-side auth() in sqlpacketload / edits.preview / edits.apply
    // succeeds; a global-role e2e user clears the edit-plan schema-access gate.
    cy.loginViaCredentials();
  });

  it('corrects an invalid attribute code through the real edit flow and resolves the error in place', () => {
    // --- SQL builders (schema-qualified, joined through stems->trees to a stable tag) ------

    // The bad row plus its live validation/14 count, in one shot. StemGUID NOT NULL + the
    // stems join means only a successfully-ingested row can satisfy this at all.
    const badRowWithErrorQuery = () =>
      `SELECT cm.CoreMeasurementID AS coreMeasurementID,
              cm.StemGUID          AS stemGUID,
              (SELECT COUNT(*)
                 FROM \`${schema}\`.measurement_error_log mel
                 JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
                WHERE mel.MeasurementID = cm.CoreMeasurementID
                  AND me.ErrorSource = '${VALIDATION_SOURCE}'
                  AND me.ErrorCode   = '${VALIDATION_CODE}') AS validationErrorCount
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       WHERE cm.StemGUID IS NOT NULL AND t.TreeTag = '${BAD_ROW_TAG}'`;

    const cmattributesForMeasurement = (coreMeasurementID: number) =>
      `SELECT cma.Code AS code
       FROM \`${schema}\`.cmattributes cma
       WHERE cma.CoreMeasurementID = ${coreMeasurementID}
       ORDER BY cma.Code`;

    // Post-edit combined probe: same identity row, its validation/14 count (must reach 0),
    // and whether the corrected code is now materialized (must reach 1).
    const correctedRowQuery = () =>
      `SELECT cm.CoreMeasurementID AS coreMeasurementID,
              cm.StemGUID          AS stemGUID,
              (SELECT COUNT(*)
                 FROM \`${schema}\`.measurement_error_log mel
                 JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
                WHERE mel.MeasurementID = cm.CoreMeasurementID
                  AND me.ErrorSource = '${VALIDATION_SOURCE}'
                  AND me.ErrorCode   = '${VALIDATION_CODE}') AS validationErrorCount,
              (SELECT COUNT(*)
                 FROM \`${schema}\`.cmattributes cma
                WHERE cma.CoreMeasurementID = cm.CoreMeasurementID
                  AND cma.Code = '${CORRECTED_ATTRIBUTE_CODE}') AS correctedCodeCount
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       WHERE cm.StemGUID IS NOT NULL AND t.TreeTag = '${BAD_ROW_TAG}'`;

    // Verbose timeout diagnostics: dump every measurement_error_log link and every
    // cmattributes row currently attached to the bad tag, so a regression names the actual
    // DB state instead of just "condition never held".
    const diagnosticsQuery = () =>
      `SELECT t.TreeTag AS tag, cm.CoreMeasurementID AS coreMeasurementID, cm.StemGUID AS stemGUID,
              me.ErrorSource AS errorSource, me.ErrorCode AS errorCode, cma.Code AS materializedCode
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       LEFT JOIN \`${schema}\`.measurement_error_log mel ON mel.MeasurementID = cm.CoreMeasurementID
       LEFT JOIN \`${schema}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       LEFT JOIN \`${schema}\`.cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
       WHERE t.TreeTag = '${BAD_ROW_TAG}'`;

    function pollDB(buildQuery: () => string, predicate: (rows: any[]) => boolean, failurePrefix: string, attempt = 0): Cypress.Chainable {
      return cy.task('queryCoremeasurements', { query: buildQuery() }).then((rows: any) => {
        const list = Array.isArray(rows) ? rows : [];
        if (predicate(list)) {
          return cy.wrap(list);
        }
        if (attempt >= POLL_RETRIES) {
          return cy.task('queryCoremeasurements', { query: diagnosticsQuery() }).then((diag: any) => {
            throw new Error(
              `${failurePrefix} after ${POLL_RETRIES} polls.\n` +
                `Last probe rows: ${JSON.stringify(list)}\n` +
                `Tag ${BAD_ROW_TAG} error+attribute state: ${JSON.stringify(diag)}`
            );
          });
        }
        return backoff(POLL_INTERVAL_MS).then(() => pollDB(buildQuery, predicate, failurePrefix, attempt + 1));
      });
    }

    // Captured pre-edit; asserted unchanged post-edit to prove in-place correction.
    let capturedCoreMeasurementID = 0;
    let capturedStemGUID = 0;

    // --- 1. Upload the batch through the REAL browser pipeline (no mocks) ------------------
    cy.enterUploadParseStep(ATTRIBUTE_FIXTURE);
    // Standard canonical headers resolve via passthrough — no mapping dialog. Continue Upload
    // enables once the real Papa parse completes and fires sqlpacketload -> bulkingestionprocess.
    cy.contains('button', CONTINUE_UPLOAD_LABEL, { timeout: 15000 }).should('not.be.disabled').click();

    // --- 2. PRE-EDIT: bad row ingested + carries validation/14 + no materialized code ------
    pollDB(
      badRowWithErrorQuery,
      rows => rows.length === 1 && Number(rows[0].validationErrorCount) === 1,
      `bad row (tag ${BAD_ROW_TAG}) never ingested with exactly one validation/${VALIDATION_CODE} error`
    ).then((rows: any) => {
      capturedCoreMeasurementID = Number(rows[0].coreMeasurementID);
      capturedStemGUID = Number(rows[0].stemGUID);
      expect(capturedCoreMeasurementID, `bad row (tag ${BAD_ROW_TAG}) got a real CoreMeasurementID`).to.be.greaterThan(0);
      expect(capturedStemGUID, `bad row (tag ${BAD_ROW_TAG}) ingested with a non-null StemGUID`).to.be.greaterThan(0);
    });

    cy.then(() => cy.task('queryCoremeasurements', { query: cmattributesForMeasurement(capturedCoreMeasurementID) })).then((rows: any) => {
      const codes = (Array.isArray(rows) ? rows : []).map((r: any) => String(r.code));
      expect(codes, `invalid code "A,D" materialized NO cmattributes row for measurement ${capturedCoreMeasurementID}`).to.deep.equal([]);
    });

    // Control: the batch really did carry a VALID row too — 201's "A;D" ingested with both
    // codes materialized and zero attribute-code errors. Proves the correction below is
    // targeted at the bad row, not a side effect of an all-or-nothing batch.
    const validRowCodesQuery = () =>
      `SELECT cma.Code AS code
       FROM \`${schema}\`.coremeasurements cm
       INNER JOIN \`${schema}\`.stems s ON s.StemGUID = cm.StemGUID
       INNER JOIN \`${schema}\`.trees t ON t.TreeID = s.TreeID
       INNER JOIN \`${schema}\`.cmattributes cma ON cma.CoreMeasurementID = cm.CoreMeasurementID
       WHERE cm.StemGUID IS NOT NULL AND t.TreeTag = '${VALID_ROW_TAG}'
       ORDER BY cma.Code`;
    cy.task('queryCoremeasurements', { query: validRowCodesQuery() }).then((rows: any) => {
      const codes = (Array.isArray(rows) ? rows : []).map((r: any) => String(r.code));
      expect(codes, `valid row (tag ${VALID_ROW_TAG}) materialized its "A;D" codes`).to.deep.equal(['A', 'D']);
    });

    // --- 3. Correct the code through the REAL Errors Explorer edit flow --------------------
    cy.visit(ERRORS_HARNESS_ROUTE);
    cy.get(ERRORS_HARNESS_TESTID).should('exist');
    cy.contains('Errors Explorer').should('be.visible');

    // The real /api/errors/explorer/query surfaces the bad row (it has an unresolved error);
    // the valid row 201 has none and never appears. Anchor on the tag cell, then the row.
    cy.contains('[data-field="treeTag"]', BAD_ROW_TAG, { timeout: 30000 }).should('be.visible');
    cy.contains('[data-field="treeTag"]', BAD_ROW_TAG).closest('.MuiDataGrid-row').as('badRow');

    // Enter row edit mode, then rewrite the codes cell. The edit cell pre-fills from the
    // uploaded RawCodes "A,D", which the grid renders as two chips (it splits display on
    // [;,]); clear them, then commit the single corrected valid code.
    cy.get('@badRow').find('[aria-label="Edit"]').click();
    cy.get('@badRow').find('[data-field="attributes"] input').as('codesInput');
    cy.get('@codesInput').click({ force: true });
    // Backspace on an empty text input removes the trailing chip; three covers the ≤2 chips
    // and is a no-op once empty. Then type the corrected code and commit it as a chip.
    cy.get('@codesInput').type('{backspace}{backspace}{backspace}', { force: true });
    cy.get('@codesInput').type(`${CORRECTED_ATTRIBUTE_CODE}{enter}`, { force: true });

    cy.get('@badRow').find('[aria-label="Save"]').click();

    // Saving runs the REAL /api/edits/preview. Replacing the "A,D" token with "A" drops a
    // code, so the plan is destructive: the PreviewDialog opens with a typed-confirm gate.
    cy.get(PREVIEW_APPLY, { timeout: 20000 }).should('be.visible');
    cy.get(PREVIEW_DESTRUCTIVE_SEVERITY).should('be.visible');
    // Condition-based: satisfy the typed-confirm only if the destructive gate is present.
    cy.get('body').then($body => {
      if ($body.find(PREVIEW_TYPED_CONFIRM).length > 0) {
        cy.get(PREVIEW_TYPED_CONFIRM).clear().type(DESTRUCTIVE_CONFIRM_TOKEN);
      }
    });
    cy.get(PREVIEW_APPLY).should('not.be.disabled').click();

    // --- 4. POST-EDIT: link removed, code materialized, identity unchanged -----------------
    pollDB(
      correctedRowQuery,
      rows => rows.length === 1 && Number(rows[0].validationErrorCount) === 0 && Number(rows[0].correctedCodeCount) === 1,
      `correction never reached the DB (validation/${VALIDATION_CODE} link cleared AND code "${CORRECTED_ATTRIBUTE_CODE}" materialized)`
    ).then((rows: any) => {
      const row = rows[0];
      // Identity stability — the true proof the fix was applied in place, not delete+recreate.
      expect(Number(row.coreMeasurementID), 'CoreMeasurementID is unchanged across the correction').to.equal(capturedCoreMeasurementID);
      expect(Number(row.stemGUID), 'StemGUID is unchanged across the correction').to.equal(capturedStemGUID);
      expect(Number(row.validationErrorCount), `validation/${VALIDATION_CODE} link is resolved (removed) for the measurement`).to.equal(0);
    });

    // Exact cmattributes set: ONLY the corrected code, no leftover/duplicate rows.
    cy.then(() => cy.task('queryCoremeasurements', { query: cmattributesForMeasurement(capturedCoreMeasurementID) })).then((rows: any) => {
      const codes = (Array.isArray(rows) ? rows : []).map((r: any) => String(r.code));
      expect(codes, `cmattributes now holds exactly the corrected code for measurement ${capturedCoreMeasurementID}`).to.deep.equal(CORRECTED_CMATTRIBUTES);
    });
  });
});

export {};
