/// <reference types="cypress" />

import { buildAttributeRow, buildQuadratRow, buildTaxonomyRow, mockIsolatedGridApi } from '../support/grid-api-helpers';

function selectDefaultCensusContext() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function openFixedDataGrid(label: 'Stem Codes' | 'Quadrats' | 'Species List') {
  selectDefaultCensusContext();
  cy.openFixedDataLink(label);
  cy.get('[role="grid"]').should('be.visible');
}

describe('Fixed Data Management', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
  });

  it('loads the Stem Codes grid with the current toolbar and visible rows', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [
        buildAttributeRow({ id: 1, code: 'ATTR001', description: 'Canopy emergent', status: 'active' }),
        buildAttributeRow({ id: 2, code: 'ATTR002', description: 'Gap specialist', status: 'active' }),
        buildAttributeRow({ id: 3, code: 'ATTR003', description: 'Liana damage', status: 'inactive' })
      ]
    });

    openFixedDataGrid('Stem Codes');

    cy.contains('[role="row"]', 'ATTR001').should('contain', 'Canopy emergent');
    cy.contains('[role="row"]', 'ATTR003').should('contain', 'inactive');
    cy.get('input[placeholder="Search All Fields..."]').should('be.visible');
    cy.get('[aria-label="Export as CSV"]').should('exist');
    cy.get('[aria-label="More actions"]').should('be.visible');
  });

  it('enters and cancels Stem Code row edit mode through the current action buttons', () => {
    mockIsolatedGridApi({
      gridType: 'attributes',
      rows: [buildAttributeRow({ id: 1, code: 'ATTR001', description: 'Original attribute', status: 'active' })]
    });

    openFixedDataGrid('Stem Codes');

    cy.contains('.MuiDataGrid-row', 'ATTR001').as('attributeRow');
    cy.get('@attributeRow').find('button').eq(0).click({ force: true });

    cy.get('.MuiDataGrid-row').first().find('button').should('have.length.at.least', 2);
    cy.get('.MuiDataGrid-row')
      .first()
      .find('[data-field="status"]')
      .within(() => {
        cy.get('input, button, [role="combobox"]').should('exist');
      });

    cy.get('.MuiDataGrid-row').first().find('button').eq(1).click({ force: true });
    cy.contains('.MuiDataGrid-row', 'ATTR001').should('contain', 'Original attribute');
  });

  it('opens the Species List manual entry form and species-limits dialog from the current grid', () => {
    cy.intercept('GET', '**/api/specieslimits/1/5**', {
      statusCode: 200,
      body: [
        {
          speciesLimitID: 1,
          speciesID: 201,
          plotID: 1,
          censusID: 5,
          limitType: 'DBH',
          lowerBound: 5,
          upperBound: 60
        }
      ]
    }).as('getSpeciesLimits');

    mockIsolatedGridApi({
      gridType: 'alltaxonomiesview',
      rows: [
        buildTaxonomyRow({ id: 201, speciesID: 201, speciesCode: 'RUBI04', speciesName: 'berteriana', genus: 'Psychotria' }),
        buildTaxonomyRow({ id: 202, speciesID: 202, speciesCode: 'ANOPKL', speciesName: 'klotzschiana', genus: 'Anopterus' })
      ]
    });

    openFixedDataGrid('Species List');
    cy.wait('@getSpeciesLimits');

    cy.contains('[role="row"]', 'RUBI04').should('contain', 'berteriana');

    cy.get('[aria-label="Manual Entry Form"]').click({ force: true });
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Species').should('be.visible');
    cy.get('[aria-label="close"]').click({ force: true });
    cy.contains('[role="alertdialog"]', 'Manual Input Form - Species').should('not.exist');

    cy.contains('.MuiDataGrid-row', 'RUBI04').within(() => {
      cy.contains('button', 'Modify').click({ force: true });
    });

    cy.contains('[role="dialog"]', 'Species Limits for berteriana').should('be.visible');
    cy.contains('[role="dialog"]', 'Modify Species Limit').should('be.visible');
    cy.get('body').type('{esc}');
    cy.contains('[role="dialog"]', 'Species Limits for berteriana').should('not.exist');
  });

  it('opens quadrat row edit mode and deletes another row through the current action buttons', () => {
    mockIsolatedGridApi({
      gridType: 'quadrats',
      rows: [
        buildQuadratRow({ quadratID: 101, quadratName: 'Q0101', startX: 0, startY: 0 }),
        buildQuadratRow({ quadratID: 102, quadratName: 'Q0102', startX: 20, startY: 0 })
      ]
    });

    openFixedDataGrid('Quadrats');

    cy.contains('.MuiDataGrid-row', 'Q0101').as('editedQuadratRow');
    cy.get('@editedQuadratRow').find('button').eq(0).click({ force: true });

    cy.get('.MuiDataGrid-row').first().find('button').should('have.length.at.least', 2);
    cy.get('.MuiDataGrid-row').first().find('button').eq(1).click({ force: true });

    cy.contains('.MuiDataGrid-row', 'Q0102').find('button').eq(1).click({ force: true });
    cy.contains('[role="dialog"]', 'Confirm Deletion').should('be.visible');
    cy.contains('[role="dialog"]', 'Are you sure you want to delete this row?').should('be.visible');
    cy.contains('button', 'Confirm').click({ force: true });
    cy.wait('@deleteIsolatedGridRow');

    cy.contains('.MuiDataGrid-row:visible', 'Q0102').should('not.exist');
    cy.contains('.MuiDataGrid-row', 'Q0101').should('be.visible');
  });
});
