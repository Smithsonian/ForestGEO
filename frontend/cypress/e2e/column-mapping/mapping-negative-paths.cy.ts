/// <reference types="cypress" />

/**
 * Column-mapping FAILURE-path JOURNEY (wiring-level e2e).
 *
 * Companion to csv-mapping-dialog.cy.ts, which proves the happy path. This spec
 * proves the seam SURFACES failures instead of swallowing them: when the
 * server-authoritative resolution stage on /api/sqlpacketload rejects a mapped
 * upload, the user is shown the error rather than a silently "completed" upload.
 *
 * SEAM under test: UploadFireSQL.uploadToSql -> /api/sqlpacketload (POST). A
 * non-OK 4xx response flows through buildClientResponseError ("Client error
 * (<status>): <responseMessage>") -> setUploadError + ReviewStates.ERRORS ->
 * the UploadError segment renders an "Error Occurred" Alert carrying that text.
 *
 * This spec asserts WIRING only. The following are owned elsewhere and MUST NOT
 * be re-asserted here:
 *   - the wire-boundary malformed-mapping REJECTION itself (status + body) is
 *     unit-owned: app/api/sqlpacketload/route.test.ts
 *     ("rejects a malformed mapping at the wire boundary when rawRows are present");
 *   - mapping shape validation: lib/column-mapping/mapping.test.ts;
 *   - the dialog's per-field/Apply-gating logic:
 *     components/uploadsystem/segments/columnmappingdialog.test.tsx;
 *   - header-read semantics: lib/column-mapping/csv-headers.test.ts.
 *
 * NOT-E2E-REACHABLE negatives (settled, deliberately omitted; see report):
 *   - STALE stored mapping at upload -> seed-fallback surfaced: per-file mappings
 *     are keyed by filename and re-parsed from the same File (identical signature),
 *     and any content change calls dropColumnMapping first, so a present-but-stale
 *     stored mapping cannot occur through honest UI. Unit-owned:
 *     lib/column-mapping/mapping.test.ts (reasonCode: 'stale').
 *   - UNREADABLE header row -> upload blocked: extractCsvHeaderRow only rejects on
 *     a FileReader I/O failure (Papa's `error` callback for a File fires off
 *     reader.onerror, never off malformed-but-readable content). A fixture that
 *     passes the parse-step gate to reach UploadFireSQL always has a readable
 *     header row, so the block is not reproducible through honest browser UI
 *     without contriving a mid-flow read failure. Belongs to a component/unit test
 *     of parseFileInChunks, not this e2e. (See report: DONE_WITH_CONCERNS.)
 */

import { CONTINUE_UPLOAD_LABEL, MAPPING_REQUIRED_LABEL, MINIMAL_MAPPING } from '../../support/column-mapping-helpers';

const HARNESS_SCHEMA = 'forestgeo_testing';
const NONSTANDARD_FIXTURE = 'measurements-nonstandard-headers.csv';

const MAPPING_DIALOG = '[data-testid="column-mapping-dialog"]';
const OPEN_MAPPING_BUTTON = '[data-testid="open-column-mapping"]';

// HTTPResponses.INVALID_REQUEST (config/macros.ts). The route returns this status
// with { responseMessage: 'Invalid mapping payload', ... } when rawRows are present
// but the mapping fails isColumnMappingShape — see the route's unit test. We replay
// that exact (status, body) at the network boundary so the assertion exercises the
// real surfacing path without needing to forge a tampered mapping through the UI.
const INVALID_REQUEST_STATUS = 400;
const MALFORMED_MAPPING_RESPONSE_MESSAGE = 'Invalid mapping payload';

// The error text UploadFireSQL.buildClientResponseError composes from the response:
// `Client error (<status>): <responseMessage>`. The UploadError segment renders it
// verbatim inside the "Error Occurred" Alert.
const SURFACED_CLIENT_ERROR_TEXT = `Client error (${INVALID_REQUEST_STATUS}): ${MALFORMED_MAPPING_RESPONSE_MESSAGE}`;
const ERROR_SEGMENT_HEADING = 'Error Occurred';

function stubAuthAndPipeline() {
  cy.stubMappingSession();

  cy.intercept('POST', '/api/uploadsession', {
    statusCode: 200,
    body: { session: { sessionId: 'e2e-upload-session', state: 'uploading', uploadedChunks: 0, processedBatches: 0, totalBatches: 0 } }
  }).as('createUploadSession');
  cy.intercept('PATCH', '/api/uploadsession', { statusCode: 200, body: { ok: true } }).as('patchUploadSession');
  cy.intercept('DELETE', '/api/uploadsession**', { statusCode: 200, body: { ok: true } }).as('deleteUploadSession');

  // Stub the surrounding pipeline (setup/process/collapse) green so the ONLY failing
  // hop is the sqlpacketload chunk POST overridden below — the failure under test is
  // isolated to the mapping-resolution seam, not pipeline noise.
  cy.interceptMappingUploadFlow();
}

describe('CSV column-mapping failure paths', () => {
  beforeEach(() => {
    stubAuthAndPipeline();
  });

  it('surfaces a server 400 (malformed mapping) instead of silently completing the upload', () => {
    cy.enterUploadParseStep(NONSTANDARD_FIXTURE);

    cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').and('contain', MAPPING_REQUIRED_LABEL).click();
    cy.applyColumnMapping(MINIMAL_MAPPING);
    cy.get(MAPPING_DIALOG).should('not.exist');

    // Override the green sqlpacketload stub from interceptMappingUploadFlow with the
    // real malformed-mapping rejection (status + body verbatim from the route). The
    // later intercept wins, so the mapped chunk POST now hits this 400.
    cy.intercept('POST', '/api/sqlpacketload', {
      statusCode: INVALID_REQUEST_STATUS,
      body: { responseMessage: MALFORMED_MAPPING_RESPONSE_MESSAGE, fileName: NONSTANDARD_FIXTURE, batchID: 'cm-e2e-batch' }
    }).as('sqlpacketloadRejected');

    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.be.disabled').click();

    // The chunk POST actually fired and actually got the 400 — the failure is not
    // swallowed before reaching the wire.
    cy.wait('@sqlpacketloadRejected').then(interception => {
      expect(interception.response?.statusCode, 'server rejected the mapped chunk with 400').to.equal(INVALID_REQUEST_STATUS);
      expect(interception.request.body.schema, 'the mapped upload really targeted the harness schema').to.equal(HARNESS_SCHEMA);
      expect(interception.request.body.mapping, 'a confirmed mapping rode along on the rejected request').to.not.be.null;
    });

    // The UI transitioned to the error state and rendered the surfaced message — not
    // an "Upload Complete" / success screen.
    cy.contains(ERROR_SEGMENT_HEADING, { timeout: 15000 }).should('be.visible');
    cy.contains(SURFACED_CLIENT_ERROR_TEXT).should('be.visible');
    cy.contains('Upload Complete').should('not.exist');
  });
});

export {};
