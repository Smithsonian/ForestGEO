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
    censusID: 5,
    isValidated: false,
    description: 'Invalid species reference',
    userDefinedFields: 'old tree'
  });

  const fullRow = buildViewFullTableRow({
    coreMeasurementID: 101,
    treeTag: 'TREE101',
    speciesCode: 'RUBI04',
    quadratName: 'Q0101',
    censusID: 5,
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
    // One test edits a species code (a taxonomic-identity change), which the app
    // restricts to global / db-admin roles. Use a global admin so that edit path
    // is exercisable.
    cy.setupForestGEOUser('adminUser');
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
    cy.gridRowShouldContain('TREE101', 'RUBI04');
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

    // The SpeciesCode edit is `warn` severity → confirm the PreviewDialog to apply.
    cy.wait('@previewEdit');
    cy.get('[data-testid="edit-preview-apply"]').click();
    cy.wait('@applyEdit').its('request.body.newRow.SpeciesCode').should('eq', 'ANOPKL');
    cy.wait('@refreshMeasurementHubSummary');
    cy.wait('@fetchErrorsExplorerRows');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('contain', 'ANOPKL');

    cy.openCensusHubLink('View Data');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'ANOPKL');

    cy.openCensusHubLink('View All Historical Data');
    cy.gridRowShouldContain('TREE101', 'ANOPKL');
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

    cy.wait('@recheckValidation').then(interception => {
      expect(interception.request.body).to.deep.equal({ schema: 'luquillo', plotID: 1, censusID: 5, coreMeasurementID: 101 });
      expect(interception.request.body).to.not.have.any.keys('query', 'params', 'format');
    });
    cy.get('@recheckValidation.all').should('have.length', 1);

    cy.contains('Validation errors cleared. The row is pending validation.').should('be.visible');
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('not.exist');
    cy.contains('[role="row"]', 'TREE101').should('be.visible');
    cy.contains('[role="row"]', 'TREE101').find('[data-field="isValidated"] button').should('not.exist');

    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');
    cy.contains('.MuiDataGrid-row', 'Invalid species reference').should('not.exist');
  });

  it('clears both validation errors on a mixed-source row while its ingestion error and a sibling validation error persist', () => {
    // Reset/recheck only resolve ErrorSource='validation' occurrences (see
    // lib/validations/reset.ts). This row mixes 'validation' and 'ingestion'
    // sources, so the mock cannot infer which messages survive from the
    // deduped arrays alone — the exact post-action row must be supplied via
    // postActionErrorRowsByMeasurementID (see resolveErrorRowAfterValidationClear
    // in measurement-hub-workflow-helpers.ts).
    const targetSummaryRow = buildMeasurementsSummaryRow({
      coreMeasurementID: 102,
      treeTag: 'TREE102',
      speciesCode: 'RUBI04',
      quadratName: 'Q0101',
      censusID: 5,
      isValidated: false,
      description: 'Invalid species reference'
    });

    const targetFullRow = buildViewFullTableRow({
      coreMeasurementID: 102,
      treeTag: 'TREE102',
      speciesCode: 'RUBI04',
      quadratName: 'Q0101',
      censusID: 5,
      isValidated: false,
      description: 'Invalid species reference'
    });

    const targetErrorRow = buildErrorsExplorerRow({
      id: 2,
      coreMeasurementID: 102,
      treeTag: 'TREE102',
      speciesCode: 'RUBI04',
      quadratName: 'Q0101',
      censusID: 5,
      primaryErrorMessage: 'Invalid species reference',
      errorMessages: ['Invalid species reference', 'DBH exceeds absolute maximum threshold', 'Stem import failed'],
      errorSources: ['validation', 'ingestion'],
      errorFields: ['speciesCode', 'measuredDBH'],
      errorCodes: ['INVALID_SPECIES', 'DBH_MAX', 'INGESTION_STEM_FAILED'],
      errorCount: 3,
      description: 'Invalid species reference'
    });

    const targetPostActionErrorRow = buildErrorsExplorerRow({
      id: 2,
      coreMeasurementID: 102,
      treeTag: 'TREE102',
      speciesCode: 'RUBI04',
      quadratName: 'Q0101',
      censusID: 5,
      primaryErrorMessage: 'Stem import failed',
      errorMessages: ['Stem import failed'],
      errorSources: ['ingestion'],
      errorFields: [],
      errorCodes: ['INGESTION_STEM_FAILED'],
      errorCount: 1,
      description: 'Stem import failed'
    });

    const siblingSummaryRow = buildMeasurementsSummaryRow({
      coreMeasurementID: 103,
      treeTag: 'TREE103',
      speciesCode: 'ANOPKL',
      quadratName: 'Q0102',
      censusID: 5,
      isValidated: false,
      description: 'Invalid species reference'
    });

    const siblingFullRow = buildViewFullTableRow({
      coreMeasurementID: 103,
      treeTag: 'TREE103',
      speciesCode: 'ANOPKL',
      quadratName: 'Q0102',
      censusID: 5,
      isValidated: false,
      description: 'Invalid species reference'
    });

    const siblingErrorRow = buildErrorsExplorerRow({
      id: 3,
      coreMeasurementID: 103,
      treeTag: 'TREE103',
      speciesCode: 'ANOPKL',
      quadratName: 'Q0102',
      censusID: 5,
      primaryErrorMessage: 'Invalid species reference',
      errorMessages: ['Invalid species reference'],
      errorSources: ['validation'],
      errorFields: ['speciesCode'],
      errorCodes: ['INVALID_SPECIES'],
      errorCount: 1,
      description: 'Invalid species reference'
    });

    mockMeasurementHubWorkflowApi({
      summaryRows: [targetSummaryRow, siblingSummaryRow],
      viewFullTableRows: [targetFullRow, siblingFullRow],
      errorRows: [targetErrorRow, siblingErrorRow],
      validationFailures: [
        {
          coreMeasurementID: 102,
          descriptions: ['Invalid species reference', 'DBH exceeds absolute maximum threshold'],
          criteria: ['speciesCode', 'measuredDBH']
        },
        {
          coreMeasurementID: 103,
          descriptions: ['Invalid species reference'],
          criteria: ['speciesCode']
        }
      ],
      postActionErrorRowsByMeasurementID: { 102: targetPostActionErrorRow }
    });

    selectDefaultCensusContext();
    cy.openCensusHubLink('View Data');

    cy.contains('[role="row"]', 'TREE102').find('[data-field="isValidated"] button').click({ force: true });
    cy.contains('[role="alertdialog"]', 'The following validation errors were found in this row:').should('be.visible');
    cy.contains('button', 'Clear Errors').click();

    cy.wait('@recheckValidation').then(interception => {
      expect(interception.request.body).to.deep.equal({ schema: 'luquillo', plotID: 1, censusID: 5, coreMeasurementID: 102 });
      expect(interception.request.body).to.not.have.any.keys('query', 'params', 'format');
    });
    cy.get('@recheckValidation.all').should('have.length', 1);

    cy.contains('Validation errors cleared. The row is pending validation.').should('be.visible');
    cy.contains('[role="row"]', 'TREE102').find('[data-field="isValidated"] button').should('not.exist');
    // Unrelated sibling row is untouched by a single-row recheck.
    cy.contains('[role="row"]', 'TREE103').find('[data-field="isValidated"] button').should('exist');

    cy.contains('[role="row"]', 'TREE102').find('[data-testid="HourglassEmptyIcon"]').should('be.visible');
    // TREE102's surviving ingestion error plus TREE103's untouched validation error.
    cy.get('[data-testid="filter-errors"]').should('have.attr', 'aria-label', 'Hide invalid measurements (2)');

    cy.openCensusHubLink('View Errors');
    cy.wait('@fetchErrorsExplorerRows');

    // The resolved validation messages are gone; the ingestion message survives.
    cy.contains('.MuiDataGrid-row', 'TREE102').should('contain', 'Stem import failed');
    cy.contains('.MuiDataGrid-row', 'TREE102').should('not.contain', 'Invalid species reference');
    cy.contains('.MuiDataGrid-row', 'TREE102').should('not.contain', 'DBH exceeds absolute maximum threshold');
    // The sibling's validation error is untouched.
    cy.contains('.MuiDataGrid-row', 'TREE103').should('contain', 'Invalid species reference');
  });
});
