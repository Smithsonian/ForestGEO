/// <reference types="cypress" />

/**
 * Measurements Clean Re-Upload REPLACEMENT-CONFIRMATION journey (issue #504, wiring-level e2e).
 *
 * Proves the seam UploadParent's requestCleanMeasurementsReplacementConfirmation owns, between
 * the parse-files Continue click and UploadFireSQL actually firing:
 *   - a header-only CSV is blocked by client-side file validation before the confirmation gate
 *     (and therefore before any upload) is ever reached at all,
 *   - an occupied target census (GET /api/uploads/replacement-preview -> existingRowCount > 0)
 *     opens MeasurementReplacementConfirmDialog showing that real count,
 *   - Cancel leaves the uploader on the file step with no mutation request sent,
 *   - a wrong typed phrase keeps the destructive confirm button disabled,
 *   - the exact "DELETE <N>" phrase lets the upload proceed, and the preview check itself only
 *     ever fires once per Continue click.
 *
 * This spec asserts WIRING only. The dialog's own phrase-matching/reset-on-new-count logic is a
 * pure function of props and is better owned by a unit test of
 * components/uploadsystem/segments/measurementreplacementconfirmdialog.tsx; it is not re-derived
 * here beyond the one correct/incorrect phrase each that prove the gate is actually wired to the
 * real component, not just a navigable dialog.
 *
 * Driven through app/e2e-upload-harness (the same E2E-only route and CLEAN_REUPLOAD entry point
 * as the sibling csv-mapping-dialog.cy.ts journey), schema/plotID/censusID fixed by the harness
 * (frontend/app/e2e-upload-harness/page.tsx: schema 'forestgeo_testing', plotID 1, censusID 1).
 */

import { CONTINUE_UPLOAD_LABEL, MINIMAL_MAPPING } from '../../support/column-mapping-helpers';

const HEADER_ONLY_FIXTURE = 'measurements-header-only.csv';
const NONSTANDARD_FIXTURE = 'measurements-nonstandard-headers.csv';

const OPEN_MAPPING_BUTTON = '[data-testid="open-column-mapping"]';
const MAPPING_DIALOG = '[data-testid="column-mapping-dialog"]';

// UploadParseFiles' advance button while a file is invalid (see uploadparsefiles.tsx:874);
// the same literal csv-mapping-dialog.cy.ts names FIX_ERRORS_LABEL, re-declared here rather
// than imported since that spec owns a DIFFERENT (mapping-dialog-cancel) invalid-state journey.
const FIX_ERRORS_LABEL = 'Fix validation errors to continue';

// DelimiterIssueCode.NO_DATA_ROWS' exact message (delimiterdetection.ts:341) -- a header-only
// file is a STRUCTURAL failure excluded from HEADER_COVERAGE_ISSUE_CODES, so no column mapping
// can rescue it; the message is the only user-visible proof the right code path tripped.
const NO_DATA_ROWS_MESSAGE = 'The file appears to be empty: no data rows were found beyond the header.';

// MeasurementReplacementConfirmDialog's own DOM contract (measurementreplacementconfirmdialog.tsx):
// a stable `id` on the DialogContent (not a data-testid) carries the rendered existingRowCount,
// and the three interactive controls carry data-testids.
const REPLACEMENT_DIALOG_TITLE = 'Confirm measurement replacement';
const REPLACEMENT_DESCRIPTION_SELECTOR = '#measurement-replacement-confirm-description';
const REPLACEMENT_TYPED_INPUT = '[data-testid="measurement-replacement-typed-confirm-input"]';
const REPLACEMENT_CONFIRM_BUTTON = '[data-testid="measurement-replacement-confirm"]';
const REPLACEMENT_CANCEL_BUTTON = '[data-testid="measurement-replacement-cancel"]';

// confirmationPhrase(existingRowCount) from the dialog component: `DELETE ${existingRowCount}`.
const OCCUPIED_EXISTING_ROW_COUNT = 20;
const REQUIRED_CONFIRM_PHRASE = `DELETE ${OCCUPIED_EXISTING_ROW_COUNT}`;
// One off the required count -- proves the gate checks the EXACT phrase, not just "starts with
// DELETE" or "is numeric".
const WRONG_CONFIRM_PHRASE = `DELETE ${OCCUPIED_EXISTING_ROW_COUNT - 1}`;

function stubAuthAndPipeline(existingRowCount: number) {
  cy.stubMappingSession();

  // The uploader opens a session before any chunk POST; return a usable sessionId so
  // UploadFireSQL proceeds to /api/sqlpacketload instead of erroring out (mirrors
  // csv-mapping-dialog.cy.ts's identical setup for the same real UploadFireSQL seam).
  cy.intercept('POST', '/api/uploadsession', {
    statusCode: 200,
    body: { session: { sessionId: 'e2e-upload-session', state: 'uploading', uploadedChunks: 0, processedBatches: 0, totalBatches: 0 } }
  }).as('createUploadSession');
  cy.intercept('PATCH', '/api/uploadsession', { statusCode: 200, body: { ok: true } }).as('patchUploadSession');
  cy.intercept('DELETE', '/api/uploadsession**', { statusCode: 200, body: { ok: true } }).as('deleteUploadSession');

  cy.interceptMappingUploadFlow({ existingRowCount });
}

