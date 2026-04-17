/// <reference types="cypress" />

import { buildErrorsExplorerRow } from '../support/errors-explorer-helpers';
import { buildMeasurementsSummaryRow, buildViewFullTableRow } from '../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';

function selectDefaultCensusContext() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function buildSharedRows() {
  const summaryRow = buildMeasurementsSummaryRow({
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    isValidated: false,
    description: 'Invalid species reference',
    userDefinedFields: 'old tree'
  });

  const fullRow = buildViewFullTableRow({
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    isValidated: false,
    description: 'Invalid species reference',
    userDefinedFields: 'old tree'
  });

  const errorRow = buildErrorsExplorerRow({
    id: 1,
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    primaryErrorMessage: 'Invalid species reference',
    errorMessages: ['Invalid species reference'],
    errorSources: ['validation'],
    errorFields: ['speciesCode'],
    errorCodes: ['INVALID_SPECIES'],
    description: 'Invalid species reference'
  });

  return { summaryRow, fullRow, errorRow };
}

describe('Cross-Feature Integration', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('preserves the active census context across View Data, View Errors, and View All Historical Data', () => {
    const { summaryRow, fullRow, errorRow } = buildSharedRows();

    mockMeasurementHubWorkflowApi({
      summaryRows: [summaryRow],
      viewFullTableRows: [fullRow],
      errorRows: [errorRow],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    selectDefaultCensusContext();

    cy.openCensusHubLink('View Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');

    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');
    cy.wait('@fetchErrorFacets');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('contain', 'TREE101');

    cy.openCensusHubLink('View All Historical Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 5');
  });

  it('propagates an Errors Explorer edit into View Data and View All Historical Data', () => {
    const { summaryRow, fullRow, errorRow } = buildSharedRows();

    mockMeasurementHubWorkflowApi({
      summaryRows: [summaryRow],
      viewFullTableRows: [fullRow],
      errorRows: [errorRow],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    selectDefaultCensusContext();
    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');

    cy.contains('.MuiDataGrid-row', 'Invalid species reference').as('errorRow');
    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Edit"]').click();
    });

    cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });

    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Save"]').click();
    });

    cy.wait('@saveMeasurementHubRow').its('request.body.newRow.speciesCode').should('eq', 'ANOPKL');
    cy.wait('@refreshMeasurementHubSummary');
    cy.wait('@fetchErrorsExplorerRows');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('contain', 'ANOPKL');

    cy.openCensusHubLink('View Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'ANOPKL');

    cy.openCensusHubLink('View All Historical Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'ANOPKL');
  });

  it('removes a cleared validation error from View Errors after clearing it in View Data', () => {
    const { summaryRow, fullRow, errorRow } = buildSharedRows();

    mockMeasurementHubWorkflowApi({
      summaryRows: [summaryRow],
      viewFullTableRows: [fullRow],
      errorRows: [errorRow],
      validationFailures: [
        {
          coreMeasurementID: 101,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    selectDefaultCensusContext();
    cy.openCensusHubLink('View Data');

    cy.contains('[role="row"]', 'TREE101').find('[data-field="isValidated"] button').click({ force: true });

    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.contains('button', 'Clear Errors').click();

    cy.contains('Validation errors cleared successfully').should('be.visible');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('not.exist');
    cy.contains('[role="row"]', 'TREE101').should('be.visible');

    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('not.exist');
  });
});
