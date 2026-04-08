import { buildMeasurementsSummaryRow, mockMeasurementsSummaryApi } from '../support/grid-api-helpers';

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

  it('loads the current toolbar, grid rows, and validation controls', () => {
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

    cy.get('input[placeholder="Search All Fields..."]').should('be.visible');
    cy.get('[data-testid="filter-errors"]').should('have.attr', 'aria-label').and('include', 'invalid measurements');
    cy.get('[data-testid="filter-valid"]').should('have.attr', 'aria-label').and('include', 'valid measurements');
    cy.get('[data-testid="filter-pending"]').should('have.attr', 'aria-label').and('include', 'pending measurements');
    cy.get('[aria-label="Export as CSV"]').scrollIntoView().should('exist');
    cy.get('[aria-label="More actions"]').should('be.visible');

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

    cy.get('input[placeholder="Search All Fields..."]').type('ANOPKL{enter}');
    cy.contains('[role="row"]', 'TREE102').should('be.visible');
    cy.contains('[role="row"]', 'TREE101').should('not.exist');

    cy.get('[aria-label="clear filter"]').click();
    cy.contains('[role="row"]', 'TREE101').should('be.visible');
    cy.contains('[role="row"]', 'TREE103').should('be.visible');
  });

  it('toggles invalid rows using the current filter controls', () => {
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
    cy.get('[data-testid="filter-errors"]').click();
    cy.contains('[role="row"]', 'TREE102').should('not.exist');

    cy.get('[data-testid="filter-errors"]').click();
    cy.contains('[role="row"]', 'TREE102').should('be.visible');
  });

  it('opens row-level validation details from the current status column', () => {
    mockMeasurementsSummaryApi({
      rows: [buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', isValidated: false, measuredDBH: 26.6 })],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference', 'DBH exceeds absolute maximum threshold'],
          criteria: ['speciesCode', 'measuredDBH']
        }
      ]
    });

    openMeasurementsSummary();

    cy.contains('[role="row"]', 'TREE102').find('[data-field="isValidated"] button').click({ force: true });

    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.contains('[role="alertdialog"]', 'speciesCode').should('be.visible');
    cy.contains('[role="alertdialog"]', 'Invalid species reference').should('be.visible');
    cy.contains('[role="alertdialog"]', 'measuredDBH').should('be.visible');
    cy.contains('[role="alertdialog"]', 'DBH exceeds absolute maximum threshold').should('be.visible');
  });

  it('opens the export modal with the current labels and visibility chips', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101' }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', isValidated: null })
      ]
    });

    openMeasurementsSummary();

    cy.get('[aria-label="Export as CSV"]').scrollIntoView().click({ force: true });
    cy.contains('[role="dialog"]', 'Exporting Data').should('be.visible');
    cy.contains('[role="dialog"]', 'Table CSV').should('be.visible');
    cy.contains('[role="dialog"]', 'Form CSV').should('be.visible');

    cy.contains('[role="checkbox"]', 'Rows passing validation').should('have.attr', 'aria-checked', 'true').click();
    cy.contains('[role="checkbox"]', 'Rows passing validation').should('have.attr', 'aria-checked', 'false');
    cy.contains('button', 'Cancel').click({ force: true });
    cy.contains('[role="dialog"]', 'Exporting Data').should('not.exist');
  });

  it('shows the current validation actions from the More actions menu', () => {
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

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Run Validations').should('be.visible');
    cy.contains('Override Failed Validations').should('be.visible');
    cy.contains('Reset All Validation States').should('be.visible').click();

    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.contains('[role="alertdialog"]', 'set all rows in this census back to pending').should('be.visible');
    cy.contains('button', 'No').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');
  });
});
