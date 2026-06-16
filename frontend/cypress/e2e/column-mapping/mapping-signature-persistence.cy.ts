/// <reference types="cypress" />

/**
 * In-session column-mapping RETENTION JOURNEY (wiring-level e2e).
 *
 * Proves the persistence seam owned by components/uploadsystem/uploadparent.tsx:
 * per-file mappings live in the parent's in-memory `columnMappings`
 * (Record<fileName, ColumnMapping>), drilled into UploadParseFiles. The parent
 * holds the state, so:
 *   - a confirmed mapping SURVIVES closing and re-opening the dialog and any
 *     in-step navigation that does not touch the file (the dialog reseeds its
 *     draft from `effectiveMappingFor(fileName)`, which returns the STORED
 *     mapping when its signature still applies — uploadparsefiles.tsx:116-125),
 *   - the mapping is CLEARED when the file is removed/replaced, because
 *     handleRemoveFile/handleReplaceFile call `dropColumnMapping(name)`
 *     (uploadparent.tsx:240-252).
 *
 * This spec asserts WIRING only. Fine-grained dialog reseed-internals (Apply-gating,
 * draft rebuilds, per-field validation) are owned by
 * components/uploadsystem/segments/columnmappingdialog.test.tsx and must NOT be
 * re-asserted here.
 *
 * NAV NOTE: the CSV measurements flow has no "review then back to files" round-trip
 * — UploadFireSQL auto-fires on mount and exposes no back-to-UPLOAD_FILES control.
 * The only in-session navigation that keeps the file mounted is the mapping dialog's
 * own open/close cycle plus parse-step interactions, so that is the retention path
 * exercised here.
 *
 * STALE-SIGNATURE (bucket-3 fallback) is intentionally NOT covered: the present-but-
 * stale stored-mapping state that UploadFireSQL's `chooseEffectiveCsvMapping` falls
 * back from (reasonCode 'stale', surfacing "Saved column mapping not used") is
 * unreachable purely through the browser. The mapping is keyed by file name, the
 * fire-time headers are re-parsed from that same file, and every file-content change
 * (remove/replace) drops the mapping first — so a present mapping always carries a
 * matching signature at fire time. Exercising it requires injecting a mismatched
 * stored mapping the UI never persists; that scenario belongs in a unit test against
 * chooseEffectiveCsvMapping, not this journey. See report for the recommendation.
 *
 * The journey is driven through app/e2e-upload-harness (an E2E-only route that mounts
 * the real measurements UploadParentModal with a fixed site/plot/census).
 */

const HARNESS_ROUTE = '/e2e-upload-harness';

const NONSTANDARD_FIXTURE = 'measurements-nonstandard-headers.csv';

// The nonstandard fixture's required `date` field is the ONLY field that does not
// auto-resolve (its header is `Measured`); Tag/SpCode/QuadratName/X/Y all seed
// automatically. Mapping date -> Measured is the minimal mapping that enables Apply.
const MINIMAL_MAPPING = { date: 'Measured' } as const;
// When `date` is mapped, the Joy Select trigger renders the chosen source column; when it
// is unmapped the trigger falls back to the required-field placeholder (columnmappingdialog.tsx:123).
const MAPPED_SOURCE_COLUMN = 'Measured';
const UNMAPPED_PLACEHOLDER = 'Choose a column';

const MAPPING_DIALOG = '[data-testid="column-mapping-dialog"]';
const OPEN_MAPPING_BUTTON = '[data-testid="open-column-mapping"]';
const DATE_SOURCE_SELECT = '[data-testid="mapping-source-select-date"]';

// UploadParseFiles renders one mapping button; its label is the signal:
// "Map columns (required)" while an unmapped required field forces the dialog,
// "Review column mapping" once the file resolves.
const MAPPING_REQUIRED_LABEL = 'Map columns (required)';
const MAPPING_REVIEW_LABEL = 'Review column mapping';

// Real control labels harvested from the components:
// - UploadParentModal mode picker -> "Use Clean Re-Upload" (REVISIONS disables mapping).
// - UploadParseFiles advance button reads "Continue Upload (N file(s))" only when every
//   file is valid (i.e. the mapping has satisfied the required `date` field).
const CLEAN_REUPLOAD_BUTTON_LABEL = 'Use Clean Re-Upload';
const CONTINUE_UPLOAD_LABEL = 'Continue Upload';

// Per-file remove control in FileListEnhanced. It carries a stable `remove-file-<index>` testid
// (MUI's icon data-testids are stripped by turbopack, and Joy's class hashes are not stable hooks).
const REMOVE_FIRST_FILE_BUTTON = '[data-testid="remove-file-0"]';

