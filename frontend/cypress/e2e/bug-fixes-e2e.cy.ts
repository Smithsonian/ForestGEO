/// <reference types="cypress" />

import { buildMeasurementsSummaryRow } from '../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';

function openMeasurementsSummary() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Data');
  cy.wait('@fetchMeasurementHubSummaryRows');
  cy.wait('@fetchMeasurementHubValidationErrors');
  cy.get('[role="grid"]').should('be.visible');
}

function openValidationDetails(treeTag: string) {
  cy.contains('[role="row"]', treeTag).find('[data-field="isValidated"] button').click({ force: true });

  cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
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

function getClearErrorQueries(interceptions: Cypress.Interception[]) {
  return interceptions.filter(interception => {
    const query = getSqlFromRequestBody(interception.request.body);

    return (
      typeof query === 'string' &&
      (query.includes('DELETE mel') || query.includes('UPDATE ??.coremeasurements SET IsValidated = NULL WHERE CoreMeasurementID = ?'))
    );
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

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Reset All Validation States').click();
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

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Reset All Validation States').click();
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

  it('keeps the validation details dialog open when clearing errors fails', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 103, treeTag: 'TREE103', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 103,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ],
      queryHandler: requestBody => {
        if (typeof requestBody?.query === 'string' && requestBody.query.includes('DELETE mel')) {
          return {
            statusCode: 500,
            body: {
              error: 'Delete failed'
            }
          };
        }

        return undefined;
      }
    });

    openMeasurementsSummary();
    openValidationDetails('TREE103');

    cy.contains('button', 'Clear Errors').click();
    cy.contains('Failed to clear errors: Failed to delete validation errors').should('be.visible');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.get('@runMeasurementHubQuery.all').then(interceptions => {
      const clearQueries = getClearErrorQueries(interceptions as Cypress.Interception[]);
      expect(clearQueries.some(interception => getSqlFromRequestBody(interception.request.body).includes('DELETE mel'))).to.equal(true);
      expect(clearQueries.some(interception => getSqlFromRequestBody(interception.request.body).includes('SET IsValidated = NULL'))).to.equal(false);
    });
  });

  it('clears validation errors with the current two-query workflow and closes the dialog', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 104, treeTag: 'TREE104', isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 104,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();
    openValidationDetails('TREE104');

    cy.contains('button', 'Clear Errors').click();
    cy.wait('@fetchMeasurementHubValidationErrors');

    cy.get('@runMeasurementHubQuery.all').then(interceptions => {
      const clearQueries = getClearErrorQueries(interceptions as Cypress.Interception[]);
      expect(clearQueries.length).to.be.at.least(2);
      expect(clearQueries.some(interception => getSqlFromRequestBody(interception.request.body).includes('DELETE mel'))).to.equal(true);
      expect(clearQueries.some(interception => getSqlFromRequestBody(interception.request.body).includes('SET IsValidated = NULL'))).to.equal(true);
    });
    cy.contains('Validation errors cleared successfully').should('be.visible');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('not.exist');
  });
});
