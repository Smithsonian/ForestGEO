/// <reference types="cypress" />

import type { ErrorExplorerQueryRequest } from '../../config/errorsexplorer';
import { buildErrorsExplorerDetails, buildErrorsExplorerRow, mockErrorsExplorerApi } from '../support/errors-explorer-helpers';

const FILTER_STORAGE_KEY = 'errors-explorer-filters:luquillo:1:5';

const INVALID_SPECIES_MESSAGE = 'Invalid species reference';
const MISSING_MEASUREMENT_MESSAGE = 'Missing measurement data';
const SAME_BATCH_MESSAGE = 'Same-batch species conflict';
const TITLE_SELECTOR = '[data-testid="errors-explorer-title"]';
const GROUP_GRID_SELECTOR = '[data-testid^="errors-grid-group:"]';
const DETAILS_SHEET_SELECTOR = '[data-testid="error-row-details-sheet"]';
const GRID_ROW_SELECTOR = '.MuiDataGrid-row';
const SAVED_FILTER_KEYS = ['contradictionOnly', 'exactMessages', 'quickSearch', 'source'];

const invalidSpeciesRow = buildErrorsExplorerRow({
  id: 1,
  coreMeasurementID: 101,
  treeTag: 'TREE-101',
  speciesCode: 'RUBI04',
  primaryErrorMessage: INVALID_SPECIES_MESSAGE,
  errorMessages: [INVALID_SPECIES_MESSAGE],
  errorSources: ['ingestion'],
  errorFields: ['speciesCode'],
  errorCodes: ['INVALID_SPECIES'],
  description: INVALID_SPECIES_MESSAGE
});

const secondInvalidSpeciesRow = buildErrorsExplorerRow({
  id: 5,
  coreMeasurementID: 105,
  treeTag: 'TREE-099',
  speciesCode: 'ANOPKL',
  primaryErrorMessage: INVALID_SPECIES_MESSAGE,
  errorMessages: [INVALID_SPECIES_MESSAGE],
  errorSources: ['ingestion'],
  errorFields: ['speciesCode'],
  errorCodes: ['INVALID_SPECIES'],
  description: INVALID_SPECIES_MESSAGE
});

const missingMeasurementRow = buildErrorsExplorerRow({
  id: 2,
  coreMeasurementID: 202,
  treeTag: 'TREE-202',
  speciesCode: 'ANOPKL',
  primaryErrorMessage: MISSING_MEASUREMENT_MESSAGE,
  errorMessages: [MISSING_MEASUREMENT_MESSAGE],
  errorSources: ['ingestion'],
  errorFields: ['measuredDBH', 'measuredHOM'],
  errorCodes: ['MISSING_MEASUREMENT_DATA'],
  description: MISSING_MEASUREMENT_MESSAGE,
  measuredDBH: 0,
  measuredHOM: 0
});

const contradictionRow = buildErrorsExplorerRow({
  id: 3,
  coreMeasurementID: 303,
  treeTag: 'DUP-303',
  speciesCode: 'RUBI04',
  primaryErrorMessage: SAME_BATCH_MESSAGE,
  errorMessages: [SAME_BATCH_MESSAGE],
  errorSources: ['validation'],
  errorFields: ['treeTag', 'speciesCode'],
  errorCodes: ['21'],
  description: 'Species differs within the same batch upload',
  hasContradiction: true,
  contradictionType: 'same_batch_conflict',
  contradictionTypes: ['same_batch_conflict'],
  relatedMeasurementIDs: [304],
  uploadBatchID: 'batch-77'
});

const cleanFirstRowOfBatch = {
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
  description: 'Clean first row of the batch',
  uploadBatchID: 'batch-77',
  primaryErrorMessage: '',
  errorCount: 0,
  errorMessages: [],
  inErrorSet: false
};

function openErrorsExplorer() {
  cy.visitAuthenticatedPage('/dashboard');
  cy.contains('Welcome back').should('be.visible');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Errors');
  cy.wait('@fetchErrorFacets').as('firstFacetsRequest');
  cy.wait('@fetchErrorsExplorerRows').as('firstRowsRequest');
  cy.get(TITLE_SELECTOR).should('have.text', 'View Errors');
}

