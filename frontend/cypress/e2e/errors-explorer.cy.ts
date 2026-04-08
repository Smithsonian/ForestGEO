/// <reference types="cypress" />

import { buildErrorsExplorerDetails, buildErrorsExplorerRow, mockErrorsExplorerApi } from '../support/errors-explorer-helpers';

const FILTER_STORAGE_KEY = 'errors-explorer-filters:luquillo:1:5';

const invalidSpeciesRow = buildErrorsExplorerRow({
  id: 1,
  coreMeasurementID: 101,
  treeTag: 'TREE-101',
  speciesCode: 'RUBI04',
  primaryErrorMessage: 'Invalid species reference',
  errorMessages: ['Invalid species reference'],
  errorSources: ['validation'],
  errorFields: ['speciesCode'],
  errorCodes: ['INVALID_SPECIES'],
  description: 'Invalid species reference'
});

const missingMeasurementRow = buildErrorsExplorerRow({
  id: 2,
  coreMeasurementID: 202,
  treeTag: 'TREE-202',
  speciesCode: 'ANOPKL',
  primaryErrorMessage: 'Missing measurement data',
  errorMessages: ['Missing measurement data'],
  errorSources: ['ingestion'],
  errorFields: ['measuredDBH', 'measuredHOM'],
  errorCodes: ['MISSING_MEASUREMENT_DATA'],
  description: 'Missing measurement data',
  measuredDBH: 0,
  measuredHOM: 0
});

const contradictionRow = buildErrorsExplorerRow({
  id: 3,
  coreMeasurementID: 303,
  treeTag: 'DUP-303',
  speciesCode: 'RUBI04',
  primaryErrorMessage: 'Same-batch species conflict',
  errorMessages: ['Same-batch species conflict'],
  errorSources: ['ingestion'],
  errorFields: ['treeTag', 'speciesCode'],
  errorCodes: ['SAME_BATCH_SPECIES_CONFLICT'],
  description: 'Species differs within the same batch upload',
  hasContradiction: true,
  contradictionType: 'same_batch_conflict',
  contradictionTypes: ['same_batch_conflict'],
  relatedMeasurementIDs: [304],
  uploadBatchID: 'batch-77'
});

