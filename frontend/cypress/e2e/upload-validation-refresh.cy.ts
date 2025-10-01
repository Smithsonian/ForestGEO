/// <reference types="cypress" />

/**
 * Tests for upload system validation refresh bugs
 *
 * This test suite addresses the following bugs:
 * 1. 'Pending Validation' button shows stale data after records upload
 * 2. Invalid record button not displaying invalid records when clicked
 * 3. Counts not being refreshed after validation completes
 */

describe('Upload System - Validation Button Refresh', () => {
  beforeEach(() => {
    // Mock authentication
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: { email: 'test@example.com' },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    }).as('session');

    // Mock site/plot/census selection
    cy.intercept('GET', '/api/fetchall/plots?schema=*', {
      statusCode: 200,
      body: [{ plotID: 1, plotName: 'Test Plot' }]
    }).as('plots');

    cy.intercept('GET', '/api/fetchall/census/1/1?schema=*', {
      statusCode: 200,
      body: [{ censusID: 1, plotCensusNumber: 1 }]
    }).as('census');
  });

  it('should refresh pending validation count after records are validated', () => {
    // Initial state: 2 records pending validation
    cy.intercept('POST', '/api/query', req => {
      const query = req.body;
      if (typeof query === 'string' && query.includes('CountPending')) {
        req.reply({
          statusCode: 200,
          body: [
            {
              CountValid: 5,
              CountErrors: 0,
              CountPending: 2,
              CountOldTrees: 3,
              CountNewRecruits: 1,
              CountMultiStems: 1
            }
          ]
        });
      }
    }).as('countsInitial');

    // Mock fetching paginated data with pending records
    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', req => {
      const filterModel = req.body.filterModel;
      if (filterModel?.visible?.includes('pending')) {
        req.reply({
          statusCode: 200,
          body: {
            output: [
              { id: 1, coreMeasurementID: 1, isValidated: null, treeTag: '011375' },
              { id: 2, coreMeasurementID: 2, isValidated: null, treeTag: '011411' }
            ],
            totalCount: 2
          }
        });
      }
    }).as('pendingRecordsInitial');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    // Click on pending validation button
    cy.get('[data-testid="pending-validation-button"]').click();
    cy.wait('@pendingRecordsInitial');

    // Should show 2 pending records
    cy.get('[data-testid="measurement-grid"]').find('[role="row"]').should('have.length', 3); // header + 2 rows

    // Simulate validation completing - records transition from pending to validated
    cy.intercept('POST', '/api/query', req => {
      const query = req.body;
      if (typeof query === 'string' && query.includes('CountPending')) {
        req.reply({
          statusCode: 200,
          body: [
            {
              CountValid: 7, // 5 + 2 newly validated
              CountErrors: 0,
              CountPending: 0, // No more pending
              CountOldTrees: 3,
              CountNewRecruits: 1,
              CountMultiStems: 1
            }
          ]
        });
      }
    }).as('countsAfterValidation');

    // Mock fetching paginated data after validation - no pending records
    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', req => {
      const filterModel = req.body.filterModel;
      if (filterModel?.visible?.includes('pending')) {
        req.reply({
          statusCode: 200,
          body: {
            output: [], // No pending records anymore
            totalCount: 0
          }
        });
      }
    }).as('pendingRecordsAfterValidation');

    // Trigger refresh (simulating validation completion)
    cy.get('[data-testid="refresh-button"]').click();
    cy.wait('@countsAfterValidation');

    // Click pending button again
    cy.get('[data-testid="pending-validation-button"]').click();
    cy.wait('@pendingRecordsAfterValidation');

    // Should show 0 pending records now (not stale data)
    cy.get('[data-testid="pending-validation-button"]').should('contain', '0');
    cy.get('[data-testid="measurement-grid"]').find('[role="row"]').should('have.length', 1); // only header
  });

  it('should display invalid records when clicking invalid button', () => {
    // Mock counts with error records
    cy.intercept('POST', '/api/query', req => {
      const query = req.body;
      if (typeof query === 'string' && query.includes('CountErrors')) {
        req.reply({
          statusCode: 200,
          body: [
            {
              CountValid: 5,
              CountErrors: 2,
              CountPending: 0,
              CountOldTrees: 3,
              CountNewRecruits: 1,
              CountMultiStems: 1
            }
          ]
        });
      }
    }).as('countsWithErrors');

    // Mock fetching invalid records
    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', req => {
      const filterModel = req.body.filterModel;
      if (filterModel?.visible?.includes('errors')) {
        req.reply({
          statusCode: 200,
          body: {
            output: [
              { id: 1, coreMeasurementID: 1, isValidated: false, treeTag: '011379', measuredDBH: 26600 },
              { id: 2, coreMeasurementID: 2, isValidated: false, treeTag: '011380', attributes: 'MX' }
            ],
            totalCount: 2
          }
        });
      }
    }).as('errorRecords');

    // Mock validation errors
    cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
      statusCode: 200,
      body: {
        failed: [
          {
            coreMeasurementID: 1,
            validationErrorIDs: [1],
            descriptions: ['DBH exceeds maximum threshold'],
            criteria: ['measuredDBH']
          },
          {
            coreMeasurementID: 2,
            validationErrorIDs: [2],
            descriptions: ['Invalid attribute code'],
            criteria: ['attributes']
          }
        ]
      }
    }).as('validationErrors');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    // Click on invalid records button
    cy.get('[data-testid="error-validation-button"]').click();
    cy.wait('@errorRecords');
    cy.wait('@validationErrors');

    // Should display 2 invalid records
    cy.get('[data-testid="measurement-grid"]').find('[role="row"]').should('have.length', 3); // header + 2 rows
    cy.get('[data-testid="measurement-grid"]').should('contain', '011379');
    cy.get('[data-testid="measurement-grid"]').should('contain', '011380');
  });

  it('should update counts when toggling between validation states', () => {
    let currentFilter = 'all';

    cy.intercept('POST', '/api/query', req => {
      const query = req.body;
      if (typeof query === 'string' && query.includes('CountPending')) {
        req.reply({
          statusCode: 200,
          body: [
            {
              CountValid: 5,
              CountErrors: 2,
              CountPending: 3,
              CountOldTrees: 3,
              CountNewRecruits: 1,
              CountMultiStems: 1
            }
          ]
        });
      }
    }).as('counts');

    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', req => {
      const filterModel = req.body.filterModel;
      currentFilter = filterModel?.visible?.[0] || 'all';

      const responses = {
        pending: {
          output: Array(3)
            .fill(null)
            .map((_, i) => ({
              id: i,
              coreMeasurementID: i,
              isValidated: null
            })),
          totalCount: 3
        },
        errors: {
          output: Array(2)
            .fill(null)
            .map((_, i) => ({
              id: i + 10,
              coreMeasurementID: i + 10,
              isValidated: false
            })),
          totalCount: 2
        },
        valid: {
          output: Array(5)
            .fill(null)
            .map((_, i) => ({
              id: i + 20,
              coreMeasurementID: i + 20,
              isValidated: true
            })),
          totalCount: 5
        }
      };

      req.reply({
        statusCode: 200,
        body: responses[currentFilter] || { output: [], totalCount: 0 }
      });
    }).as('filteredRecords');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    // Click pending button
    cy.get('[data-testid="pending-validation-button"]').click();
    cy.wait('@counts');
    cy.wait('@filteredRecords');
    cy.get('[data-testid="measurement-grid"]').find('[role="row"]').should('have.length', 4); // header + 3 rows

    // Click error button
    cy.get('[data-testid="error-validation-button"]').click();
    cy.wait('@counts');
    cy.wait('@filteredRecords');
    cy.get('[data-testid="measurement-grid"]').find('[role="row"]').should('have.length', 3); // header + 2 rows

    // Click valid button
    cy.get('[data-testid="valid-validation-button"]').click();
    cy.wait('@counts');
    cy.wait('@filteredRecords');
    cy.get('[data-testid="measurement-grid"]').find('[role="row"]').should('have.length', 6); // header + 5 rows
  });
});
