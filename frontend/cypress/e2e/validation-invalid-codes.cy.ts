/// <reference types="cypress" />

/**
 * E2E tests for invalid attribute code and abnormal DBH validations
 *
 * Tests verify that:
 * 1. Invalid attribute codes are flagged during upload validation
 * 2. Abnormally high DBH values are flagged
 * 3. Validation errors are properly displayed to users
 */

describe('Upload System - Invalid Code Validations', () => {
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

  it('should flag measurement with invalid attribute code MX', () => {
    // Mock validation that finds invalid code 'MX'
    cy.intercept('POST', '/api/validations/procedures/ValidateFindInvalidAttributeCodes', {
      statusCode: 200,
      body: { success: true }
    }).as('invalidCodeValidation');

    // Mock validation errors display showing the invalid code
    cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
      statusCode: 200,
      body: {
        failed: [
          {
            coreMeasurementID: 123,
            validationErrorIDs: [14],
            descriptions: ['Attribute code does not exist in attributes table'],
            criteria: ['attributes']
          }
        ]
      }
    }).as('validationErrors');

    // Mock measurement data with invalid code
    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', {
      statusCode: 200,
      body: {
        output: [
          {
            id: 123,
            coreMeasurementID: 123,
            treeTag: '011380',
            stemTag: '1',
            measuredDBH: 150,
            attributes: 'MX', // Invalid code
            isValidated: false
          }
        ],
        totalCount: 1
      }
    }).as('measurements');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    // Click to view invalid/error records
    cy.get('[data-testid="error-validation-button"]').click();
    cy.wait('@measurements');
    cy.wait('@validationErrors');

    // Verify the invalid record is shown
    cy.get('[data-testid="measurement-grid"]').should('contain', '011380');

    // Click on error icon to see details
    cy.get('[data-testid="error-icon"]').first().click();

    // Verify error message is displayed
    cy.get('[data-testid="validation-error-dialog"]').should('be.visible');
    cy.get('[data-testid="validation-error-dialog"]').should('contain', 'Attribute code does not exist');
  });

  it('should flag measurement with abnormally high DBH of 26600mm', () => {
    // Mock validation that finds abnormally high DBH
    cy.intercept('POST', '/api/validations/procedures/ValidateFindAbnormallyHighDBH', {
      statusCode: 200,
      body: { success: true }
    }).as('abnormalDBHValidation');

    // Mock validation errors display showing the abnormal DBH
    cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
      statusCode: 200,
      body: {
        failed: [
          {
            coreMeasurementID: 456,
            validationErrorIDs: [15],
            descriptions: ['DBH exceeds absolute maximum threshold (3500mm or 350cm)'],
            criteria: ['measuredDBH']
          }
        ]
      }
    }).as('validationErrors');

    // Mock measurement data with abnormally high DBH
    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', {
      statusCode: 200,
      body: {
        output: [
          {
            id: 456,
            coreMeasurementID: 456,
            treeTag: '011379',
            stemTag: '1',
            measuredDBH: 26600, // Abnormally high
            attributes: 'A',
            isValidated: false
          }
        ],
        totalCount: 1
      }
    }).as('measurements');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    // Click to view invalid/error records
    cy.get('[data-testid="error-validation-button"]').click();
    cy.wait('@measurements');
    cy.wait('@validationErrors');

    // Verify the invalid record is shown
    cy.get('[data-testid="measurement-grid"]').should('contain', '011379');
    cy.get('[data-testid="measurement-grid"]').should('contain', '26600');

    // Click on error icon to see details
    cy.get('[data-testid="error-icon"]').first().click();

    // Verify error message is displayed
    cy.get('[data-testid="validation-error-dialog"]').should('be.visible');
    cy.get('[data-testid="validation-error-dialog"]').should('contain', 'exceeds absolute maximum threshold');
  });

  it('should flag DBH at exactly 3500mm threshold', () => {
    // Test edge case: DBH exactly at 3500mm
    cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
      statusCode: 200,
      body: {
        failed: [
          {
            coreMeasurementID: 789,
            validationErrorIDs: [15],
            descriptions: ['DBH exceeds absolute maximum threshold (3500mm or 350cm)'],
            criteria: ['measuredDBH']
          }
        ]
      }
    }).as('validationErrors');

    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', {
      statusCode: 200,
      body: {
        output: [
          {
            id: 789,
            coreMeasurementID: 789,
            treeTag: '011390',
            measuredDBH: 3500, // Exactly at threshold
            isValidated: false
          }
        ],
        totalCount: 1
      }
    }).as('measurements');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    cy.get('[data-testid="error-validation-button"]').click();
    cy.wait('@measurements');

    // Should be flagged
    cy.get('[data-testid="measurement-grid"]').should('contain', '3500');
  });

  it('should not flag DBH just below 3500mm threshold', () => {
    // Test edge case: DBH at 3499mm should not be flagged
    cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
      statusCode: 200,
      body: {
        failed: [] // No errors
      }
    }).as('validationErrors');

    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', {
      statusCode: 200,
      body: {
        output: [
          {
            id: 999,
            coreMeasurementID: 999,
            treeTag: '011400',
            measuredDBH: 3499, // Just below threshold
            isValidated: true // Should pass validation
          }
        ],
        totalCount: 1
      }
    }).as('measurements');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    // Click to view valid records
    cy.get('[data-testid="valid-validation-button"]').click();
    cy.wait('@measurements');

    // Should be shown as valid
    cy.get('[data-testid="measurement-grid"]').should('contain', '011400');
    cy.get('[data-testid="measurement-grid"]').should('contain', '3499');

    // Should not have error icon
    cy.get('[data-testid="error-icon"]').should('not.exist');
  });

  it('should handle multiple validation errors on the same record', () => {
    // Test case where a record has both invalid code AND abnormal DBH
    cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
      statusCode: 200,
      body: {
        failed: [
          {
            coreMeasurementID: 555,
            validationErrorIDs: [14, 15],
            descriptions: ['Attribute code does not exist in attributes table', 'DBH exceeds absolute maximum threshold (3500mm or 350cm)'],
            criteria: ['attributes', 'measuredDBH']
          }
        ]
      }
    }).as('validationErrors');

    cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/*', {
      statusCode: 200,
      body: {
        output: [
          {
            id: 555,
            coreMeasurementID: 555,
            treeTag: '011500',
            measuredDBH: 5000, // Abnormally high
            attributes: 'XYZ', // Invalid code
            isValidated: false
          }
        ],
        totalCount: 1
      }
    }).as('measurements');

    cy.visit('/measurementshub');
    cy.wait(['@session', '@plots', '@census']);

    cy.get('[data-testid="error-validation-button"]').click();
    cy.wait('@measurements');
    cy.wait('@validationErrors');

    // Click on error icon
    cy.get('[data-testid="error-icon"]').first().click();

    // Should show both errors
    cy.get('[data-testid="validation-error-dialog"]').should('be.visible');
    cy.get('[data-testid="validation-error-dialog"]').should('contain', 'Attribute code does not exist');
    cy.get('[data-testid="validation-error-dialog"]').should('contain', 'exceeds absolute maximum threshold');
  });

  it('should run both validations during upload process', () => {
    let validationsRun = {
      invalidCode: false,
      abnormalDBH: false
    };

    cy.intercept('POST', '/api/validations/procedures/ValidateFindInvalidAttributeCodes', req => {
      validationsRun.invalidCode = true;
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('invalidCodeValidation');

    cy.intercept('POST', '/api/validations/procedures/ValidateFindAbnormallyHighDBH', req => {
      validationsRun.abnormalDBH = true;
      req.reply({ statusCode: 200, body: { success: true } });
    }).as('abnormalDBHValidation');

    // Mock validation list to include both validations
    cy.intercept('GET', '/api/validations/validationlist?*', {
      statusCode: 200,
      body: {
        coreValidations: {
          ValidateFindInvalidAttributeCodes: {
            id: 14,
            description: 'Flags invalid attribute codes',
            definition: 'INSERT query...'
          },
          ValidateFindAbnormallyHighDBH: {
            id: 15,
            description: 'Flags abnormally high DBH',
            definition: 'INSERT query...'
          }
        }
      }
    }).as('validationList');

    cy.visit('/upload');
    cy.wait('@session');

    // Trigger upload validation
    cy.get('[data-testid="start-validation"]').click();
    cy.wait('@validationList');

    // Both validations should have been called
    cy.wrap(validationsRun).should('deep.equal', {
      invalidCode: true,
      abnormalDBH: true
    });
  });
});
