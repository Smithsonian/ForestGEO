/// <reference types="cypress" />

import { buildErrorsExplorerRow, mockErrorsExplorerApi } from '../support/errors-explorer-helpers';

/**
 * Verifies that validation errors for invalid attribute codes and abnormally
 * high DBH values surface in the current Errors Explorer UI (View Errors).
 *
 * The validation RULES (thresholds, attribute-code resolution, boundaries) are
 * covered by the integration suite; this e2e covers only the display path —
 * that View Errors lists these validation errors and exposes their source
 * and message in the row details sheet.
 */

const INVALID_ATTRIBUTE_MESSAGE = 'Attribute code does not exist in attributes table';
const ABNORMAL_DBH_MESSAGE = 'Measured DBH is abnormally high';
const MISSING_MEASUREMENT_MESSAGE = 'Missing measurement data';
const TITLE_SELECTOR = '[data-testid="errors-explorer-title"]';
const DETAILS_SHEET_SELECTOR = '[data-testid="error-row-details-sheet"]';

const invalidAttributeCodeRow = buildErrorsExplorerRow({
  id: 123,
  coreMeasurementID: 123,
  treeTag: 'TREE-011380',
  attributes: 'MX',
  primaryErrorMessage: INVALID_ATTRIBUTE_MESSAGE,
  errorMessages: [INVALID_ATTRIBUTE_MESSAGE],
  errorSources: ['validation'],
  errorFields: ['attributes'],
  errorCodes: ['INVALID_ATTRIBUTE_CODE'],
  description: INVALID_ATTRIBUTE_MESSAGE
});

const abnormalDbhRow = buildErrorsExplorerRow({
  id: 124,
  coreMeasurementID: 124,
  treeTag: 'TREE-026600',
  measuredDBH: 26600,
  primaryErrorMessage: ABNORMAL_DBH_MESSAGE,
  errorMessages: [ABNORMAL_DBH_MESSAGE],
  errorSources: ['validation'],
  errorFields: ['measuredDBH'],
  errorCodes: ['ABNORMAL_HIGH_DBH'],
  description: ABNORMAL_DBH_MESSAGE
});

const multiErrorRow = buildErrorsExplorerRow({
  id: 125,
  coreMeasurementID: 125,
  treeTag: 'TREE-000125',
  attributes: 'MX',
  measuredDBH: 26600,
  primaryErrorMessage: INVALID_ATTRIBUTE_MESSAGE,
  errorMessages: [INVALID_ATTRIBUTE_MESSAGE, ABNORMAL_DBH_MESSAGE],
  errorSources: ['validation', 'validation'],
  errorFields: ['attributes', 'measuredDBH'],
  errorCodes: ['INVALID_ATTRIBUTE_CODE', 'ABNORMAL_HIGH_DBH'],
  errorCount: 2,
  description: INVALID_ATTRIBUTE_MESSAGE
});

const ingestionOnlyRow = buildErrorsExplorerRow({
  id: 126,
  coreMeasurementID: 126,
  treeTag: 'TREE-000126',
  primaryErrorMessage: MISSING_MEASUREMENT_MESSAGE,
  errorMessages: [MISSING_MEASUREMENT_MESSAGE],
  errorSources: ['ingestion'],
  errorFields: ['measuredDBH'],
  errorCodes: ['MISSING_MEASUREMENT_DATA'],
  description: MISSING_MEASUREMENT_MESSAGE
});

function openErrorsExplorer() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.contains('Welcome back').should('be.visible');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Errors');
  cy.wait('@fetchErrorFacets');
  cy.wait('@fetchErrorsExplorerRows');
  cy.get(TITLE_SELECTOR).should('have.text', 'View Errors');
}

function getExplorerRow(text: string) {
  return cy.contains('.MuiDataGrid-row', text);
}

function openRowDetails(text: string) {
  getExplorerRow(text).find('[aria-label="Details"]').click();
  cy.wait('@fetchErrorDetails');
}

describe('Upload System - Invalid Code Validations', () => {
  beforeEach(() => {
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('surfaces an invalid attribute code as a validation error', () => {
    mockErrorsExplorerApi({ rows: [invalidAttributeCodeRow] });

    openErrorsExplorer();

    getExplorerRow(INVALID_ATTRIBUTE_MESSAGE).should('be.visible').and('contain', 'TREE-011380');

    openRowDetails(INVALID_ATTRIBUTE_MESSAGE);

    cy.get(DETAILS_SHEET_SELECTOR).within(() => {
      cy.contains('Measurement 123').should('be.visible');
      cy.contains(INVALID_ATTRIBUTE_MESSAGE).should('be.visible');
      cy.get('[data-testid="error-source-chip-validation"]').should('be.visible').and('have.text', 'Validation');
    });
  });

  it('surfaces an abnormally high DBH as a validation error', () => {
    mockErrorsExplorerApi({ rows: [abnormalDbhRow] });

    openErrorsExplorer();

    getExplorerRow(ABNORMAL_DBH_MESSAGE).should('be.visible').and('contain', 'TREE-026600');

    openRowDetails(ABNORMAL_DBH_MESSAGE);

    cy.get(DETAILS_SHEET_SELECTOR).within(() => {
      cy.contains('Measurement 124').should('be.visible');
      cy.contains(ABNORMAL_DBH_MESSAGE).should('be.visible');
      cy.get('[data-testid="error-source-chip-validation"]').should('be.visible').and('have.text', 'Validation');
    });
  });

  it('reports both validation errors on a single measurement', () => {
    mockErrorsExplorerApi({ rows: [multiErrorRow] });

    openErrorsExplorer();

    openRowDetails(INVALID_ATTRIBUTE_MESSAGE);

    // Both validation errors for the same measurement are listed in its details.
    cy.get(DETAILS_SHEET_SELECTOR).within(() => {
      cy.get('[data-testid="error-row-details-error-card"]').should('have.length', 2);
      cy.get('[data-testid="error-row-details-error-card"]').eq(0).should('contain', INVALID_ATTRIBUTE_MESSAGE).and('contain', 'Validation');
      cy.get('[data-testid="error-row-details-error-card"]').eq(1).should('contain', ABNORMAL_DBH_MESSAGE).and('contain', 'Validation');
    });
  });

  it('filters View Errors to validation-sourced errors only', () => {
    mockErrorsExplorerApi({ rows: [invalidAttributeCodeRow, abnormalDbhRow, ingestionOnlyRow] });

    openErrorsExplorer();
    cy.contains('button[aria-expanded]', MISSING_MEASUREMENT_MESSAGE).should('be.visible');

    cy.get('[role="group"][aria-label="Show"] button[value="validation"]').click();

    cy.contains('button[aria-expanded]', INVALID_ATTRIBUTE_MESSAGE).should('be.visible');
    cy.contains('button[aria-expanded]', ABNORMAL_DBH_MESSAGE).should('be.visible');
    cy.contains('button[aria-expanded]', MISSING_MEASUREMENT_MESSAGE).should('not.exist');
    getExplorerRow(INVALID_ATTRIBUTE_MESSAGE).should('be.visible');
  });
});
