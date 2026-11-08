/// <reference types="cypress" />

import { buildMeasurementsSummaryRow } from '../support/grid-api-helpers';
import { buildErrorsExplorerRow } from '../support/errors-explorer-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';
import {
  CLEAR_ERRORS_ENDPOINT_PATTERN,
  CLEAR_FAILURE_NOTICE,
  CLEAR_SUCCESS_NOTICE,
  CLEAR_VALIDATION_ERRORS_BUTTON,
  RESET_VALIDATION_MENU_ITEM,
  ROW_RESOLVED_TEXT,
  chooseMoreActionsItem,
  closeRowDetails,
  openRowDetails
} from '../support/view-data-ui-helpers';

const SPECIES_ERROR_MESSAGE = 'Invalid species reference';
const CLEAR_FAILED_STATUS_CODE = 500;
const CLEAR_FAILED_CODE = 'CLEAR_VALIDATION_ERRORS_FAILED';

function openMeasurementsSummary() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Data');
  cy.wait('@fetchMeasurementHubSummaryRows');
  cy.wait('@fetchMeasurementHubValidationErrors');
  cy.get('[role="grid"]').should('be.visible');
}

function getSqlFromRequestBody(requestBody: any) {
  if (typeof requestBody === 'string') {
    try {
      const parsedBody = JSON.parse(requestBody);
      return typeof parsedBody?.query === 'string' ? parsedBody.query : requestBody;
    } catch {
      return requestBody;
    }
  }

  return typeof requestBody?.query === 'string' ? requestBody.query : '';
}

function getResetValidationQueries(interceptions: Cypress.Interception[]) {
  return interceptions.filter(interception => {
    const query = getSqlFromRequestBody(interception.request.body);

    return typeof query === 'string' && (query.includes('measurement_error_log') || query.includes('SET cm.IsValidated = NULL'));
  });
}

function buildSpeciesErrorRow(coreMeasurementID: number, treeTag: string) {
  return buildErrorsExplorerRow({
    coreMeasurementID,
    treeTag,
    primaryErrorMessage: SPECIES_ERROR_MESSAGE,
    errorMessages: [SPECIES_ERROR_MESSAGE],
    errorSources: ['validation'],
    errorFields: ['speciesCode'],
    errorCodes: ['INVALID_SPECIES']
  });
}

describe('Measurement Hub Regression Contracts', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('does not reset validation state when the reset dialog is cancelled', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    chooseMoreActionsItem(RESET_VALIDATION_MENU_ITEM);
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.contains('button', 'No').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');

    cy.get('@refreshMeasurementHubSummary.all').should('have.length', 0);
    cy.contains('Validation states reset. Rows are pending validation.').should('not.exist');
  });

  it('issues both reset queries and refreshes the summary view when reset is confirmed', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    chooseMoreActionsItem(RESET_VALIDATION_MENU_ITEM);
    cy.contains('button', 'Yes').click();

    cy.wait('@refreshMeasurementHubSummary');
    cy.wait('@fetchMeasurementHubSummaryRows');

    cy.get('@runMeasurementHubQuery.all').then(interceptions => {
      const resetQueries = getResetValidationQueries(interceptions as Cypress.Interception[]);
      expect(resetQueries.length).to.be.at.least(2);
      expect(resetQueries.some(interception => getSqlFromRequestBody(interception.request.body).includes('measurement_error_log'))).to.equal(true);
      expect(resetQueries.some(interception => getSqlFromRequestBody(interception.request.body).includes('SET cm.IsValidated = NULL'))).to.equal(true);
    });
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');
  });

  it('keeps the details sheet open and changes nothing when clearing errors fails', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 103, treeTag: 'TREE103', isValidated: false })],
      errorRows: [buildSpeciesErrorRow(103, 'TREE103')],
      validationFailures: [
        {
          coreMeasurementID: 103,
          descriptions: [SPECIES_ERROR_MESSAGE],
          criteria: ['speciesCode']
        }
      ]
    });
    cy.intercept('POST', CLEAR_ERRORS_ENDPOINT_PATTERN, { statusCode: CLEAR_FAILED_STATUS_CODE, body: { code: CLEAR_FAILED_CODE } }).as(
      'clearMeasurementErrorsFails'
    );

    openMeasurementsSummary();
    openRowDetails('TREE103');
    cy.contains('[role="dialog"]', SPECIES_ERROR_MESSAGE).should('be.visible');
    cy.get('@fetchMeasurementHubSummaryRows.all').its('length').as('summaryReadsBeforeClear');

    cy.contains('button', CLEAR_VALIDATION_ERRORS_BUTTON).click();

    cy.wait('@clearMeasurementErrorsFails')
      .its('request.body')
      .should(requestBody => {
        console.log(JSON.stringify({ clearRequestBody: requestBody }));
        expect(requestBody.measurementID).to.equal(103);
      });
    cy.contains(CLEAR_FAILURE_NOTICE).should('be.visible');
    cy.contains('[role="dialog"]', SPECIES_ERROR_MESSAGE).should('be.visible');
    cy.contains('button', CLEAR_VALIDATION_ERRORS_BUTTON).should('be.enabled');
    cy.contains(CLEAR_SUCCESS_NOTICE).should('not.exist');
    cy.get('@refreshMeasurementHubSummary.all').should('have.length', 0);
    cy.get<number>('@summaryReadsBeforeClear').then(summaryReadsBeforeClear => {
      cy.get('@fetchMeasurementHubSummaryRows.all').should('have.length', summaryReadsBeforeClear);
    });
  });

  it('clears the row through the clear endpoint, re-reads the grid, and leaves the sheet showing no unresolved errors', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 104, treeTag: 'TREE104', isValidated: false })],
      errorRows: [buildSpeciesErrorRow(104, 'TREE104')],
      validationFailures: [
        {
          coreMeasurementID: 104,
          descriptions: [SPECIES_ERROR_MESSAGE],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();
    openRowDetails('TREE104');
    cy.contains('[role="dialog"]', SPECIES_ERROR_MESSAGE).should('be.visible');

    cy.contains('button', CLEAR_VALIDATION_ERRORS_BUTTON).click();

    cy.wait('@clearMeasurementErrors')
      .its('request.body')
      .should(requestBody => {
        console.log(JSON.stringify({ clearRequestBody: requestBody }));
        expect(requestBody.measurementID).to.equal(104);
        expect(requestBody.censusID).to.be.a('number');
      });
    cy.contains(CLEAR_SUCCESS_NOTICE).should('be.visible');
    cy.wait('@fetchMeasurementHubSummaryRows');
    cy.contains('[role="dialog"]', ROW_RESOLVED_TEXT).should('be.visible');
    cy.contains('[role="dialog"] button', CLEAR_VALIDATION_ERRORS_BUTTON).should('not.exist');

    closeRowDetails();
    cy.contains('[role="row"]', 'TREE104').should('contain', 'Pending');
  });
});
