import { buildMeasurementsSummaryRow, mockMeasurementsSummaryApi } from '../support/grid-api-helpers';
import { buildErrorsExplorerRow } from '../support/errors-explorer-helpers';
import { mockMeasurementHubWorkflowApi } from '../support/measurement-hub-workflow-helpers';
import { RESET_VALIDATION_MENU_ITEM, VIEW_DATA_SEARCH_PLACEHOLDER, openRowDetails, showOnly } from '../support/view-data-ui-helpers';

const SEARCH_INPUT_SELECTOR = `input[placeholder="${VIEW_DATA_SEARCH_PLACEHOLDER}"]`;

function openMeasurementsSummary() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Data');
  cy.get('[role="grid"]').should('be.visible');
}

describe('Measurements Summary Grid', () => {
  beforeEach(() => {
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('loads the View Data header, Show counts, search and grid rows', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04', measuredDBH: 12.5, userDefinedFields: 'old tree' }),
        buildMeasurementsSummaryRow({
          coreMeasurementID: 102,
          treeTag: 'TREE102',
          speciesCode: 'ANOPKL',
          measuredDBH: 18.2,
          isValidated: false,
          userDefinedFields: 'multi stem'
        }),
        buildMeasurementsSummaryRow({
          coreMeasurementID: 103,
          treeTag: 'TREE103',
          speciesCode: 'CECR01',
          isValidated: null,
          userDefinedFields: 'new recruit'
        })
      ],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    cy.contains('h1', 'View Data').should('be.visible');
    cy.get(SEARCH_INPUT_SELECTOR).should('be.visible');
    cy.contains('[role="group"][aria-labelledby] button', 'All 3').should('be.visible');
    cy.contains('[role="group"][aria-labelledby] button', 'Passed 1').should('be.visible');
    cy.contains('[role="group"][aria-labelledby] button', 'Pending 1').should('be.visible');
    cy.contains('[role="group"][aria-labelledby] button', 'With errors 1').should('be.visible');
    cy.contains('button', 'Export CSV').should('be.visible');
    cy.contains('button', 'More actions').should('be.visible');

    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');
    cy.contains('[role="row"]', 'TREE102').should('contain', 'ANOPKL');
    cy.contains('[role="row"]', 'TREE103').should('contain', 'CECR01');
  });

  it('filters rows through the quick-search POST contract', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04' }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL' }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 103, treeTag: 'TREE103', speciesCode: 'CECR01' })
      ]
    });

    openMeasurementsSummary();

    cy.get(SEARCH_INPUT_SELECTOR).type('ANOPKL{enter}');
    cy.contains('[role="row"]', 'TREE102').should('be.visible');
    cy.contains('[role="row"]', 'TREE101').should('not.exist');

    cy.get('button[aria-label="Clear search"]').click();
    cy.contains('[role="row"]', 'TREE101').should('be.visible');
    cy.contains('[role="row"]', 'TREE103').should('be.visible');
  });

  it('narrows rows with the Show control and restores them with All', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04' }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', isValidated: false })
      ],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    cy.contains('[role="row"]', 'TREE102').should('be.visible');
    showOnly('Passed');
    cy.contains('[role="row"]', 'TREE102').should('not.exist');
    cy.contains('[role="row"]', 'TREE101').should('be.visible');

    showOnly('With errors');
    cy.contains('[role="row"]', 'TREE101').should('not.exist');
    cy.contains('[role="row"]', 'TREE102').should('be.visible');
    cy.get('[data-testid="view-data-with-errors-hint"]').should('be.visible');

    showOnly('All');
    cy.contains('[role="row"]', 'TREE101').should('be.visible');
    cy.contains('[role="row"]', 'TREE102').should('be.visible');
  });

  it('opens row-level validation details from the Details button', () => {
    mockMeasurementHubWorkflowApi({
      summaryRows: [buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', isValidated: false, measuredDBH: 26.6 })],
      errorRows: [
        buildErrorsExplorerRow({
          coreMeasurementID: 102,
          treeTag: 'TREE102',
          speciesCode: 'ANOPKL',
          measuredDBH: 26.6,
          primaryErrorMessage: 'Invalid species reference',
          errorMessages: ['Invalid species reference', 'DBH exceeds absolute maximum threshold'],
          errorSources: ['validation', 'validation'],
          errorFields: ['speciesCode', 'measuredDBH'],
          errorCodes: ['INVALID_SPECIES', 'DBH_ABOVE_MAX'],
          errorCount: 2
        })
      ],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference', 'DBH exceeds absolute maximum threshold'],
          criteria: ['speciesCode', 'measuredDBH']
        }
      ]
    });

    openMeasurementsSummary();

    openRowDetails('TREE102');

    cy.contains('[role="dialog"]', 'Measurement 102').should('be.visible');
    cy.contains('[role="dialog"]', '2 unresolved errors').should('be.visible');
    cy.contains('[role="dialog"]', 'speciesCode').should('be.visible');
    cy.contains('[role="dialog"]', 'Invalid species reference').should('be.visible');
    cy.contains('[role="dialog"]', 'measuredDBH').should('be.visible');
    cy.contains('[role="dialog"]', 'DBH exceeds absolute maximum threshold').should('be.visible');
  });

  it('opens the export modal from Export CSV with the current labels and visibility chips', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101' }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', isValidated: null })
      ]
    });

    openMeasurementsSummary();

    cy.contains('button', 'Export CSV').click();
    cy.contains('[role="dialog"]', 'Exporting Data').should('be.visible');
    cy.contains('[role="dialog"]', 'Table CSV').should('be.visible');
    cy.contains('[role="dialog"]', 'Form CSV').should('be.visible');

    cy.contains('[role="checkbox"]', 'Rows passing validation').should('have.attr', 'aria-checked', 'true').click();
    cy.contains('[role="checkbox"]', 'Rows passing validation').should('have.attr', 'aria-checked', 'false');
    cy.contains('button', 'Cancel').click({ force: true });
    cy.contains('[role="dialog"]', 'Exporting Data').should('not.exist');
  });

  it('shows the validation actions in the More actions menu', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', isValidated: null }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', isValidated: false })
      ],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    cy.contains('button', 'More actions').click();
    cy.contains('[role="menuitem"]', 'Run validations').should('be.visible');
    cy.contains('[role="menuitem"]', 'Override validations').should('be.visible');
    cy.contains('[role="menuitem"]', RESET_VALIDATION_MENU_ITEM).should('be.visible').click();

    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.contains('[role="alertdialog"]', 'set all rows in this census back to pending').should('be.visible');
    cy.contains('button', 'No').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');
  });
});
