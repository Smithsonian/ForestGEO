/// <reference types="cypress" />

import { buildMeasurementsSummaryRow, mockMeasurementsSummaryApi } from '../support/grid-api-helpers';

function openRevisionUploadFromSummary() {
  cy.setupForestGEOUser('standardUser');
  cy.mockCoreDataValidity();
  mockMeasurementsSummaryApi({
    rows: [buildMeasurementsSummaryRow({ coreMeasurementID: 12345, treeTag: 'TREE12345', stemTag: '1' })]
  });

  cy.visitAuthenticatedPage('/dashboard');
  cy.selectSitePlotAndCensus('Luquillo', 'Luquillo Main Plot', 5);
  cy.openCensusHubLink('View Data');
  cy.get('[role="grid"]').should('be.visible');

  cy.contains('button', /^Upload$/)
    .scrollIntoView()
    .should('be.visible')
    .click({ force: true });
  cy.get('[role="dialog"]')
    .should('exist')
    .within(() => {
      cy.contains('button', 'Use Revisions Upload').should('be.visible').click();
    });
  cy.get('[role="dialog"]').within(() => {
    cy.contains('Choose files or drag them here').should('be.visible');
  });
}

function attachRevisionCsv(csvContent: string, fileName = 'measurement-revision.csv') {
  cy.get('input[type="file"]')
    .first()
    .then(input => {
      const file = new File([csvContent], fileName, { type: 'text/csv' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input[0].files = dataTransfer.files;
      input[0].dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function stubRevisionMatch() {
  cy.intercept('POST', '/api/revisionupload', req => {
    expect(req.body.files).to.have.length(1);
    expect(req.body.files[0].rows).to.have.length(1);
    expect(req.body.files[0].rows[0]).to.deep.include({
      stemid: '12345',
      dbh: '15.6'
    });
    expect(req.body.files[0].rows[0]).to.not.have.property('StemGUID');

    req.reply({
      statusCode: 200,
      body: {
        matchedRows: [
          {
            csvRow: {
              stemid: '12345',
              dbh: '15.6'
            },
            coreMeasurementID: 12345,
            existingValues: {
              measuredDBH: 15.5,
              measuredHOM: 1.3,
              measurementDate: '2024-06-15',
              rawCodes: null,
              description: null
            },
            changes: {
              dbh: {
                from: '15.5',
                to: '15.6'
              }
            }
          }
        ],
        newRows: [],
        invalidRows: [],
        counts: {
          matched: 1,
          matchedWithChanges: 1,
          new: 0,
          invalid: 0,
          total: 1
        }
      }
    });
  }).as('matchRevisionUpload');
}

describe('Revision Upload Browser Flow', () => {
  beforeEach(() => {
    cy.viewport(1600, 1000);
  });

  it('normalizes a View Data export row and sends stemid-based revisions to the match API', () => {
    stubRevisionMatch();

    openRevisionUploadFromSummary();
    attachRevisionCsv(`StemGUID,MeasuredDBH\n12345,15.6\n`);

    cy.contains('button', /Continue Upload/)
      .should('be.enabled')
      .click();

    cy.wait('@matchRevisionUpload');
    cy.contains('Revision Upload Review').should('be.visible');
    cy.contains('td', 'dbh').should('be.visible');
  });

  it('surfaces apply conflicts in the browser flow and lets the user return to review', () => {
    stubRevisionMatch();

    cy.intercept('POST', '/api/revisionupload/apply', req => {
      req.reply({
        statusCode: 409,
        body: {
          error: 'Revision apply blocked: upload session is active.'
        }
      });
    }).as('applyRevisionUpload');

    openRevisionUploadFromSummary();
    attachRevisionCsv(`StemGUID,MeasuredDBH\n12345,15.6\n`, 'measurement-revision-conflict.csv');

    cy.contains('button', /Continue Upload/)
      .should('be.enabled')
      .click();
    cy.wait('@matchRevisionUpload');

    cy.contains('button', 'Apply 1 Revisions').click();
    cy.wait('@applyRevisionUpload');
    cy.contains('Failed to Apply Revisions').should('be.visible');
    cy.contains('Revision apply blocked: upload session is active.').should('be.visible');
    cy.contains('button', 'Back to Review').click();
    cy.contains('Revision Upload Review').should('be.visible');
    cy.contains('button', 'Apply 1 Revisions').should('be.visible');
  });
});
