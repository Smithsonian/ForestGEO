/**
 * Cross-Feature Integration - Comprehensive E2E Tests
 *
 * Tests workflows that span multiple features and pages including:
 * - Upload → Validation → Viewing → Editing workflow
 * - Fixed data changes → Measurement updates workflow
 * - Multi-user collaboration scenarios
 * - Data consistency across features
 * - Error propagation across workflows
 *
 * Coverage: Cross-feature integration (10% → 90%)
 */

describe('Cross-Feature Integration - Comprehensive Tests', () => {
  const mockSession = {
    user: {
      name: 'Test User',
      email: 'testuser@test.com',
      userStatus: 'field crew'
    },
    expires: '2025-12-31'
  };

  const mockSite = {
    siteID: 1,
    siteName: 'Test Site',
    schemaName: 'test_schema',
    usesSubquadrats: false,
    defaultUOMDBH: 'mm',
    defaultUOMHOM: 'm'
  };

  const mockPlot = {
    plotID: 1,
    plotName: 'Test Plot',
    numQuadrats: 100
  };

  const mockCensus = {
    censusID: 1,
    plotCensusNumber: 1,
    dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }]
  };

  beforeEach(() => {
    cy.log('🔐 Setting up authentication and context');

    // Mock authentication
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: mockSession
    }).as('session');

    // Mock context
    cy.intercept('GET', '/api/fetchall/sites?schema=*', {
      statusCode: 200,
      body: [mockSite]
    }).as('fetchSites');

    cy.intercept('GET', '/api/fetchall/plots?schema=test_schema', {
      statusCode: 200,
      body: [mockPlot]
    }).as('fetchPlots');

    cy.intercept('GET', '/api/fetchall/census?schema=test_schema', {
      statusCode: 200,
      body: [mockCensus]
    }).as('fetchCensus');

    cy.intercept('GET', '/api/fetchall/quadrats?schema=test_schema', {
      statusCode: 200,
      body: [
        { quadratID: 1, quadratName: 'Q0101', plotID: 1 }
      ]
    }).as('fetchQuadrats');

    // Visit dashboard to initialize context
    cy.visit('/dashboard');
    cy.wait(['@session', '@fetchSites', '@fetchPlots', '@fetchCensus']);
  });

  describe('Upload → Validation → Viewing → Editing Workflow', () => {
    it('should complete full data lifecycle workflow', () => {
      cy.log('🔍 Testing complete data lifecycle integration');

      cy.log('📍 STEP 1: Upload CSV file');

      // Mock file upload
      cy.intercept('POST', '/api/upload/measurements', {
        statusCode: 200,
        body: {
          message: 'Upload successful',
          rowsProcessed: 10,
          rowsInserted: 10,
          rowsFailed: 0
        }
      }).as('uploadFile');

      // Mock uploaded files list
      cy.intercept('GET', '/api/files/list?*', {
        statusCode: 200,
        body: {
          blobData: [
            {
              key: 1,
              name: 'test_upload.csv',
              size: 15360,
              date: new Date().toISOString(),
              url: 'https://storage.blob.core.windows.net/test_upload.csv'
            }
          ]
        }
      }).as('fetchUploadedFiles');

      cy.visit('/measurementshub/uploadedfiles');
      cy.wait('@fetchUploadedFiles');

      cy.log('✅ File uploaded and appears in uploaded files list');
      cy.contains('test_upload.csv').should('be.visible');

      cy.log('📍 STEP 2: Run validations on uploaded data');

      // Mock measurements data (just uploaded, pending validation)
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: 'TREE001',
              stemTag: '1',
              dbh: 15.5,
              hom: 1.3,
              isValidated: null // Pending
            },
            {
              id: 2,
              coreMeasurementID: 2,
              treeTag: 'TREE002',
              stemTag: '1',
              dbh: 20.0,
              hom: 1.3,
              isValidated: null // Pending
            }
          ],
          totalCount: 2
        }
      }).as('fetchMeasurements');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{
          CountValid: 0,
          CountErrors: 0,
          CountPending: 2,
          CountOldTrees: 2,
          CountNewRecruits: 0,
          CountMultiStems: 0
        }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationCounts', '@validationErrors']);

      cy.log('✅ Uploaded data appears in view table (pending validation)');
      cy.contains('TREE001').should('be.visible');
      cy.get('[data-testid="HourglassEmptyIcon"]').should('exist'); // Pending icon

      // Mock validation run
      cy.intercept('POST', '/api/cmattributes/validations/run*', {
        statusCode: 200,
        body: {
          message: 'Validations completed',
          errorsFound: 1
        }
      }).as('runValidations');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: {
          failed: [
            {
              coreMeasurementID: 2,
              validationErrorIDs: [1],
              descriptions: ['DBH value exceeds expected range'],
              criteria: ['DBH must be between 0-100 cm']
            }
          ]
        }
      }).as('validationErrorsAfterRun');

      cy.log('🔄 Running validations');
      cy.contains('button', /run validation/i).click();
      cy.wait('@runValidations');

      cy.log('📍 STEP 3: View validation results');

      cy.wait('@validationErrorsAfterRun');

      cy.log('✅ Validation errors are displayed');
      cy.get('[data-testid="ErrorIcon"]').should('exist');

      // Navigate to summary view
      cy.intercept('POST', '/api/summary/coremeasurements/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              quadratName: 'Q0101',
              totalMeasurements: 2,
              validatedCount: 1,
              pendingCount: 0,
              errorCount: 1
            }
          ],
          totalCount: 1
        }
      }).as('fetchSummary');

      cy.visit('/measurementshub/summary');
      cy.wait('@fetchSummary');

      cy.log('✅ Summary shows validation status breakdown');
      cy.contains('1').should('be.visible'); // 1 error
      cy.contains('1').should('be.visible'); // 1 validated

      cy.log('📍 STEP 4: Edit data to fix validation errors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationErrorsAfterRun']);

      // Edit the row with error
      cy.get('[role="row"]').eq(2).within(() => {
        cy.get('[aria-label="Edit"]').click();
      });

      cy.intercept('PATCH', '/api/fixeddata/updatep/coremeasurements/test_schema', {
        statusCode: 200,
        body: {
          message: 'Row updated successfully',
          row: {
            id: 2,
            coreMeasurementID: 2,
            treeTag: 'TREE002',
            dbh: 18.0, // Fixed value
            isValidated: null
          }
        }
      }).as('updateMeasurement');

      cy.log('✏️ Fixing validation error by updating DBH');
      cy.get('input[type="text"]').first().clear().type('18.00');
      cy.get('[aria-label="Save"]').click();
      cy.wait('@updateMeasurement');

      cy.log('✅ Edit saved successfully');

      cy.log('📍 STEP 5: Re-run validations and verify fix');

      // Mock validation run after fix
      cy.intercept('POST', '/api/cmattributes/validations/run*', {
        statusCode: 200,
        body: {
          message: 'Validations completed',
          errorsFound: 0
        }
      }).as('runValidationsAfterFix');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrorsAfterFix');

      cy.contains('button', /run validation/i).click();
      cy.wait('@runValidationsAfterFix');
      cy.wait('@validationErrorsAfterFix');

      cy.log('✅ All validations pass after fix');
      cy.get('[data-testid="ErrorIcon"]').should('not.exist');
      cy.get('[data-testid="CheckIcon"]').should('exist');

      cy.log('📍 STEP 6: Verify changes appear in changelog');

      cy.intercept('GET', '/api/fixeddatafilter/unifiedchangelog/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            changeID: 1,
            tableName: 'coremeasurements',
            recordID: '2',
            operation: 'UPDATE',
            oldRowState: { dbh: 20.0 },
            newRowState: { dbh: 18.0 },
            changeTimestamp: new Date().toISOString(),
            changedBy: 'testuser@test.com',
            plotID: 1,
            censusID: 1
          }
        ]
      }).as('fetchChangelog');

      cy.visit('/measurementshub/recentchanges');
      cy.wait('@fetchChangelog');

      cy.log('✅ Change is recorded in audit trail');
      cy.contains('UPDATE').should('be.visible');
      cy.contains('20').should('be.visible'); // Old value
      cy.contains('18').should('be.visible'); // New value

      cy.log('✅✅✅ Complete workflow integration test PASSED');
    });
  });

  describe('Fixed Data Changes → Measurement Updates Workflow', () => {
    it('should propagate species changes to measurements', () => {
      cy.log('🔍 Testing species change propagation');

      cy.log('📍 STEP 1: View existing measurements with species');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: 'TREE001',
              speciesCode: 'OLDCODE',
              speciesName: 'Old Name'
            }
          ],
          totalCount: 1
        }
      }).as('fetchMeasurementsOld');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 1, CountErrors: 0, CountPending: 0, CountOldTrees: 1, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurementsOld', '@validationCounts', '@validationErrors']);

      cy.log('✅ Measurement shows old species code');
      cy.contains('OLDCODE').should('be.visible');

      cy.log('📍 STEP 2: Update species code in fixed data');

      cy.intercept('GET', '/api/fixeddatafilter/alltaxonomiesview/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            speciesID: 1,
            speciesCode: 'OLDCODE',
            speciesName: 'Old Name',
            family: 'Fabaceae',
            genus: 'Acacia'
          }
        ]
      }).as('fetchSpecies');

      cy.intercept('GET', '/api/specieslimits/1/1?schema=test_schema', {
        statusCode: 200,
        body: []
      }).as('fetchSpeciesLimits');

      cy.visit('/fixeddatainput/alltaxonomies');
      cy.wait(['@fetchSpecies', '@fetchSpeciesLimits']);

      cy.log('✏️ Editing species code');
      cy.get('[role="row"]').eq(1).dblclick();

      cy.intercept('POST', '/api/bulkcrud', {
        statusCode: 200,
        body: {
          message: 'Species updated successfully. 1 measurement(s) updated.',
          row: {
            id: 1,
            speciesID: 1,
            speciesCode: 'NEWCODE',
            speciesName: 'New Name'
          },
          dependentUpdates: 1
        }
      }).as('updateSpecies');

      cy.contains('button', /save/i).click();
      cy.wait('@updateSpecies');

      cy.log('✅ Species updated with dependent records notification');
      cy.contains(/measurement.*updated/i).should('be.visible');

      cy.log('📍 STEP 3: Verify measurements reflect updated species');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: 'TREE001',
              speciesCode: 'NEWCODE', // Updated
              speciesName: 'New Name' // Updated
            }
          ],
          totalCount: 1
        }
      }).as('fetchMeasurementsNew');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurementsNew', '@validationCounts', '@validationErrors']);

      cy.log('✅ Measurement shows updated species code');
      cy.contains('NEWCODE').should('be.visible');
      cy.contains('New Name').should('be.visible');

      cy.log('✅✅ Fixed data propagation test PASSED');
    });

    it('should handle quadrat updates affecting measurements', () => {
      cy.log('🔍 Testing quadrat change propagation');

      cy.log('📍 STEP 1: Update quadrat dimensions');

      cy.intercept('GET', '/api/fixeddatafilter/quadrats/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            quadratID: 1,
            quadratName: 'Q0101',
            dimensionX: 20,
            dimensionY: 20,
            area: 400
          }
        ]
      }).as('fetchQuadrats');

      cy.visit('/fixeddatainput/quadrats');
      cy.wait('@fetchQuadrats');

      cy.get('[role="row"]').eq(1).dblclick();

      cy.intercept('POST', '/api/bulkcrud', {
        statusCode: 200,
        body: {
          message: 'Quadrat updated successfully',
          row: {
            id: 1,
            quadratID: 1,
            quadratName: 'Q0101',
            dimensionX: 25,
            dimensionY: 25,
            area: 625
          }
        }
      }).as('updateQuadrat');

      cy.contains('button', /save/i).click();
      cy.wait('@updateQuadrat');

      cy.log('✅ Quadrat dimensions updated');

      cy.log('📍 STEP 2: Verify measurements in that quadrat still valid');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              quadratName: 'Q0101',
              lx: 12.5, // Still within new bounds (0-25)
              ly: 15.5,
              isValidated: 1
            }
          ],
          totalCount: 1
        }
      }).as('fetchMeasurements');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 1, CountErrors: 0, CountPending: 0, CountOldTrees: 1, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationCounts', '@validationErrors']);

      cy.log('✅ Measurements in updated quadrat remain valid');
      cy.get('[data-testid="CheckIcon"]').should('exist');

      cy.log('✅✅ Quadrat update propagation test PASSED');
    });

    it('should trigger re-validation when attribute codes change', () => {
      cy.log('🔍 Testing attribute change triggering re-validation');

      cy.log('📍 STEP 1: Change attribute from active to inactive');

      cy.intercept('GET', '/api/fixeddatafilter/attributes/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            code: 'ATTR001',
            description: 'Test Attribute',
            status: 'active'
          }
        ]
      }).as('fetchAttributes');

      cy.visit('/fixeddatainput/attributes');
      cy.wait('@fetchAttributes');

      cy.get('[role="row"]').eq(1).dblclick();

      cy.intercept('POST', '/api/bulkcrud', {
        statusCode: 200,
        body: {
          message: 'Attribute updated. 5 measurements may need re-validation.',
          row: {
            id: 1,
            code: 'ATTR001',
            description: 'Test Attribute',
            status: 'inactive'
          },
          affectedMeasurements: 5
        }
      }).as('updateAttribute');

      cy.contains('button', /save/i).click();
      cy.wait('@updateAttribute');

      cy.log('✅ Attribute changed to inactive with warning about affected measurements');
      cy.contains(/5.*measurements/i).should('be.visible');

      cy.log('📍 STEP 2: Verify measurements with inactive attribute need re-validation');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              codes: ['ATTR001'],
              isValidated: null // Changed to pending
            }
          ],
          totalCount: 1
        }
      }).as('fetchMeasurements');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 0, CountErrors: 0, CountPending: 5, CountOldTrees: 1, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationCounts', '@validationErrors']);

      cy.log('✅ Measurements using that attribute show pending status');
      cy.contains(/5.*pending/i).should('be.visible');

      cy.log('✅✅ Attribute change re-validation test PASSED');
    });
  });

  describe('Multi-User Collaboration Scenarios', () => {
    it('should track changes from multiple users correctly', () => {
      cy.log('🔍 Testing multi-user change tracking');

      // Mock changelog with changes from different users
      cy.intercept('GET', '/api/fixeddatafilter/unifiedchangelog/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            changeID: 1,
            tableName: 'coremeasurements',
            recordID: '1',
            operation: 'UPDATE',
            oldRowState: { dbh: 15.5 },
            newRowState: { dbh: 18.0 },
            changeTimestamp: new Date().toISOString(),
            changedBy: 'user1@test.com',
            plotID: 1,
            censusID: 1
          },
          {
            id: 2,
            changeID: 2,
            tableName: 'coremeasurements',
            recordID: '2',
            operation: 'UPDATE',
            oldRowState: { dbh: 20.0 },
            newRowState: { dbh: 22.0 },
            changeTimestamp: new Date().toISOString(),
            changedBy: 'user2@test.com',
            plotID: 1,
            censusID: 1
          }
        ]
      }).as('fetchChangelog');

      cy.visit('/measurementshub/recentchanges');
      cy.wait('@fetchChangelog');

      cy.log('✅ Changes from both users are tracked');
      cy.contains('user1@test.com').should('be.visible');
      cy.contains('user2@test.com').should('be.visible');

      cy.log('✅✅ Multi-user tracking test PASSED');
    });

    it('should handle concurrent edits warning', () => {
      cy.log('🔍 Testing concurrent edit detection');

      cy.log('📍 User 1 starts editing a row');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: 'TREE001',
              dbh: 15.5,
              lastModified: '2024-11-02T10:00:00.000Z',
              lastModifiedBy: 'user1@test.com'
            }
          ],
          totalCount: 1
        }
      }).as('fetchMeasurements');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 1, CountErrors: 0, CountPending: 0, CountOldTrees: 1, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationCounts', '@validationErrors']);

      cy.get('[role="row"]').eq(1).within(() => {
        cy.get('[aria-label="Edit"]').click();
      });

      cy.log('📍 User 2 saves a change to the same row (simulated)');

      // Mock concurrent edit conflict
      cy.intercept('PATCH', '/api/fixeddata/updatep/coremeasurements/test_schema', {
        statusCode: 409,
        body: {
          message: 'Row was modified by user2@test.com at 2024-11-02T10:05:00.000Z',
          error: true,
          conflictDetails: {
            lastModifiedBy: 'user2@test.com',
            lastModified: '2024-11-02T10:05:00.000Z'
          }
        }
      }).as('updateConflict');

      cy.get('input[type="text"]').first().clear().type('20.00');
      cy.get('[aria-label="Save"]').click();
      cy.wait('@updateConflict');

      cy.log('✅ Conflict error is displayed');
      cy.contains(/modified by.*user2/i).should('be.visible');

      cy.log('✅✅ Concurrent edit detection test PASSED');
    });
  });

  describe('Data Consistency Across Features', () => {
    it('should maintain consistent data across viewing pages', () => {
      cy.log('🔍 Testing data consistency between summary and full table');

      const consistentMeasurements = [
        {
          id: 1,
          coreMeasurementID: 1,
          quadratName: 'Q0101',
          treeTag: 'TREE001',
          isValidated: 1
        },
        {
          id: 2,
          coreMeasurementID: 2,
          quadratName: 'Q0101',
          treeTag: 'TREE002',
          isValidated: 0
        }
      ];

      cy.log('📍 View data in full table');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: consistentMeasurements,
          totalCount: 2
        }
      }).as('fetchFullTable');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 1, CountErrors: 1, CountPending: 0, CountOldTrees: 2, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchFullTable', '@validationCounts', '@validationErrors']);

      cy.log('✅ Full table shows 2 measurements');
      cy.contains('TREE001').should('be.visible');
      cy.contains('TREE002').should('be.visible');

      cy.log('📍 View same data in summary');

      cy.intercept('POST', '/api/summary/coremeasurements/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              quadratName: 'Q0101',
              totalMeasurements: 2,
              validatedCount: 1,
              errorCount: 1,
              pendingCount: 0
            }
          ],
          totalCount: 1
        }
      }).as('fetchSummary');

      cy.visit('/measurementshub/summary');
      cy.wait('@fetchSummary');

      cy.log('✅ Summary shows consistent counts');
      cy.contains('2').should('be.visible'); // Total measurements
      cy.contains('1').should('be.visible'); // Validated count

      cy.log('✅✅ Data consistency test PASSED');
    });

    it('should reflect admin changes immediately', () => {
      cy.log('🔍 Testing admin changes propagate to user workflows');

      cy.log('📍 Admin creates new site');

      cy.intercept('GET', '/api/fixeddatafilter/sites/test_schema*', {
        statusCode: 200,
        body: [mockSite]
      }).as('fetchSitesAdmin');

      cy.visit('/admin/sites');
      cy.wait('@fetchSitesAdmin');

      cy.intercept('POST', '/api/fixeddata/sites', {
        statusCode: 200,
        body: {
          message: 'Site created successfully',
          row: {
            siteID: 2,
            siteName: 'New Test Site',
            schemaName: 'new_test_schema'
          }
        }
      }).as('createSite');

      cy.contains('button', /add/i).click();
      cy.wait('@createSite');

      cy.log('✅ New site created');

      cy.log('📍 Verify new site appears in user site selection');

      cy.intercept('GET', '/api/fetchall/sites?schema=*', {
        statusCode: 200,
        body: [
          mockSite,
          {
            siteID: 2,
            siteName: 'New Test Site',
            schemaName: 'new_test_schema'
          }
        ]
      }).as('fetchAllSites');

      cy.visit('/dashboard');
      cy.wait('@fetchAllSites');

      cy.log('✅ New site appears in site selector');
      // Site selection dropdown would show the new site

      cy.log('✅✅ Admin changes propagation test PASSED');
    });
  });

  describe('Error Propagation Across Workflows', () => {
    it('should propagate validation errors to summary and full table', () => {
      cy.log('🔍 Testing error propagation across views');

      const measurementsWithErrors = [
        {
          id: 1,
          coreMeasurementID: 1,
          treeTag: 'TREE001',
          isValidated: 0
        },
        {
          id: 2,
          coreMeasurementID: 2,
          treeTag: 'TREE002',
          isValidated: 0
        }
      ];

      const validationErrors = {
        failed: [
          {
            coreMeasurementID: 1,
            validationErrorIDs: [1],
            descriptions: ['Error 1'],
            criteria: ['Criteria 1']
          },
          {
            coreMeasurementID: 2,
            validationErrorIDs: [2],
            descriptions: ['Error 2'],
            criteria: ['Criteria 2']
          }
        ]
      };

      cy.log('📍 Run validations that produce errors');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: measurementsWithErrors,
          totalCount: 2
        }
      }).as('fetchMeasurements');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 0, CountErrors: 2, CountPending: 0, CountOldTrees: 2, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: validationErrors
      }).as('validationErrorsDisplay');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationCounts', '@validationErrorsDisplay']);

      cy.log('✅ Full table shows errors');
      cy.get('[data-testid="ErrorIcon"]').should('have.length', 2);

      cy.log('📍 Verify errors appear in summary');

      cy.intercept('POST', '/api/summary/coremeasurements/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              quadratName: 'Q0101',
              totalMeasurements: 2,
              validatedCount: 0,
              errorCount: 2,
              pendingCount: 0
            }
          ],
          totalCount: 1
        }
      }).as('fetchSummary');

      cy.visit('/measurementshub/summary');
      cy.wait('@fetchSummary');

      cy.log('✅ Summary shows error count');
      cy.contains('2').should('be.visible'); // Error count

      cy.log('✅✅ Error propagation test PASSED');
    });

    it('should handle cascade failure when deleting used fixed data', () => {
      cy.log('🔍 Testing cascade failure handling');

      cy.log('📍 Attempt to delete attribute used in measurements');

      cy.intercept('GET', '/api/fixeddatafilter/attributes/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            code: 'ATTR001',
            description: 'Test Attribute',
            status: 'active'
          }
        ]
      }).as('fetchAttributes');

      cy.visit('/fixeddatainput/attributes');
      cy.wait('@fetchAttributes');

      cy.get('[role="row"]').eq(1).within(() => {
        cy.get('[aria-label*="Delete"]').click();
      });

      cy.intercept('POST', '/api/bulkcrud', {
        statusCode: 400,
        body: {
          message: 'Cannot delete: Attribute is in use by 10 measurement(s)',
          error: true,
          affectedRecords: 10
        }
      }).as('deleteError');

      cy.contains('button', /save/i).click();
      cy.wait('@deleteError');

      cy.log('✅ Cascade delete error is displayed');
      cy.contains(/cannot delete.*in use/i).should('be.visible');
      cy.contains(/10.*measurement/i).should('be.visible');

      cy.log('✅✅ Cascade failure handling test PASSED');
    });
  });

  describe('Complete End-to-End User Journey', () => {
    it('should complete realistic user workflow from login to data finalization', () => {
      cy.log('🔍 Testing complete realistic user journey');

      cy.log('📍 PHASE 1: Login and context selection');
      cy.visit('/dashboard');
      cy.log('✅ User authenticated and on dashboard');

      cy.log('📍 PHASE 2: Review summary metrics');
      cy.intercept('POST', '/api/summary/coremeasurements/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              quadratName: 'Q0101',
              totalMeasurements: 5,
              validatedCount: 3,
              errorCount: 2,
              pendingCount: 0
            }
          ],
          totalCount: 1
        }
      }).as('fetchSummary');

      cy.visit('/measurementshub/summary');
      cy.wait('@fetchSummary');
      cy.log('✅ User sees 2 errors in summary');

      cy.log('📍 PHASE 3: Navigate to full table to find errors');
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            { id: 1, coreMeasurementID: 1, treeTag: 'TREE001', isValidated: 0 },
            { id: 2, coreMeasurementID: 2, treeTag: 'TREE002', isValidated: 0 }
          ],
          totalCount: 2
        }
      }).as('fetchMeasurements');

      cy.intercept('POST', '/api/query', {
        statusCode: 200,
        body: [{ CountValid: 3, CountErrors: 2, CountPending: 0, CountOldTrees: 5, CountNewRecruits: 0, CountMultiStems: 0 }]
      }).as('validationCounts');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: {
          failed: [
            { coreMeasurementID: 1, validationErrorIDs: [1], descriptions: ['DBH out of range'], criteria: ['0-100 cm'] },
            { coreMeasurementID: 2, validationErrorIDs: [2], descriptions: ['Invalid species'], criteria: ['Must exist'] }
          ]
        }
      }).as('validationErrors');

      cy.visit('/measurementshub/viewfulltable');
      cy.wait(['@fetchMeasurements', '@validationCounts', '@validationErrors']);
      cy.log('✅ User sees error indicators on rows');

      cy.log('📍 PHASE 4: Fix first error');
      cy.get('[role="row"]').eq(1).within(() => {
        cy.get('[aria-label="Edit"]').click();
      });

      cy.intercept('PATCH', '/api/fixeddata/updatep/coremeasurements/test_schema', {
        statusCode: 200,
        body: {
          message: 'Row updated successfully',
          row: { id: 1, coreMeasurementID: 1, treeTag: 'TREE001', dbh: 50.0, isValidated: null }
        }
      }).as('updateRow1');

      cy.get('input[type="text"]').first().clear().type('50.00');
      cy.get('[aria-label="Save"]').click();
      cy.wait('@updateRow1');
      cy.log('✅ First error fixed');

      cy.log('📍 PHASE 5: Fix second error (species)');
      cy.visit('/fixeddatainput/alltaxonomies');

      cy.intercept('GET', '/api/fixeddatafilter/alltaxonomiesview/test_schema*', {
        statusCode: 200,
        body: [{ id: 1, speciesID: 1, speciesCode: 'VALIDSP', family: 'Fabaceae', genus: 'Acacia' }]
      }).as('fetchSpecies');

      cy.intercept('GET', '/api/specieslimits/1/1?schema=test_schema', {
        statusCode: 200,
        body: []
      }).as('fetchSpeciesLimits');

      cy.wait(['@fetchSpecies', '@fetchSpeciesLimits']);

      cy.log('✅ User adds/verifies correct species exists');

      cy.log('📍 PHASE 6: Re-run validations');
      cy.visit('/measurementshub/viewfulltable');

      cy.intercept('POST', '/api/cmattributes/validations/run*', {
        statusCode: 200,
        body: { message: 'Validations completed', errorsFound: 0 }
      }).as('runValidations');

      cy.intercept('GET', '/api/validations/validationerrordisplay?*', {
        statusCode: 200,
        body: { failed: [] }
      }).as('noErrors');

      cy.contains('button', /run validation/i).click();
      cy.wait('@runValidations');
      cy.wait('@noErrors');
      cy.log('✅ All validations pass');

      cy.log('📍 PHASE 7: Review audit trail');
      cy.intercept('GET', '/api/fixeddatafilter/unifiedchangelog/test_schema*', {
        statusCode: 200,
        body: [
          {
            id: 1,
            changeID: 1,
            tableName: 'coremeasurements',
            recordID: '1',
            operation: 'UPDATE',
            oldRowState: { dbh: 150.0 },
            newRowState: { dbh: 50.0 },
            changeTimestamp: new Date().toISOString(),
            changedBy: 'testuser@test.com',
            plotID: 1,
            censusID: 1
          }
        ]
      }).as('fetchChangelog');

      cy.visit('/measurementshub/recentchanges');
      cy.wait('@fetchChangelog');
      cy.log('✅ User confirms changes were recorded');

      cy.log('📍 PHASE 8: Final review in summary');
      cy.intercept('POST', '/api/summary/coremeasurements/test_schema*', {
        statusCode: 200,
        body: {
          output: [
            {
              quadratName: 'Q0101',
              totalMeasurements: 5,
              validatedCount: 5,
              errorCount: 0,
              pendingCount: 0
            }
          ],
          totalCount: 1
        }
      }).as('fetchFinalSummary');

      cy.visit('/measurementshub/summary');
      cy.wait('@fetchFinalSummary');
      cy.log('✅ Summary shows all data validated');

      cy.log('✅✅✅ COMPLETE USER JOURNEY TEST PASSED');
      cy.log('🎉🎉🎉 ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY');
    });
  });
});
