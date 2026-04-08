/// <reference types="cypress" />

import { buildMeasurementsSummaryRow, buildViewFullTableRow, mockIsolatedGridApi, mockMeasurementsSummaryApi } from '../support/grid-api-helpers';

function selectDefaultCensusContext() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
}

function openViewData() {
  selectDefaultCensusContext();
  cy.openCensusHubLink('View Data');
  cy.get('[role="grid"]').should('be.visible');
}

function openViewFullTable() {
  selectDefaultCensusContext();
  cy.openCensusHubLink('View All Historical Data');
  cy.get('[role="grid"]').should('be.visible');
}

describe('Data Viewing and Browsing', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('standardUser');
    cy.mockCoreDataValidity();
  });

  it('loads View Data with the active census context and current rows', () => {
    mockMeasurementsSummaryApi({
      rows: [
        buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04', quadratName: 'Q0101' }),
        buildMeasurementsSummaryRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', quadratName: 'Q0102', isValidated: null })
      ]
    });

    openViewData();

    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 5');
    cy.get('input[placeholder="Search All Fields..."]').should('be.visible');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');
    cy.contains('[role="row"]', 'TREE102').should('contain', 'ANOPKL');
  });

  it('loads View All Historical Data with the current toolbar and historical rows', () => {
    mockIsolatedGridApi({
      gridType: 'viewfulltable',
      rows: [
        buildViewFullTableRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04', quadratName: 'Q0101' }),
        buildViewFullTableRow({ coreMeasurementID: 102, treeTag: 'TREE102', speciesCode: 'ANOPKL', quadratName: 'Q0102' }),
        buildViewFullTableRow({ coreMeasurementID: 103, treeTag: 'TREE103', speciesCode: 'CECR01', quadratName: 'Q0103' })
      ]
    });

    openViewFullTable();

    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');
    cy.contains('[role="row"]', 'TREE102').should('contain', 'ANOPKL');
    cy.contains('[role="row"]', 'TREE103').should('contain', 'CECR01');
    cy.get('input[placeholder="Search All Fields..."]').should('be.visible');
    cy.get('[aria-label="Export as CSV"]').should('exist');
    cy.get('[aria-label="More actions"]').should('be.visible');
  });

  it('paginates historical rows and exposes the current export and reset-view actions', () => {
    mockIsolatedGridApi({
      gridType: 'viewfulltable',
      rows: Array.from({ length: 12 }, (_, index) =>
        buildViewFullTableRow({
          coreMeasurementID: index + 1,
          treeTag: `TREE${String(index + 1).padStart(3, '0')}`,
          speciesCode: index < 10 ? 'RUBI04' : 'ANOPKL',
          quadratName: `Q${String(index + 1).padStart(4, '0')}`
        })
      )
    });

    openViewFullTable();

    cy.contains('[role="row"]', 'TREE001').should('be.visible');
    cy.get('[aria-label*="next page"]').click({ force: true });
    cy.contains('[role="row"]', 'TREE011').should('be.visible');

    cy.get('[aria-label="Export as CSV"]').scrollIntoView().click({ force: true });
    cy.wait('@filterIsolatedGridRows');
    cy.wait('@runIsolatedGridQuery');
    cy.contains('Error fetching full data').should('not.exist');

    cy.get('[aria-label="More actions"]').click();
    cy.contains('[role="menuitem"]', 'Reset View').should('be.visible');
  });

  it('keeps the selected census context while moving from View Data to View All Historical Data', () => {
    mockMeasurementsSummaryApi({
      rows: [buildMeasurementsSummaryRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04' })]
    });
    mockIsolatedGridApi({
      gridType: 'viewfulltable',
      rows: [buildViewFullTableRow({ coreMeasurementID: 101, treeTag: 'TREE101', speciesCode: 'RUBI04' })]
    });

    openViewData();
    cy.contains('[role="row"]', 'TREE101').should('be.visible');

    cy.openCensusHubLink('View All Historical Data');

    cy.url().should('include', '/measurementshub/viewfulltable');
    cy.get('[data-testid="selected-site-name"]').should('contain', 'Luquillo');
    cy.get('[data-testid="selected-plot-name"]').should('contain', 'Luquillo Main Plot');
    cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain', 'Census: 5');
    cy.contains('[role="row"]', 'TREE101').should('contain', 'RUBI04');
  });
});
