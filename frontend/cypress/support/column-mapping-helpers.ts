/// <reference types="cypress" />

/**
 * Journey-level helpers for the column-mapping e2e specs. These drive the REAL
 * upload UI and assert wiring only. Fine-grained dialog logic (Apply-gating,
 * dup-field) is owned by components/uploadsystem/segments/columnmappingdialog.test.tsx
 * and must NOT be re-asserted here.
 *
 * Selector contract (added in Task 0): the dialog root, per-field source selects,
 * sheet-role selects, Apply, and Cancel carry stable data-testids. MUI Joy `Select`
 * renders a trigger button at the testid root and options as `[role="option"]`, so
 * the interaction pattern is: click the testid, then click the option by text.
 */

const FIXTURE_DIR = 'cypress/fixtures/column-mapping';
const UPLOAD_INPUT_SELECTOR = 'input[type="file"]';
const DIALOG_TESTID = 'column-mapping-dialog';
const APPLY_TESTID = 'mapping-apply';

// Shared route/label/mapping constants for the column-mapping journeys. Harvested
// from the real components (not guessed) and exported so the specs reference one
// definition instead of each redeclaring its own drifting copy:
// - HARNESS_ROUTE: app/e2e-upload-harness (CSV); ?mode=arcgis mounts the arcgis_xlsx flow.
// - CLEAN_REUPLOAD_BUTTON_LABEL: UploadParentModal mode picker (REVISIONS disables mapping).
// - CONTINUE_UPLOAD_LABEL: UploadParseFiles advance button for measurements CSV.
// - MAPPING_REQUIRED_LABEL / MAPPING_REVIEW_LABEL: the OPEN_MAPPING_BUTTON label is the
//   signal — "required" while an unmapped required field forces the dialog, "review" once resolved.
// - MINIMAL_MAPPING: the nonstandard fixture's only non-auto-resolving field (`date` -> `Measured`).
export const HARNESS_ROUTE = '/e2e-upload-harness';
export const ARCGIS_MODE_QUERY = '?mode=arcgis';
export const CLEAN_REUPLOAD_BUTTON_LABEL = 'Use Clean Re-Upload';
export const CONTINUE_UPLOAD_LABEL = 'Continue Upload';
export const MAPPING_REQUIRED_LABEL = 'Map columns (required)';
export const MAPPING_REVIEW_LABEL = 'Review column mapping';
export const MINIMAL_MAPPING = { date: 'Measured' } as const;

interface EnterUploadParseStepOptions {
  /** 'arcgis' visits the harness in arcgis_xlsx mode and uploads under the 'arcgis' form type. */
  mode?: 'csv' | 'arcgis';
}

// Minimal NextAuth session for the mapping journeys. Deliberately leaner than the
// `loginAsAdmin` command (no sites/allsites): these specs only need an authenticated
// user so the upload UI mounts, not a fully scoped site list.
const E2E_ADMIN_EMAIL = 'e2e-admin@forestgeo.si.edu';
const E2E_SESSION_EXPIRY = '2099-12-31T23:59:59.999Z';

/** canonicalField -> source column label to assign in the mapping dialog. */
type MappingTable = Record<string, string>;

interface MappingUploadFlowOptions {
  sqlpacketload?: object;
}

interface PreflightInterceptResponse {
  statusCode: number;
  body: object;
}

/**
 * Selects a fixture file into the real upload input. `formType` is accepted so
 * callers can name the upload they are exercising (e.g. 'arcgis'); the file is
 * picked through the shared dropzone input regardless of form type.
 */
Cypress.Commands.add('uploadMeasurementFile', (fixture: string, _formType = 'measurements') => {
  cy.get(UPLOAD_INPUT_SELECTOR, { timeout: 10000 }).first().selectFile(`${FIXTURE_DIR}/${fixture}`, { force: true });
});

Cypress.Commands.add('enterUploadParseStep', (fixture: string, options: EnterUploadParseStepOptions = {}) => {
  const isArcgis = options.mode === 'arcgis';
  cy.visit(isArcgis ? `${HARNESS_ROUTE}${ARCGIS_MODE_QUERY}` : HARNESS_ROUTE);
  cy.get('[data-testid="e2e-upload-harness"]').should('exist');

  // Advance past the upload-mode picker into the parse-files step. Clean re-upload
  // keeps the column-mapping flow enabled (REVISIONS would disable it).
  cy.contains('button', CLEAN_REUPLOAD_BUTTON_LABEL).click();

  cy.uploadMeasurementFile(fixture, isArcgis ? 'arcgis' : 'measurements');
  cy.contains(fixture).should('be.visible');
});

