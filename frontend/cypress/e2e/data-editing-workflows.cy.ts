import { buildAttributeRow, buildMeasurementsSummaryRow, mockIsolatedGridApi, mockMeasurementsSummaryApi } from '../support/grid-api-helpers';
import { buildErrorsExplorerRow } from '../support/errors-explorer-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';
import {
  CLEAR_SUCCESS_NOTICE,
  CLEAR_VALIDATION_ERRORS_BUTTON,
  RESET_VALIDATION_MENU_ITEM,
  PENDING_STATUS_TEXT,
  STATUS_CHIPS_SELECTOR,
  chooseMoreActionsItem,
  closeRowDetails,
  openRowDetails
} from '../support/view-data-ui-helpers';

const SPECIES_ERROR_MESSAGE = 'Invalid species reference';

function selectDefaultCensusContext() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function openMeasurementsSummary() {
  selectDefaultCensusContext();
  cy.openCensusHubLink('View Data');
  cy.get('[role="grid"]').should('be.visible');
}

function openAttributesGrid() {
  selectDefaultCensusContext();
  cy.openFixedDataLink('Stem Codes');
  cy.get('[role="grid"]').should('be.visible');
}

describe('Data Editing Workflows', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
  });

  it('opens the manual measurements entry workflow from View Data', () => {
    mockMeasurementsSummaryApi({
      rows: [buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101' })]
    });

    openMeasurementsSummary();

    cy.contains('button', 'Add measurements').should('be.visible').click();
    cy.contains('[role="menuitem"]', 'Manual entry form').click();
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Measurements').should('be.visible');
    cy.get('[aria-label="close"]').click({ force: true });
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Measurements').should('not.exist');
  });

  it('clears validation errors from a measurement row and returns it to pending state', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', isValidated: false })],
      errorRows: [
        buildErrorsExplorerRow({
          coreMeasurementID: 102,
          treeTag: 'TREE102',
          speciesCode: 'ANOPKL',
          primaryErrorMessage: SPECIES_ERROR_MESSAGE,
          errorMessages: [SPECIES_ERROR_MESSAGE],
          errorSources: ['validation'],
          errorFields: ['speciesCode'],
          errorCodes: ['INVALID_SPECIES']
        })
      ],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: [SPECIES_ERROR_MESSAGE],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    openRowDetails('TREE102');
    cy.contains('[role="dialog"]', SPECIES_ERROR_MESSAGE).should('be.visible');
    cy.contains('button', CLEAR_VALIDATION_ERRORS_BUTTON).click();

    cy.wait('@clearMeasurementErrors').its('request.body.measurementID').should('equal', 102);
    cy.contains(CLEAR_SUCCESS_NOTICE).should('be.visible');
    cy.get(`[role="dialog"] ${STATUS_CHIPS_SELECTOR}`).should('contain', PENDING_STATUS_TEXT);
    cy.contains('[role="dialog"]', SPECIES_ERROR_MESSAGE).should('not.exist');
    closeRowDetails();
    cy.contains('[role="row"]', 'TREE102').should('contain', 'Pending');
  });

  it('opens the Stem Codes manual entry form from the shared fixed-data navigation', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [
        buildAttributeRow({ id: 1, code: 'ATTR001', description: 'Original attribute' }),
        buildAttributeRow({ id: 2, code: 'ATTR002', description: 'Second attribute' })
      ]
    });

    openAttributesGrid();

    cy.contains('button', /^Add record$/)
      .should('be.visible')
      .click();
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Attributes').should('be.visible');
    cy.get('[aria-label="close"]').click({ force: true });
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Attributes').should('not.exist');
  });

  it('opens the reset-validation workflow from View Data and allows a safe cancel path', () => {
    mockMeasurementsSummaryApi({
      rows: [buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', isValidated: null })]
    });

    openMeasurementsSummary();

    chooseMoreActionsItem(RESET_VALIDATION_MENU_ITEM);

    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.contains('[role="alertdialog"]', 'set all rows in this census back to pending').should('be.visible');
    cy.contains('button', 'No').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');
  });
});
