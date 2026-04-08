/// <reference types="cypress" />

import { buildErrorsExplorerRow } from '../../support/errors-explorer-helpers';
import { buildMeasurementsSummaryRow, buildViewFullTableRow } from '../../support/grid-api-helpers';
import { mockMeasurementHubWorkflowApi } from '../../support/measurement-hub-workflow-helpers';
import { buildUploadedFile, mockUploadedFilesApi } from '../../support/uploaded-files-helpers';

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

function prepareDemoUser() {
  cy.viewport(1600, 1000);
  cy.setupForestGEOUser('standardUser');
  cy.mockCoreDataValidity();
}

function openActiveCensusDashboard() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.contains('Welcome back').should('be.visible');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

describe('ForestGEO Product Showcase Demo', () => {
  beforeEach(() => {
    prepareDemoUser();
  });

  afterEach(() => {
    cy.demoCleanup();
  });

  it('walks through dashboard context selection and key metrics', () => {
    openActiveCensusDashboard();

    cy.demoStep('This demo starts by choosing the active site, plot, and census context.', {
      highlight: '[data-testid="site-select-component"], [data-testid="plot-select-component"], [data-testid="census-select-component"]'
    });

    cy.demoStep('Once the census is selected, the dashboard updates to show the current fieldwork status.', {
      highlight: '.MuiCard-root'
    });

    cy.contains('Core Counts').should('be.visible');
    cy.contains('Quadrat Coverage').should('be.visible');
    cy.contains('Active Personnel').should('be.visible');

    cy.demoStep('These cards summarize the current data collection progress for non-technical users.', {
      highlight: '.MuiCard-root'
    });
  });

  it('demonstrates fixing an error in View Errors and seeing the change propagate across pages', () => {
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

    openActiveCensusDashboard();

    cy.demoStep('Here we open View Errors to inspect rows that need attention.', {
      highlight: '[data-testid^="navigate-list-item-expanded-button-Census Hub-"]'
    });
    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');
    cy.wait('@fetchErrorFacets');

    cy.demoStep('This row has an invalid species reference. We are going to correct it from RUBI04 to ANOPKL.', {
      highlight: '.MuiDataGrid-row'
    });

    cy.contains('.MuiDataGrid-row', 'Invalid species reference').as('errorRow');
    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Edit"]').click();
    });

    cy.demoStep('The grid enters edit mode so the correction can be entered directly in the table.', {
      highlight: '.MuiDataGrid-row [data-field="speciesCode"] input'
    });

    cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });

    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Save"]').click();
    });

    cy.wait('@saveMeasurementHubRow');
    cy.wait('@refreshMeasurementHubSummary');
    cy.wait('@fetchErrorsExplorerRows');

    cy.demoStep('After saving, the corrected value stays visible in View Errors instead of reverting.', {
      highlight: '.MuiDataGrid-row [data-field="speciesCode"]'
    });
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('contain', 'ANOPKL');

    cy.demoStep('Now we switch to View Data to show the same correction propagating into the main measurements table.', {
      highlight: '[data-testid^="navigate-list-item-expanded-button-Census Hub-"]'
    });
    cy.openCensusHubLink('View Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'ANOPKL');

    cy.demoStep('The updated species code is also visible in the current census data view.', {
      highlight: '[role="grid"]'
    });

    cy.openCensusHubLink('View All Historical Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'ANOPKL');

    cy.demoStep('And the same corrected value carries through to the full historical table as well.', {
      highlight: '[role="grid"]'
    });
  });

  it('shows uploaded file review and cleanup in the Uploaded Files page', () => {
    mockUploadedFilesApi({
      files: [
        buildUploadedFile({ name: 'measurements-2024-06-15.csv', user: 'Field Crew', formType: 'measurements' }),
        buildUploadedFile({ name: 'species-update-2024-06-16.csv', user: 'Lead Tech', formType: 'species' })
      ],
      downloadUrlBuilder: () => '/measurementshub/uploadedfiles#download-complete'
    });

    openActiveCensusDashboard();

    cy.demoStep('Next, we open Uploaded Files to review what has been submitted for this census.', {
      highlight: '[data-testid^="navigate-list-item-expanded-button-Census Hub-"]'
    });
    cy.openCensusHubLink('Uploaded Files');
    cy.wait('@fetchUploadedFiles');

    cy.demoStep('This page shows the storage container, the uploaded files, who submitted them, and their form types.', {
      highlight: 'table'
    });
    cy.contains('measurements-2024-06-15.csv').should('be.visible');
    cy.contains('species-update-2024-06-16.csv').should('be.visible');

    cy.contains('tr', 'measurements-2024-06-15.csv').within(() => {
      cy.get('button').eq(0).click({ force: true });
    });
    cy.wait('@downloadUploadedFile');

    cy.demoStep('A reviewer can open a file directly from the list for inspection or download.', {
      highlight: 'table'
    });

    cy.contains('tr', 'species-update-2024-06-16.csv').within(() => {
      cy.get('button').eq(1).click({ force: true });
    });
    cy.wait('@deleteUploadedFile');
    cy.wait('@fetchUploadedFiles');

    cy.demoStep('Files can also be removed, and the table refreshes immediately to show the updated state.', {
      highlight: 'table'
    });
    cy.contains('species-update-2024-06-16.csv').should('not.exist');
  });
});