function stubAuthAndPipeline() {
  cy.stubMappingSession();
  cy.intercept('POST', '/api/uploadsession', {
    statusCode: 200,
    body: { session: { sessionId: 'e2e-upload-session', state: 'uploading', uploadedChunks: 0, processedBatches: 0, totalBatches: 0 } }
  }).as('createUploadSession');
  cy.intercept('PATCH', '/api/uploadsession', { statusCode: 200, body: { ok: true } }).as('patchUploadSession');
  cy.intercept('DELETE', '/api/uploadsession**', { statusCode: 200, body: { ok: true } }).as('deleteUploadSession');
  cy.interceptMappingUploadFlow();
}

/** Enters the parse-files step with the given fixture loaded. */
function enterParseStepWithFile(fixture: string) {
  cy.visit(HARNESS_ROUTE);
  cy.get('[data-testid="e2e-upload-harness"]').should('exist');
  cy.contains('button', CLEAN_REUPLOAD_BUTTON_LABEL).click();
  cy.uploadMeasurementFile(fixture);
  cy.contains(fixture).should('be.visible');
}

/** Opens the mapping dialog from the parse step (whatever label the button currently shows). */
function openMappingDialog() {
  cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').click();
  cy.get(MAPPING_DIALOG).should('be.visible');
}

describe('In-session column-mapping retention journey', () => {
  beforeEach(() => {
    stubAuthAndPipeline();
  });

  it('retains a confirmed mapping across dialog close/reopen and parse-step navigation', () => {
    enterParseStepWithFile(NONSTANDARD_FIXTURE);

    // Unmapped required `date` forces mapping: the affordance is the required-mapping button.
    cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').and('contain', MAPPING_REQUIRED_LABEL).click();
    cy.applyColumnMapping(MINIMAL_MAPPING);
    cy.get(MAPPING_DIALOG).should('not.exist');

    // The mapping took effect at the PARENT: the required field is now satisfied, so the
    // advance button flips to the enabled "Continue Upload" state and the mapping affordance
    // degrades to the optional "Review column mapping" label (no longer "required").
    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.be.disabled');
    cy.get(OPEN_MAPPING_BUTTON).should('contain', MAPPING_REVIEW_LABEL).and('not.contain', MAPPING_REQUIRED_LABEL);

    // Navigate within the step WITHOUT touching the file: toggle the header guide open/closed.
    // The file stays mounted, so the parent's columnMappings entry must survive untouched.
    cy.contains('button', 'Header Guide').click();
    cy.contains('button', 'Header Guide').click();

    // Re-open the dialog: it reseeds its draft from effectiveMappingFor(fileName), which returns
    // the STORED mapping (signature still applies). The prior choice must persist.
    openMappingDialog();
    cy.get(DATE_SOURCE_SELECT).should('contain', MAPPED_SOURCE_COLUMN).and('not.contain', UNMAPPED_PLACEHOLDER);
  });

  it('clears the mapping when the file is removed and re-added', () => {
    enterParseStepWithFile(NONSTANDARD_FIXTURE);

    openMappingDialog();
    cy.applyColumnMapping(MINIMAL_MAPPING);
    cy.get(MAPPING_DIALOG).should('not.exist');
    cy.contains('button', CONTINUE_UPLOAD_LABEL).should('not.be.disabled');

    // Remove the file via the per-file delete control in the file list. handleRemoveFile ->
    // dropColumnMapping drops the parent's stored mapping for this file name.
    cy.get(REMOVE_FIRST_FILE_BUTTON).click({ force: true });
    cy.contains(NONSTANDARD_FIXTURE).should('not.exist');

    // Re-add the SAME fixture. With no stored mapping the required `date` field is unsatisfied
    // again, so the affordance reverts to the required-mapping button.
    cy.uploadMeasurementFile(NONSTANDARD_FIXTURE);
    cy.contains(NONSTANDARD_FIXTURE).should('be.visible');
    cy.get(OPEN_MAPPING_BUTTON, { timeout: 15000 }).should('be.visible').and('contain', MAPPING_REQUIRED_LABEL).click();

    // The dialog reseeds from seedMapping (no stored entry), so `date` is back to unmapped.
    cy.get(MAPPING_DIALOG).should('be.visible');
    cy.get(DATE_SOURCE_SELECT).should('contain', UNMAPPED_PLACEHOLDER).and('not.contain', MAPPED_SOURCE_COLUMN);
  });
});

export {};
