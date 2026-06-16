/// <reference types="cypress" />

/**
 * CSV column-mapping dialog JOURNEY (wiring-level e2e).
 *
 * Proves the seam between the parse-files step (UploadParseFiles), the mapping
 * dialog (ColumnMappingDialog), and the upload firing step (UploadFireSQL):
 *   - a non-standard CSV forces the dialog and, once mapped, POSTs the raw rows +
 *     mapping to /api/sqlpacketload (the server is authoritative over keying),
 *   - Cancel discards the dialog and never fires the upload,
 *   - a standard CSV auto-resolves and never surfaces the mapping affordance.
 *
 * This spec asserts WIRING only. Fine-grained dialog logic (Apply-gating, dup-field
 * detection, per-field validation) is owned by
 * components/uploadsystem/segments/columnmappingdialog.test.tsx and must NOT be
 * re-asserted here.
 *
 * The journey is driven through app/e2e-upload-harness (an E2E-only route that
 * mounts the real measurements UploadParentModal with a fixed site/plot/census),
 * because the sole production entry point is a button buried in the fully populated
 * measurements summary grid.
 */

import { CONTINUE_UPLOAD_LABEL, MAPPING_REQUIRED_LABEL, MAPPING_REVIEW_LABEL, MINIMAL_MAPPING } from '../../support/column-mapping-helpers';

const HARNESS_SCHEMA = 'forestgeo_testing';

const NONSTANDARD_FIXTURE = 'measurements-nonstandard-headers.csv';
const STANDARD_FIXTURE = 'measurements-standard-headers.csv';

const MAPPING_DIALOG = '[data-testid="column-mapping-dialog"]';
const OPEN_MAPPING_BUTTON = '[data-testid="open-column-mapping"]';
const CANCEL_MAPPING_BUTTON = '[data-testid="mapping-cancel"]';

// UploadParseFiles primary advance button reads "Fix validation errors to continue"
// (disabled) while a required field is unmapped; it flips to CONTINUE_UPLOAD_LABEL
// only when every file is valid.
const FIX_ERRORS_LABEL = 'Fix validation errors to continue';

function stubAuthAndPipeline() {
  cy.stubMappingSession();

  // The uploader opens a session before any chunk POST; return a usable sessionId
  // so UploadFireSQL proceeds to /api/sqlpacketload instead of erroring out.
  cy.intercept('POST', '/api/uploadsession', {
    statusCode: 200,
    body: { session: { sessionId: 'e2e-upload-session', state: 'uploading', uploadedChunks: 0, processedBatches: 0, totalBatches: 0 } }
  }).as('createUploadSession');
  cy.intercept('PATCH', '/api/uploadsession', { statusCode: 200, body: { ok: true } }).as('patchUploadSession');
  cy.intercept('DELETE', '/api/uploadsession**', { statusCode: 200, body: { ok: true } }).as('deleteUploadSession');

  cy.interceptMappingUploadFlow();
}

describe('CSV column-mapping dialog journey', () => {
  beforeEach(() => {
    stubAuthAndPipeline();
  });

  it('maps a non-standard CSV, then POSTs raw rows + mapping to sqlpacketload', () => {
    cy.enterUploadParseStep(NONSTANDARD_FIXTURE);

    // The unmapped required `date` field forces mapping: the affordance is the
    // required-mapping button, and Continue Upload stays disabled until mapped.
    cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').and('contain', MAPPING_REQUIRED_LABEL).click();
    cy.applyColumnMapping(MINIMAL_MAPPING);
    cy.get(MAPPING_DIALOG).should('not.exist');

    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.be.disabled').click();

    cy.wait('@sqlpacketload')
      .its('request.body')
      .then(body => {
        expect(body.schema, 'schema is forwarded').to.equal(HARNESS_SCHEMA);
        expect(body.mapping, 'confirmed mapping rides along').to.not.be.null;
        expect(body.mapping.format, 'mapping is the CSV mapping shape').to.equal('csv');
        expect(body.rawRows, 'server-authoritative raw rows are sent').to.be.an('array');
        expect(body.rawRows.length, 'raw rows are non-empty').to.be.greaterThan(0);
      });
  });

  it('cancels the dialog: no mapping is applied and no upload fires', () => {
    cy.enterUploadParseStep(NONSTANDARD_FIXTURE);

    cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').click();
    cy.get(MAPPING_DIALOG).should('be.visible');
    cy.get(CANCEL_MAPPING_BUTTON).click();
    cy.get(MAPPING_DIALOG).should('not.exist');

    // Without a confirmed mapping the required `date` field is still unsatisfied,
    // so the advance button stays in its disabled "fix errors" state (it never
    // becomes the enabled "Continue Upload" control) and the pipeline is unreached.
    cy.contains('button', FIX_ERRORS_LABEL).should('be.disabled');
    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.exist');

    cy.get('@sqlpacketload.all').should('have.length', 0);
  });

  it('never forces mapping when a standard CSV fully auto-resolves', () => {
    cy.enterUploadParseStep(STANDARD_FIXTURE);

    // A fully canonical header row auto-resolves every required field, so the
    // mapping is never *required*: Continue Upload is immediately enabled and the
    // affordance degrades to an optional "Review column mapping" (never "required").
    cy.contains('button', CONTINUE_UPLOAD_LABEL, { timeout: 15000 }).should('not.be.disabled');
    cy.get(OPEN_MAPPING_BUTTON).should('be.visible').and('contain', MAPPING_REVIEW_LABEL).and('not.contain', MAPPING_REQUIRED_LABEL);
  });
});

export {};
