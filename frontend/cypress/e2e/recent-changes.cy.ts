/// <reference types="cypress" />

interface RecentChangeEntry {
  changeID: number;
  tableName: string;
  recordID: string;
  operation: 'UPDATE';
  oldRowState: Record<string, unknown>;
  newRowState: Record<string, unknown>;
  changeTimestamp: string;
  changedBy: string;
}

function makeUpdate(changeID: number, treeTag: string): RecentChangeEntry {
  return {
    changeID,
    tableName: 'measurements',
    recordID: String(changeID),
    operation: 'UPDATE',
    oldRowState: { TreeTag: treeTag, MeasuredDBH: 10 },
    newRowState: { TreeTag: treeTag, MeasuredDBH: 12 },
    changeTimestamp: '2026-09-01T12:00:00.000Z',
    changedBy: 'e2e-admin@forestgeo.si.edu'
  };
}

function queryResponse(entry: RecentChangeEntry) {
  return {
    items: [{ type: 'single', entry }],
    totalItems: 1,
    summary: { total: 1, updates: 1, inserts: 0, deletes: 0 },
    hasMore: false
  };
}

function openRecentChanges() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('Recent Changes');
  cy.contains('Review all changes made to data within this plot').should('be.visible');
}

describe('Recent Changes', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
    cy.intercept('POST', '/api/changes/explorer/facets', {
      statusCode: 200,
      body: {
        users: [{ value: 'e2e-admin@forestgeo.si.edu', count: 2 }],
        tables: [{ value: 'measurements', count: 2 }],
        operationCounts: { INSERT: 0, UPDATE: 2, DELETE: 0 }
      }
    }).as('fetchRecentChangeFacets');
  });

  it('loads the active plot feed, exposes row details, and applies quick search', () => {
    const initialEntry = makeUpdate(101, 'TREE101');
    const filteredEntry = makeUpdate(102, 'TREE102');
    filteredEntry.changedBy = 'filtered-result@forestgeo.si.edu';

    cy.intercept('POST', '/api/changes/explorer/query', req => {
      const quickSearch = req.body?.filters?.quickSearch;
      if (quickSearch === 'TREE102') req.alias = 'filteredRecentChanges';
      req.reply({ statusCode: 200, body: queryResponse(quickSearch === 'TREE102' ? filteredEntry : initialEntry) });
    }).as('fetchRecentChanges');

    openRecentChanges();

    cy.wait('@fetchRecentChanges').then(interception => {
      expect(interception.request.body).to.include({ schema: 'luquillo', plotID: 1, page: 0, pageSize: 25 });
    });
    cy.contains('Updated a measurement record').should('be.visible');
    cy.contains('summary', 'Details').click();
    cy.contains('MeasuredDBH').should('be.visible');

    cy.get('[aria-label="Quick Search"]').type('TREE102');
    cy.wait('@filteredRecentChanges').its('request.body.filters.quickSearch').should('equal', 'TREE102');
    cy.contains('filtered-result@forestgeo.si.edu').should('be.visible');
  });

  it('surfaces query failures and leaves the explorer in a recoverable empty state', () => {
    cy.intercept('POST', '/api/changes/explorer/query', {
      statusCode: 500,
      body: { error: 'Database unavailable' }
    }).as('failedRecentChanges');

    openRecentChanges();
    cy.wait('@failedRecentChanges');

    cy.contains('Query request failed: 500').should('be.visible');
    cy.contains('No changes found').should('be.visible');
    cy.get('[aria-label="Quick Search"]').should('be.enabled');
  });
});