const linkedContradictionRow = buildErrorsExplorerRow({
  id: 4,
  coreMeasurementID: 304,
  treeTag: 'DUP-303',
  speciesCode: 'ANOPKL',
  primaryErrorMessage: 'Same-batch species conflict',
  errorMessages: ['Same-batch species conflict'],
  errorSources: ['ingestion'],
  errorFields: ['treeTag', 'speciesCode'],
  errorCodes: ['SAME_BATCH_SPECIES_CONFLICT'],
  description: 'Linked conflicting row',
  hasContradiction: true,
  contradictionType: 'same_batch_conflict',
  contradictionTypes: ['same_batch_conflict'],
  relatedMeasurementIDs: [303],
  uploadBatchID: 'batch-77'
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

describe('Errors Explorer', () => {
  beforeEach(() => {
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('loads the explorer with the active census scope and shows row details', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, missingMeasurementRow],
      detailsByMeasurementID: {
        101: buildErrorsExplorerDetails(
          invalidSpeciesRow,
          [],
          [
            {
              source: 'validation',
              code: 'INVALID_SPECIES',
              message: 'Invalid species reference',
              fields: ['speciesCode']
            }
          ]
        )
      }
    });

    openErrorsExplorer();

    cy.wait('@fetchErrorsExplorerRows').then(interception => {
      expect(interception.request.body.schema).to.equal('luquillo');
      expect(interception.request.body.plotID).to.equal(1);
      expect(interception.request.body.censusID).to.equal(5);
      expect(interception.request.body.filters.source).to.equal('all');
      expect(interception.request.body.filters.contradictionOnly).to.equal(false);
      expect(interception.request.body.filters.quickSearch).to.equal('');
      expect(interception.request.body.filters.presetId).to.equal('all_errors');
    });

    openRowDetails('Invalid species reference');
    cy.wait('@fetchErrorDetails');

    cy.contains('Row Details').should('be.visible');
    cy.contains('Row 101').should('be.visible');
    cy.contains('validation:INVALID_SPECIES').should('be.visible');
    cy.contains('Invalid species reference').should('be.visible');
  });

  it('applies filters and stores them per census scope', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, missingMeasurementRow, contradictionRow, linkedContradictionRow]
    });

    openErrorsExplorer();

    cy.get('#errors-explorer-source').click();
    cy.get('[role="listbox"]')
      .filter(':visible')
      .within(() => {
        cy.contains('[role="option"]', 'Ingestion only').click();
      });
    getExplorerRow('Missing measurement data').should('be.visible');
    getExplorerRow('Invalid species reference').should('not.exist');

    cy.get('input[aria-label="Quick Search"]').clear().type('ANOPKL');
    getExplorerRow('Missing measurement data').should('be.visible');
    getExplorerRow('Same-batch species conflict').should('be.visible');
    cy.window().its('localStorage').invoke('getItem', FILTER_STORAGE_KEY).should('not.be.null');
    cy.window().should(win => {
      const savedFilters = JSON.parse(win.localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}');
      expect(savedFilters.source).to.equal('ingestion');
      expect(savedFilters.quickSearch).to.equal('ANOPKL');
    });
  });

  it('shows contradiction comparison details and can inspect the linked row', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, contradictionRow, linkedContradictionRow],
      detailsByMeasurementID: {
        303: buildErrorsExplorerDetails(
          contradictionRow,
          [
            {
              coreMeasurementID: 304,
              treeTag: 'DUP-303',
              stemTag: '1',
              speciesCode: 'ANOPKL',
              quadratName: '0001',
              measurementDate: '2024-06-15',
              measuredDBH: 15.4,
              measuredHOM: 1.3,
              stemLocalX: 12.5,
              stemLocalY: 24.5,
              description: 'Linked conflicting row',
              uploadBatchID: 'batch-77',
              primaryErrorMessage: 'Same-batch species conflict',
              errorCount: 1,
              errorMessages: ['Same-batch species conflict']
            }
          ],
          [
            {
              source: 'ingestion',
              code: 'SAME_BATCH_SPECIES_CONFLICT',
              message: 'Same-batch species conflict',
              fields: ['treeTag', 'speciesCode'],
              procedureName: 'bulkingestionprocess'
            }
          ]
        ),
        304: buildErrorsExplorerDetails(linkedContradictionRow)
      }
    });

    openErrorsExplorer();

    openRowDetails('Same-batch species conflict');
    cy.wait('@fetchErrorDetails');

    cy.contains('Contradiction Comparison').should('be.visible');
    cy.contains('Same-batch conflict').should('be.visible');
    cy.contains('Open linked row details').click();

    cy.wait('@fetchErrorDetails');
    cy.contains('Row 304').should('be.visible');
    cy.contains('Linked conflicting row').should('be.visible');
  });

  it('keeps the updated species code visible after saving an error row', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, missingMeasurementRow]
    });

    openErrorsExplorer();

    getExplorerRow('Invalid species reference').as('errorRow');
    cy.get('@errorRow').find('[data-field="speciesCode"]').should('contain', 'RUBI04');

    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Edit"]').click();
    });

    cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });

    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Save"]').click();
    });

    cy.wait('@saveErrorRow').its('request.body.newRow.speciesCode').should('eq', 'ANOPKL');
    cy.wait('@refreshMeasurementsSummary');
    cy.wait('@fetchErrorsExplorerRows');

    getExplorerRow('Invalid species reference').find('[data-field="speciesCode"]').should('contain', 'ANOPKL');
  });

  it('surfaces save failures without refreshing away the unsaved draft', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow],
      patchHandler: requestBody => ({
        statusCode: 500,
        body: {
          message: `Failed to update row ${requestBody.newRow.coreMeasurementID}`
        }
      })
    });

    openErrorsExplorer();

    getExplorerRow('Invalid species reference').as('errorRow');
    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Edit"]').click();
    });

    cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });

    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Save"]').click();
    });

    cy.wait('@saveErrorRow');
    cy.contains('Failed to update row 101').should('be.visible');
    cy.get('@errorRow').find('[data-field="speciesCode"] input').should('have.value', 'ANOPKL');
    cy.get('@refreshMeasurementsSummary.all').should('have.length', 0);
  });
});