Cypress.Commands.add('applyColumnMapping', (mapping: MappingTable) => {
  cy.get(`[data-testid="${DIALOG_TESTID}"]`).should('be.visible');
  Object.entries(mapping).forEach(([field, sourceColumn]) => {
    cy.get(`[data-testid="mapping-source-select-${field}"]`).click();
    // Every per-field Joy Select renders the SAME source columns as options, and
    // Joy keeps closed listboxes' options mounted but `display:none`. Scope to the
    // single open listbox so we click the option in THIS field's popper, not a
    // hidden duplicate in another field's closed Select.
    const escapedSourceColumn = sourceColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cy.get('[role="listbox"]')
      .filter(':visible')
      .first()
      .within(() => {
        // Exact-match the option label. `.contains()` is a substring match, so a
        // source column of `Tag` would also hit a `StemTag` option — the ArcGIS
        // fixture carries both headers, so an anchored regex is required here.
        cy.contains('[role="option"]', new RegExp(`^${escapedSourceColumn}$`)).click();
      });
  });
  cy.get(`[data-testid="${APPLY_TESTID}"]`).should('not.be.disabled').click();
});

Cypress.Commands.add('interceptMappingUploadFlow', (options: MappingUploadFlowOptions = {}) => {
  cy.intercept('GET', '/api/setupbulkprocessor/**', { statusCode: 200, body: { message: 'ok' } }).as('setupProcessor');
  cy.intercept('POST', '/api/sqlpacketload', {
    statusCode: 200,
    body: options.sqlpacketload ?? { responseMessage: 'Bulk insert to SQL completed', insertedCount: 2, batchID: 'cm-e2e-batch' }
  }).as('sqlpacketload');
  cy.intercept('GET', '/api/setupbulkprocedure/**', {
    statusCode: 200,
    body: { attemptsNeeded: 1, batchFailedButHandled: false, message: 'ok' }
  }).as('processBatch');
  cy.intercept('GET', '/api/setupbulkcollapser/**', { statusCode: 200, body: { message: 'ok' } }).as('collapser');
});

Cypress.Commands.add('interceptMappingPreflight', (response: PreflightInterceptResponse) => {
  cy.intercept('POST', '/api/arcgis/preflight', response).as('preflight');
});

Cypress.Commands.add('stubMappingSession', () => {
  cy.intercept('GET', '**/api/auth/session**', {
    statusCode: 200,
    body: {
      user: { name: 'E2E Admin', email: E2E_ADMIN_EMAIL, userStatus: 'global' },
      expires: E2E_SESSION_EXPIRY
    }
  }).as('session');
});

declare global {
  namespace Cypress {
    interface Chainable {
      /** Selects a column-mapping fixture file into the real upload input. */
      uploadMeasurementFile(fixture: string, formType?: string): Chainable<void>;
      /**
       * Opens the upload harness and advances to the parse-files step with the fixture
       * loaded: visit harness (CSV; `mode: 'arcgis'` adds ?mode=arcgis), assert it mounted,
       * click "Use Clean Re-Upload", upload the fixture, assert the filename is visible.
       */
      enterUploadParseStep(fixture: string, options?: EnterUploadParseStepOptions): Chainable<void>;
      /** Drives the mapping dialog: assigns each canonicalField -> source column, then Applies. */
      applyColumnMapping(mapping: MappingTable): Chainable<void>;
      /** Stubs the bulk-upload pipeline routes hit after a mapped CSV upload. */
      interceptMappingUploadFlow(options?: MappingUploadFlowOptions): Chainable<void>;
      /** Stubs the ArcGIS preflight route with the supplied response. */
      interceptMappingPreflight(response: PreflightInterceptResponse): Chainable<void>;
      /** Stubs the minimal NextAuth session (leaner than loginAsAdmin) shared by the mapping journeys. */
      stubMappingSession(): Chainable<void>;
    }
  }
}

export {};
