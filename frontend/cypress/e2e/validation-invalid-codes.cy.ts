/// <reference types="cypress" />

import { buildErrorsExplorerRow, mockErrorsExplorerApi } from '../support/errors-explorer-helpers';

/**
 * Verifies that validation errors for invalid attribute codes and abnormally
 * high DBH values surface in the current Errors Explorer UI (View Errors).
 *
 * The validation RULES (thresholds, attribute-code resolution, boundaries) are
 * covered by the integration suite; this e2e covers only the display path —
 * that the explorer lists these validation errors and exposes their source,
 * code, affected field, and message in row details.
 */

const INVALID_ATTRIBUTE_MESSAGE = 'Attribute code does not exist in attributes table';
const ABNORMAL_DBH_MESSAGE = 'Measured DBH is abnormally high';

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

function openErrorsExplorer() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.contains('Welcome back').should('be.visible');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Errors');
  cy.wait('@fetchErrorsExplorerRows');
  cy.wait('@fetchErrorFacets');
  cy.contains('Errors Explorer').should('be.visible');
}

function getExplorerRow(text: string) {
  return cy.contains('.MuiDataGrid-row', text);
}

function openRowDetails(text: string) {
  getExplorerRow(text).find('[data-field="primaryErrorMessage"]').click({ force: true });
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
    cy.wait('@fetchErrorDetails');

    cy.contains('Row Details').should('be.visible');
    cy.contains('Row 123').should('be.visible');
    cy.contains('validation:INVALID_ATTRIBUTE_CODE').should('be.visible');
    cy.contains(INVALID_ATTRIBUTE_MESSAGE).should('be.visible');
  });

  it('surfaces an abnormally high DBH as a validation error', () => {
    mockErrorsExplorerApi({ rows: [abnormalDbhRow] });

    openErrorsExplorer();

    getExplorerRow(ABNORMAL_DBH_MESSAGE).should('be.visible').and('contain', 'TREE-026600');

    openRowDetails(ABNORMAL_DBH_MESSAGE);
    cy.wait('@fetchErrorDetails');

    cy.contains('Row 124').should('be.visible');
    cy.contains('validation:ABNORMAL_HIGH_DBH').should('be.visible');
    cy.contains(ABNORMAL_DBH_MESSAGE).should('be.visible');
  });

  it('reports both validation errors on a single measurement', () => {
    mockErrorsExplorerApi({ rows: [multiErrorRow] });

    openErrorsExplorer();

    openRowDetails(INVALID_ATTRIBUTE_MESSAGE);
    cy.wait('@fetchErrorDetails');

    // Both validation errors for the same measurement are listed in its details.
    cy.contains('validation:INVALID_ATTRIBUTE_CODE').should('be.visible');
    cy.contains('validation:ABNORMAL_HIGH_DBH').should('be.visible');
    cy.contains(ABNORMAL_DBH_MESSAGE).should('be.visible');
  });

  it('filters the explorer to validation-sourced errors only', () => {
    mockErrorsExplorerApi({ rows: [invalidAttributeCodeRow, abnormalDbhRow] });

    openErrorsExplorer();

    cy.get('#errors-explorer-source').click();
    cy.get('[role="listbox"]')
      .filter(':visible')
      .within(() => {
        cy.contains('[role="option"]', 'Validation only').click();
      });

    getExplorerRow(INVALID_ATTRIBUTE_MESSAGE).should('be.visible');
    getExplorerRow(ABNORMAL_DBH_MESSAGE).should('be.visible');
  });
});