// The Errors cell stays text in edit mode; tag cells turn into inputs, so an alias anchored on a tag would stop resolving.
function getExplorerRow(text: string) {
  return cy.contains(GRID_ROW_SELECTOR, text);
}

function openRowDetails(text: string) {
  getExplorerRow(text).find('[aria-label="Details"]').click();
  cy.wait('@fetchErrorDetails');
}

function expandGroup(label: string) {
  cy.contains('button[aria-expanded]', label).then(button => {
    if (button.attr('aria-expanded') === 'false') cy.wrap(button).click();
  });
}

function showToggle(value: string) {
  return cy.get(`[role="group"][aria-label="Show"] button[value="${value}"]`);
}

describe('View Errors', () => {
  beforeEach(() => {
    // Editing a species code is a taxonomic-identity change, which the app
    // restricts to global / db-admin roles (isFieldEditableByRole). Authenticate
    // as a global admin so the speciesCode cell is editable in these tests.
    cy.setupForestGEOUser('adminUser');
    cy.mockCoreDataValidity();
  });

  it('loads View Errors with the census scope and shows row details', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, missingMeasurementRow],
      detailsByMeasurementID: {
        101: buildErrorsExplorerDetails(
          invalidSpeciesRow,
          [],
          [
            {
              source: 'ingestion',
              code: 'INVALID_SPECIES',
              message: INVALID_SPECIES_MESSAGE,
              fields: ['speciesCode'],
              comparison: null
            }
          ]
        )
      }
    });

    openErrorsExplorer();

    cy.get('@firstFacetsRequest').its('request.body').should('deep.include', { schema: 'luquillo', plotID: 1, censusID: 5 });
    cy.get('@firstFacetsRequest').its('request.body.filters').should('deep.include', { source: 'all', contradictionOnly: false, quickSearch: '' });
    cy.get('@firstRowsRequest').its('request.body').should('deep.include', { schema: 'luquillo', plotID: 1, censusID: 5 });
    cy.get('@firstRowsRequest')
      .its('request.body.errorType')
      .should('deep.equal', { source: 'ingestion', code: 'INVALID_SPECIES', message: INVALID_SPECIES_MESSAGE });

    cy.get(GROUP_GRID_SELECTOR).should('have.length', 1);
    openRowDetails('TREE-101');

    cy.get(DETAILS_SHEET_SELECTOR).within(() => {
      cy.contains('Measurement 101').should('be.visible');
      cy.contains(INVALID_SPECIES_MESSAGE).should('be.visible');
      cy.get('[data-testid="error-source-chip-ingestion"]').should('be.visible').and('have.text', 'Ingestion');
    });
  });

  it('filters with Show and Search and saves the four keys', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, missingMeasurementRow, contradictionRow]
    });

    openErrorsExplorer();
    cy.contains('button[aria-expanded]', SAME_BATCH_MESSAGE).should('be.visible');

    showToggle('ingestion').click();
    cy.contains('button[aria-expanded]', SAME_BATCH_MESSAGE).should('not.exist');
    cy.contains('button[aria-expanded]', MISSING_MEASUREMENT_MESSAGE).should('be.visible');

    cy.get('input[aria-label="Search"]').clear().type('ANOPKL');
    cy.contains('button[aria-expanded]', MISSING_MEASUREMENT_MESSAGE).should('be.visible');
    cy.contains('button[aria-expanded]', INVALID_SPECIES_MESSAGE).should('not.exist');

    cy.window().should(win => {
      const savedFilters = JSON.parse(win.localStorage.getItem(FILTER_STORAGE_KEY) ?? '{}');
      const observed = `saved filters ${JSON.stringify(savedFilters)}`;
      expect(Object.keys(savedFilters).sort(), observed).to.deep.equal(SAVED_FILTER_KEYS);
      expect(savedFilters.source, observed).to.equal('ingestion');
      expect(savedFilters.quickSearch, observed).to.equal('ANOPKL');
    });
  });

  it('compares a same-batch row with the clean first row', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, contradictionRow],
      detailsByMeasurementID: {
        303: buildErrorsExplorerDetails(
          contradictionRow,
          [cleanFirstRowOfBatch],
          [
            {
              source: 'validation',
              code: '21',
              message: SAME_BATCH_MESSAGE,
              fields: ['treeTag', 'speciesCode'],
              procedureName: 'ValidateSameBatchSpeciesConflict',
              comparison: null
            }
          ]
        )
      }
    });

    openErrorsExplorer();
    expandGroup(SAME_BATCH_MESSAGE);

    openRowDetails('DUP-303');

    cy.get(DETAILS_SHEET_SELECTOR).within(() => {
      cy.contains('Compare with the other row').scrollIntoView().should('be.visible');
      cy.contains('No unresolved errors').scrollIntoView().should('be.visible');
      cy.contains('button', 'Inspect this row').should('not.exist');
      cy.contains('button', 'Open row 304').should('not.exist');
    });
  });

  it('keeps the updated species code visible after saving an error row', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, missingMeasurementRow]
    });

    openErrorsExplorer();

    cy.get(GROUP_GRID_SELECTOR).within(() => {
      getExplorerRow(INVALID_SPECIES_MESSAGE).as('errorRow');
      cy.get('@errorRow').find('[data-field="speciesCode"]').should('contain', 'RUBI04');
      cy.get('@errorRow').find('[aria-label="Edit"]').click();
      cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });
      cy.get('@errorRow').find('[aria-label="Save"]').click();
    });

    // Committing the edit opens the PreviewDialog (a SpeciesCode change is `warn`
    // severity); applying it commits via the edit-plan apply endpoint.
    cy.wait('@previewEdit');
    cy.get('[data-testid="edit-preview-apply"]').click();
    cy.wait('@applyEdit').its('request.body.newRow.SpeciesCode').should('eq', 'ANOPKL');
    cy.wait('@refreshMeasurementsSummary');
    cy.wait('@refreshViewFullTable');

    cy.get(GROUP_GRID_SELECTOR).within(() => {
      getExplorerRow(INVALID_SPECIES_MESSAGE).find('[data-field="speciesCode"]').should('contain', 'ANOPKL');
    });
  });

  it('surfaces save failures without refreshing away the unsaved draft', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow],
      applyHandler: ({ targetID }) => ({
        statusCode: 500,
        body: {
          message: `Failed to update row ${targetID}`
        }
      })
    });

    openErrorsExplorer();

    cy.get(GROUP_GRID_SELECTOR).within(() => {
      getExplorerRow(INVALID_SPECIES_MESSAGE).as('errorRow');
      cy.get('@errorRow').find('[aria-label="Edit"]').click();
      cy.get('@errorRow').find('[data-field="speciesCode"] input').clear({ force: true }).type('ANOPKL', { force: true });
      cy.get('@errorRow').find('[aria-label="Save"]').click();
    });

    cy.wait('@previewEdit');
    cy.get('[data-testid="edit-preview-apply"]').click();
    cy.wait('@applyEdit');
    cy.contains('Failed to update row 101').should('be.visible');
    cy.get(GROUP_GRID_SELECTOR).within(() => {
      getExplorerRow(INVALID_SPECIES_MESSAGE).find('[data-field="speciesCode"] input').should('have.value', 'ANOPKL');
    });
    cy.get('@refreshMeasurementsSummary.all').should('have.length', 0);
  });

  it('sorts on the server and returns to page 0', () => {
    mockErrorsExplorerApi({
      rows: [invalidSpeciesRow, secondInvalidSpeciesRow]
    });

    openErrorsExplorer();

    cy.get(GROUP_GRID_SELECTOR).first().find('[role="columnheader"][data-field="treeTag"]').contains('Tree Tag').click();

    cy.get('@fetchErrorsExplorerRows.all').should(interceptions => {
      const bodies = (interceptions as unknown as Array<{ request: { body: ErrorExplorerQueryRequest } }>).map(interception => interception.request.body);
      const last = bodies[bodies.length - 1];
      const observed = `${bodies.length} row queries, last: ${JSON.stringify(last)}`;
      expect(last.sortModel, observed).to.deep.equal([{ field: 'treeTag', sort: 'asc' }]);
      expect(last.page, observed).to.equal(0);
    });
    cy.get(GROUP_GRID_SELECTOR).first().find(`${GRID_ROW_SELECTOR}[data-rowindex="0"]`).should('contain', 'TREE-099');
  });

  it('shows each column-menu button without hover (D-b)', () => {
    mockErrorsExplorerApi({ rows: [invalidSpeciesRow] });

    openErrorsExplorer();

    cy.get('[role="columnheader"][data-field="treeTag"] .MuiDataGrid-menuIcon').should('be.visible');
    cy.get('[role="columnheader"][data-field="actions"] .MuiDataGrid-menuIcon').should('be.visible');
  });

  it('keeps Codes editing, Save and Cancel in view and hides rarely used columns until Manage columns turns them on (#525 item 7)', () => {
    const DEFAULT_HIDDEN_FIELDS = ['stemPlotX', 'stemPlotY', 'priorDBH', 'dbhChangePercent', 'priorHOM', 'homChanged'];
    const TIGHTENED_HEADER_FIELDS = ['stemLocalX', 'stemLocalY', 'measuredDBH', 'measuredHOM', 'attributes'];
    const LEADING_HEADER_FIELDS = ['actions', 'errors', 'attributes'];
    mockErrorsExplorerApi({ rows: [invalidSpeciesRow] });
    openErrorsExplorer();

    cy.get('[aria-label="Group rows"]').click();
    cy.contains('[role="option"]', 'No grouping').click();
    cy.wait('@fetchErrorsExplorerRows');
    cy.get('[data-testid="errors-grid-flat"]').should('be.visible');

    cy.get('[data-testid="errors-grid-flat"] [role="columnheader"]').then(headers => {
      const headerFields = [...headers].map(header => header.getAttribute('data-field'));
      cy.task('log', `[#525 item 7] header order: ${headerFields.join(', ')}`);
      expect(headerFields.slice(0, LEADING_HEADER_FIELDS.length)).to.deep.equal(LEADING_HEADER_FIELDS);
    });
    DEFAULT_HIDDEN_FIELDS.forEach(field => cy.get(`[role="columnheader"][data-field="${field}"]`).should('not.exist'));
    TIGHTENED_HEADER_FIELDS.forEach(field =>
      cy.get(`[role="columnheader"][data-field="${field}"] .MuiDataGrid-columnHeaderTitle`).then(title => {
        const element = title[0];
        cy.task('log', `[#525 item 7] ${field} header scrollWidth=${element.scrollWidth} clientWidth=${element.clientWidth}`);
        expect(element.scrollWidth, `${field} header must not truncate`).to.be.at.most(element.clientWidth);
      })
    );

    getExplorerRow(INVALID_SPECIES_MESSAGE).as('errorRow');
    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Edit"]').click();
    });
    // Cypress treats an element clipped by an overflow ancestor as hidden, so be.visible proves no horizontal scroll is needed.
    // The cell container renders in view mode too; the combobox input exists only in CodesEditCell's
    // Joy Autocomplete, so this proves Codes is actually editable.
    cy.get('@errorRow').find('[data-field="attributes"] input[role="combobox"]').should('be.visible');
    cy.get('@errorRow').find('[aria-label="Save"]').should('be.visible');
    cy.get('@errorRow').find('[aria-label="Cancel"]').should('be.visible');
    cy.get('.MuiDataGrid-virtualScroller').its('0.scrollLeft').should('eq', 0);
    cy.get('@errorRow').within(() => {
      cy.get('[aria-label="Cancel"]').click();
    });

    cy.get('[role="columnheader"][data-field="attributes"]').trigger('mouseover');
    cy.get('[role="columnheader"][data-field="attributes"] button[aria-label="Codes column menu"]').click({ force: true });
    cy.contains('[role="menuitem"]', 'Manage columns').click();
    cy.get('input[name="stemPlotX"]').check({ force: true });
    cy.get('[role="columnheader"][data-field="stemPlotX"]').should('exist').and('contain', 'Plot X');
  });
});
