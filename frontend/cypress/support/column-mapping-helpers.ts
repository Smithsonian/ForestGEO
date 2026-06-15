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

Cypress.Commands.add('applyColumnMapping', (mapping: MappingTable) => {
  cy.get(`[data-testid="${DIALOG_TESTID}"]`).should('be.visible');
  Object.entries(mapping).forEach(([field, sourceColumn]) => {
    cy.get(`[data-testid="mapping-source-select-${field}"]`).click();
    // Exact-match the option label. `.contains()` is a substring match, so a
    // source column of `Tag` would also hit a `StemTag` option — the ArcGIS
    // fixture carries both headers, so an anchored regex is required here.
    const escapedSourceColumn = sourceColumn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cy.get('[role="option"]')
      .contains(new RegExp(`^${escapedSourceColumn}$`))
      .click();
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

declare global {
  namespace Cypress {
    interface Chainable {
      /** Selects a column-mapping fixture file into the real upload input. */
      uploadMeasurementFile(fixture: string, formType?: string): Chainable<void>;
      /** Drives the mapping dialog: assigns each canonicalField -> source column, then Applies. */
      applyColumnMapping(mapping: MappingTable): Chainable<void>;
      /** Stubs the bulk-upload pipeline routes hit after a mapped CSV upload. */
      interceptMappingUploadFlow(options?: MappingUploadFlowOptions): Chainable<void>;
      /** Stubs the ArcGIS preflight route with the supplied response. */
      interceptMappingPreflight(response: PreflightInterceptResponse): Chainable<void>;
    }
  }
}

export {};