/** Drives the nonstandard fixture through its required mapping to an enabled Continue Upload. */
function mapNonstandardFixtureAndReachContinue() {
  cy.enterUploadParseStep(NONSTANDARD_FIXTURE);
  cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').click();
  cy.applyColumnMapping(MINIMAL_MAPPING);
  cy.get(MAPPING_DIALOG).should('not.exist');
  cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.be.disabled');
}

describe('Measurement replacement confirmation journey (issue #504)', () => {
  it('blocks a header-only CSV before the replacement-preview check or any upload request', () => {
    stubAuthAndPipeline(0);

    cy.enterUploadParseStep(HEADER_ONLY_FIXTURE);

    // The structural NO_DATA_ROWS failure surfaces in the validation Alert and keeps the
    // advance button in its disabled "fix errors" state -- it never becomes the enabled
    // "Continue Upload" control, so handleInitialSubmit (and therefore the replacement-preview
    // confirmation gate it opens with) is never reached at all.
    cy.contains(NO_DATA_ROWS_MESSAGE, { timeout: 15000 }).should('be.visible');
    cy.contains('button', FIX_ERRORS_LABEL).should('be.disabled');
    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.exist');

    cy.get('@replacementPreview.all').should('have.length', 0);
    cy.get('@sqlpacketload.all').should('have.length', 0);
  });

  it('shows the real existing-row count when the target census is occupied', () => {
    stubAuthAndPipeline(OCCUPIED_EXISTING_ROW_COUNT);
    mapNonstandardFixtureAndReachContinue();

    cy.contains('button', CONTINUE_UPLOAD_LABEL).click();
    cy.wait('@replacementPreview');

    cy.contains(REPLACEMENT_DIALOG_TITLE, { timeout: 15000 }).should('be.visible');
    cy.get(REPLACEMENT_DESCRIPTION_SELECTOR).should('contain.text', String(OCCUPIED_EXISTING_ROW_COUNT));

    // The upload pipeline must not have fired merely from the dialog opening.
    cy.get('@sqlpacketload.all').should('have.length', 0);
  });

  it('cancelling the confirmation sends no mutation request and leaves the uploader on the file step', () => {
    stubAuthAndPipeline(OCCUPIED_EXISTING_ROW_COUNT);
    mapNonstandardFixtureAndReachContinue();

    cy.contains('button', CONTINUE_UPLOAD_LABEL).click();
    cy.wait('@replacementPreview');
    cy.contains(REPLACEMENT_DIALOG_TITLE).should('be.visible');

    cy.get(REPLACEMENT_CANCEL_BUTTON).click();
    cy.contains(REPLACEMENT_DIALOG_TITLE).should('not.exist');

    // handleReplacementCancelled never advances reviewState -- the parse-files step (and its
    // now-re-enabled Continue Upload control) is still what is mounted, not UploadFireSQL.
    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('be.visible').and('not.be.disabled');
    cy.get('@sqlpacketload.all').should('have.length', 0);
  });

  it('keeps the destructive confirm button disabled while the typed phrase is wrong', () => {
    stubAuthAndPipeline(OCCUPIED_EXISTING_ROW_COUNT);
    mapNonstandardFixtureAndReachContinue();

    cy.contains('button', CONTINUE_UPLOAD_LABEL).click();
    cy.wait('@replacementPreview');
    cy.contains(REPLACEMENT_DIALOG_TITLE).should('be.visible');

    cy.get(REPLACEMENT_TYPED_INPUT).type(WRONG_CONFIRM_PHRASE);
    cy.get(REPLACEMENT_CONFIRM_BUTTON).should('be.disabled');
    cy.get('@sqlpacketload.all').should('have.length', 0);
  });

  it('proceeds exactly once when the exact "DELETE <N>" phrase is typed and confirmed', () => {
    stubAuthAndPipeline(OCCUPIED_EXISTING_ROW_COUNT);
    mapNonstandardFixtureAndReachContinue();

    cy.contains('button', CONTINUE_UPLOAD_LABEL).click();
    cy.wait('@replacementPreview');
    cy.contains(REPLACEMENT_DIALOG_TITLE).should('be.visible');

    cy.get(REPLACEMENT_TYPED_INPUT).type(REQUIRED_CONFIRM_PHRASE);
    cy.get(REPLACEMENT_CONFIRM_BUTTON).should('not.be.disabled').click();

    // Confirming advances reviewState to UPLOAD_SQL, mounting the real UploadFireSQL, which
    // fires the already-stubbed chunk POST -- the dialog's "proceed" wiring actually reaches
    // the upload step, not just closes itself.
    cy.wait('@sqlpacketload');
    cy.contains(REPLACEMENT_DIALOG_TITLE).should('not.exist');

    // Exactly one replacement-preview check was made for this single Continue click --
    // confirming must not re-trigger the preview fetch.
    cy.get('@replacementPreview.all').should('have.length', 1);
  });
});

export {};
