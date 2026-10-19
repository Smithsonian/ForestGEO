import { buildAttributeRow, buildMeasurementsSummaryRow, mockIsolatedGridApi, mockMeasurementsSummaryApi } from '../support/grid-api-helpers';

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

    cy.contains('button', /^Manual entry$/)
      .should('be.visible')
      .click();
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Measurements').should('be.visible');
    cy.get('[aria-label="close"]').click({ force: true });
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Measurements').should('not.exist');
  });

  it('clears validation errors from a measurement row and returns it to pending state', () => {
    mockMeasurementsSummaryApi({
      rows: [buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', censusID: 5, isValidated: false })],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ]
    });

    openMeasurementsSummary();

    cy.contains('[role="row"]', 'TREE102').find('[data-field="isValidated"] button').click({ force: true });

    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.contains('button', 'Clear Errors').click();

    cy.wait('@recheckValidation').then(interception => {
      expect(interception.request.body).to.deep.equal({ schema: 'luquillo', plotID: 1, censusID: 5, coreMeasurementID: 102 });
      expect(interception.request.body).to.not.have.any.keys('query', 'params', 'format');
    });
    cy.get('@recheckValidation.all').should('have.length', 1);

    cy.contains('Validation errors cleared. The row is pending validation.').should('be.visible');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('not.exist');
    cy.contains('[role="row"]', 'TREE102').should('be.visible');
    cy.contains('[role="row"]', 'TREE102').find('[data-field="isValidated"] button').should('not.exist');
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

    cy.get('[aria-label="More actions"]').click();
    cy.contains('Reset All Validation States').click();

    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('be.visible');
    cy.contains('[role="alertdialog"]', 'clears current validation failures for every row in this census').should('be.visible');
    cy.contains('[role="alertdialog"]', 'Failed Measurements still need correction and reingestion').should('be.visible');
    cy.contains('button', 'No').click();
    cy.contains('[role="alertdialog"]', 'Reset Validation States?').should('not.exist');

    cy.get('@resetValidations.all').should('have.length', 0);
  });
});
