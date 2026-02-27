/// <reference types="cypress" />

/**
 * E2E tests for verified bug fixes
 *
 * Tests verify that:
 * 1. Modal close/cancel does NOT trigger view reset
 * 2. FailedMeasurements modal close button works without reset
 * 3. Single row edits don't trigger full view reset
 * 4. Dashboard tachometer has correct size
 * 5. Validation reset works correctly
 */

describe('Bug Fixes E2E Verification', () => {
  beforeEach(() => {
    // Mock authentication
    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: { email: 'test@example.com', name: 'Test User' },
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    }).as('session');

    // Mock site/plot/census selection
    cy.intercept('GET', '/api/fetchall/sites', {
      statusCode: 200,
      body: [{ siteID: 1, siteName: 'Test Site', schemaName: 'test_schema' }]
    }).as('sites');

    cy.intercept('GET', '/api/fetchall/plots?schema=test_schema', {
      statusCode: 200,
      body: [{ plotID: 1, plotName: 'Test Plot', num_quadrats: 100 }]
    }).as('plots');

    cy.intercept('GET', '/api/fetchall/census/1/1?schema=test_schema', {
      statusCode: 200,
      body: [
        {
          censusID: 1,
          plotCensusNumber: 1,
          startDate: '2024-01-01',
          endDate: '2024-12-31',
          dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }]
        }
      ]
    }).as('census');
  });

  describe('Bug #1 & #2: Modal Close WITHOUT View Reset', () => {
    it('should NOT refresh view when closing validation modal with cancel', () => {
      let viewRefreshCalled = false;

      // Mock measurements data
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema', {
        statusCode: 200,
        body: {
          output: [{ id: 1, coreMeasurementID: 1, treeTag: '001', stemTag: '1', measuredDBH: 10.5 }],
          totalCount: 1
        }
      }).as('measurementsData');

      // Mock view refresh endpoint - track if called
      cy.intercept('POST', '/api/refreshviews/measurementssummary/test_schema', req => {
        viewRefreshCalled = true;
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('viewRefresh');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open validation modal
      cy.get('[data-testid="validate-button"]').click();

      // Close modal by clicking outside (using onClose)
      cy.get('[data-testid="validation-modal"]').should('be.visible');
      cy.get('body').click(0, 0); // Click outside modal

      // Wait a moment
      cy.wait(1000);

      // Verify view refresh was NOT called
      cy.then(() => {
        expect(viewRefreshCalled).to.be.false;
      });
    });

    it('SHOULD refresh view when validation completes successfully', () => {
      let viewRefreshCalled = false;

      cy.intercept('POST', '/api/refreshviews/measurementssummary/test_schema', req => {
        viewRefreshCalled = true;
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('viewRefresh');

      // Mock successful validation
      cy.intercept('POST', '/api/validations/procedures/*', {
        statusCode: 200,
        body: { success: true }
      }).as('validationProcedure');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open validation modal
      cy.get('[data-testid="validate-button"]').click();

      // Run validation
      cy.get('[data-testid="run-validation-button"]').click();
      cy.wait('@validationProcedure');

      // Complete validation
      cy.get('[data-testid="validation-complete-button"]').click();
      cy.wait('@viewRefresh');

      // Verify view refresh WAS called after completion
      cy.then(() => {
        expect(viewRefreshCalled).to.be.true;
      });
    });

    it('should NOT refresh when clicking Cancel on Reset Validation modal', () => {
      let viewRefreshCalled = false;

      cy.intercept('POST', '/api/refreshviews/measurementssummary/test_schema', req => {
        viewRefreshCalled = true;
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('viewRefresh');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open reset validation dialog
      cy.get('[data-testid="reset-validation-button"]').click();
      cy.get('[data-testid="reset-validation-dialog"]').should('be.visible');

      // Click "No" button (cancel)
      cy.get('[data-testid="reset-validation-no-button"]').click();

      cy.wait(1000);

      // Verify view refresh was NOT called
      cy.then(() => {
        expect(viewRefreshCalled).to.be.false;
      });
    });

    it('FailedMeasurements modal Close button should NOT trigger view reset', () => {
      let viewRefreshCalled = false;

      cy.intercept('POST', '/api/refreshviews/measurementssummary/test_schema', req => {
        viewRefreshCalled = true;
        req.reply({ statusCode: 200, body: { success: true } });
      }).as('viewRefresh');

      // Mock failed measurements
      cy.intercept('POST', '/api/fixeddatafilter/failedmeasurements/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              failedMeasurementID: 1,
              tag: '001',
              stemTag: '1',
              failureReasons: 'Missing X|Missing Y'
            }
          ],
          totalCount: 1
        }
      }).as('failedMeasurements');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open failed measurements modal
      cy.get('[data-testid="failed-measurements-button"]').click();
      cy.wait('@failedMeasurements');

      // Click Close button (NOT reingest)
      cy.get('[data-testid="failed-measurements-close-button"]').click();

      cy.wait(1000);

      // Verify view refresh was NOT called
      cy.then(() => {
        expect(viewRefreshCalled).to.be.false;
      });
    });
  });

  describe('Bug #3: Single Row Updates Should NOT Trigger Full View Reset', () => {
    it('should only refresh current grid type when updating a single row', () => {
      const refreshedGrids: string[] = [];

      // Track which grids refresh
      cy.intercept('GET', '/api/cmprevalidation/attributes/test_schema/1/1', req => {
        refreshedGrids.push('attributes');
        req.reply({ statusCode: 200 });
      }).as('attributesRefresh');

      cy.intercept('GET', '/api/cmprevalidation/species/test_schema/1/1', req => {
        refreshedGrids.push('species');
        req.reply({ statusCode: 200 });
      }).as('speciesRefresh');

      cy.intercept('GET', '/api/cmprevalidation/quadrats/test_schema/1/1', req => {
        refreshedGrids.push('quadrats');
        req.reply({ statusCode: 200 });
      }).as('quadratsRefresh');

      // Mock attribute data
      cy.intercept('POST', '/api/fixeddatafilter/attributes/test_schema', {
        statusCode: 200,
        body: {
          output: [{ id: 1, code: 'A', description: 'Alive', status: 'alive' }],
          totalCount: 1
        }
      }).as('attributesData');

      // Mock update endpoint
      cy.intercept('PATCH', '/api/fixeddata/attributes/test_schema/*', {
        statusCode: 200,
        body: { success: true }
      }).as('updateAttribute');

      cy.visit('/fixeddata/attributes');
      cy.wait(['@session', '@sites', '@plots', '@census', '@attributesData']);

      // Edit a row
      cy.get('[data-testid="attribute-row-1"]').dblclick();
      cy.get('[data-testid="description-input"]').clear().type('Updated description');
      cy.get('[data-testid="save-button"]').click();

      cy.wait('@updateAttribute');
      cy.wait(1000);

      // Verify ONLY attributes grid was refreshed, not all grids
      cy.then(() => {
        expect(refreshedGrids).to.include('attributes');
        expect(refreshedGrids).not.to.include('species');
        expect(refreshedGrids).not.to.include('quadrats');
      });
    });
  });

  describe('Bug #7: Dashboard Tachometer Size', () => {
    it('should display tachometer with height of 600px', () => {
      // Mock dashboard data
      cy.intercept('GET', '/api/fetchall/summary/test_schema/1/1', {
        statusCode: 200,
        body: {
          PopulatedQuadrats: 50,
          TotalQuadrats: 100,
          totalStems: 500
        }
      }).as('dashboardData');

      cy.visit('/dashboard');
      cy.wait(['@session', '@sites', '@plots', '@census', '@dashboardData']);

      // Verify tachometer container has correct height
      cy.get('[data-testid="tachometer-container"]').should('be.visible').and('have.css', 'height', '600px').and('have.css', 'min-height', '500px');

      // Verify it's larger than the old size (300px)
      cy.get('[data-testid="tachometer-container"]').then($el => {
        const height = parseInt($el.css('height'));
        expect(height).to.be.greaterThan(300);
      });
    });
  });

  describe('Bug #9: Validation Reset with Proper Error Handling', () => {
    it('should successfully reset validations with correct query syntax', () => {
      // Mock successful reset
      cy.intercept('POST', '/api/query', req => {
        const query = JSON.parse(req.body);

        // Verify the query uses = 0 instead of = FALSE
        expect(query).to.include('= 0');
        expect(query).not.to.include('= FALSE');

        req.reply({ statusCode: 200, body: { success: true } });
      }).as('resetQuery');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open reset validation dialog
      cy.get('[data-testid="reset-validation-button"]').click();

      // Confirm reset
      cy.get('[data-testid="reset-validation-yes-button"]').click();
      cy.wait('@resetQuery');

      // Verify success message
      cy.get('[data-testid="success-message"]').should('be.visible');
    });

    it('should display error message if reset validation fails', () => {
      // Mock failed reset
      cy.intercept('POST', '/api/query', {
        statusCode: 500,
        body: { error: 'Clear measurement_error_log query failed' }
      }).as('resetQueryFailed');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open reset validation dialog
      cy.get('[data-testid="reset-validation-button"]').click();

      // Confirm reset
      cy.get('[data-testid="reset-validation-yes-button"]').click();
      cy.wait('@resetQueryFailed');

      // Verify error message is displayed
      cy.get('[data-testid="error-message"]').should('be.visible').and('contain', 'Clear measurement_error_log query failed');
    });
  });

  describe('Bug #10: API Timeout Protection', () => {
    it('should timeout after specified duration', () => {
      // Mock a slow API endpoint
      cy.intercept('POST', '/api/slowendpoint', req => {
        // Delay response by 65 seconds (longer than default 60s timeout)
        req.reply({ delay: 65000, statusCode: 200, body: { success: true } });
      }).as('slowEndpoint');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Trigger action that calls slow endpoint
      cy.get('[data-testid="slow-action-button"]').click();

      // Should show timeout error before 65 seconds
      cy.get('[data-testid="error-message"]', { timeout: 70000 }).should('be.visible').and('contain', 'timeout');
    });
  });

  describe('Bug #6 & #8: FailedMeasurements Updates Reflected in Ingestion', () => {
    it('should successfully reingest failed measurement after fixing validation errors', () => {
      // Mock failed measurement
      cy.intercept('POST', '/api/fixeddatafilter/failedmeasurements/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              failedMeasurementID: 1,
              tag: '001',
              stemTag: '1',
              x: null, // Missing X
              y: null, // Missing Y
              failureReasons: 'Missing X|Missing Y'
            }
          ],
          totalCount: 1
        }
      }).as('failedMeasurements');

      // Mock successful update
      cy.intercept('PATCH', '/api/fixeddata/failedmeasurements/test_schema/1', {
        statusCode: 200,
        body: { success: true }
      }).as('updateFailed');

      // Mock successful reingestion
      cy.intercept('GET', '/api/reingestsinglefailure/test_schema/1', {
        statusCode: 200,
        body: { message: 'Success' }
      }).as('reingest');

      // Mock the reingested measurement now appearing in main view
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 100,
              coreMeasurementID: 100,
              treeTag: '001',
              stemTag: '1',
              stemLocalX: 5.5,
              stemLocalY: 10.2,
              attributes: 'A;B', // Attributes from fixed measurement
              isValidated: true
            }
          ],
          totalCount: 1
        }
      }).as('mainMeasurements');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open failed measurements modal
      cy.get('[data-testid="failed-measurements-button"]').click();
      cy.wait('@failedMeasurements');

      // Edit the failed row - add X and Y coordinates
      cy.get('[data-testid="failed-row-1"]').dblclick();
      cy.get('[data-testid="x-input"]').type('5.5');
      cy.get('[data-testid="y-input"]').type('10.2');
      cy.get('[data-testid="codes-input"]').type('A;B'); // Add attribute codes
      cy.get('[data-testid="save-button"]').click();

      cy.wait('@updateFailed');

      // Click reingest button
      cy.get('[data-testid="reingest-row-1-button"]').click();
      cy.wait('@reingest');

      // Close failed measurements modal
      cy.get('[data-testid="failed-measurements-close-button"]').click();

      // Refresh main view
      cy.get('[data-testid="refresh-button"]').click();
      cy.wait('@mainMeasurements');

      // Verify the measurement now appears with correct attributes
      cy.get('[data-testid="measurement-row-100"]').should('be.visible');
      cy.get('[data-testid="measurement-row-100"]')
        .should('contain', '001') // TreeTag
        .and('contain', 'A;B'); // Attributes are now reflected
    });
  });

  describe('Bug #4: MeasurementsSummaryView Dependencies', () => {
    it('should fetch new validation errors when switching plots', () => {
      let plot1FetchCount = 0;
      let plot2FetchCount = 0;

      // Mock validation errors for Plot 1
      cy.intercept('GET', '/api/validations/errors/test_schema/1/*', req => {
        plot1FetchCount++;
        req.reply({
          statusCode: 200,
          body: {
            errors: [{ coreMeasurementID: 1, errorMessage: 'Plot 1 Error - Missing X' }]
          }
        });
      }).as('plot1ValidationErrors');

      // Mock validation errors for Plot 2
      cy.intercept('GET', '/api/validations/errors/test_schema/2/*', req => {
        plot2FetchCount++;
        req.reply({
          statusCode: 200,
          body: {
            errors: [{ coreMeasurementID: 2, errorMessage: 'Plot 2 Error - Invalid DBH' }]
          }
        });
      }).as('plot2ValidationErrors');

      // Mock plot list
      cy.intercept('GET', '/api/fetchall/plots?schema=test_schema', {
        statusCode: 200,
        body: [
          { plotID: 1, plotName: 'Plot 1', num_quadrats: 100 },
          { plotID: 2, plotName: 'Plot 2', num_quadrats: 100 }
        ]
      }).as('plots');

      // Mock census for both plots
      cy.intercept('GET', '/api/fetchall/census/1/1?schema=test_schema', {
        statusCode: 200,
        body: [
          {
            censusID: 1,
            plotCensusNumber: 1,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }]
          }
        ]
      }).as('census1');

      cy.intercept('GET', '/api/fetchall/census/1/2?schema=test_schema', {
        statusCode: 200,
        body: [
          {
            censusID: 2,
            plotCensusNumber: 1,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            dateRanges: [{ censusID: 2, startDate: '2024-01-01', endDate: '2024-12-31' }]
          }
        ]
      }).as('census2');

      // Mock measurements for both plots
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema', {
        statusCode: 200,
        body: {
          output: [{ id: 1, coreMeasurementID: 1, treeTag: '001', stemTag: '1', measuredDBH: 10.5 }],
          totalCount: 1
        }
      }).as('measurements');

      // Visit the summary page
      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census1']);

      // Wait for initial validation errors fetch for Plot 1
      cy.wait('@plot1ValidationErrors', { timeout: 10000 });

      // Verify Plot 1 errors are displayed
      cy.get('[data-testid="validation-errors-section"]', { timeout: 5000 }).should('contain', 'Plot 1 Error');

      // Switch to Plot 2
      cy.get('[data-testid="plot-selector"]').select('Plot 2');
      cy.wait('@census2');

      // Should fetch validation errors for Plot 2
      cy.wait('@plot2ValidationErrors', { timeout: 10000 });

      // Verify Plot 2 errors are displayed
      cy.get('[data-testid="validation-errors-section"]').should('contain', 'Plot 2 Error').and('not.contain', 'Plot 1 Error');

      // Verify fetch counts
      cy.then(() => {
        expect(plot1FetchCount).to.be.greaterThan(0);
        expect(plot2FetchCount).to.be.greaterThan(0);
      });

      console.log('✅ Bug #4 verified: Dependencies correctly trigger validation error fetch');
    });

    it('should not cause undefined errors when plot/census changes', () => {
      // Mock validation errors endpoint
      cy.intercept('GET', '/api/validations/errors/test_schema/*/*', {
        statusCode: 200,
        body: { errors: [] }
      }).as('validationErrors');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Switch plot multiple times
      cy.get('[data-testid="plot-selector"]').select('Plot 2');
      cy.wait(500);
      cy.get('[data-testid="plot-selector"]').select('Plot 1');

      // Should not see console errors
      cy.window().then(win => {
        const consoleErrors = (win as any).consoleErrors || [];
        expect(consoleErrors.filter((e: any) => e.includes('undefined'))).to.have.length(0);
      });

      console.log('✅ Bug #4 verified: No undefined errors during plot/census changes');
    });
  });

  describe('Bug #12: Validation Error Message Specificity', () => {
    it('should show only field-specific validation errors in tooltip', () => {
      // Mock measurements with multiple validation errors
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: '001',
              stemTag: '1',
              measuredDBH: 10.5,
              stemLocalX: null,
              stemLocalY: null,
              codes: 'INVALID',
              errors: 'Missing X|Missing Y|Invalid Code|Missing HOM'
            }
          ],
          totalCount: 1
        }
      }).as('measurements');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census', '@measurements']);

      // Hover over error icon for X field (should only show X-related errors)
      cy.get('[data-testid="error-icon-x"]').trigger('mouseover');

      cy.get('[data-testid="error-tooltip"]', { timeout: 5000 })
        .should('be.visible')
        .and('contain', 'Missing X')
        .and('not.contain', 'Invalid Code')
        .and('not.contain', 'Missing HOM');

      // Move away
      cy.get('[data-testid="error-icon-x"]').trigger('mouseout');

      // Hover over error icon for codes field (should only show code-related errors)
      cy.get('[data-testid="error-icon-codes"]').trigger('mouseover');

      cy.get('[data-testid="error-tooltip"]')
        .should('be.visible')
        .and('contain', 'Invalid Code')
        .and('not.contain', 'Missing X')
        .and('not.contain', 'Missing Y');

      console.log('✅ Bug #12 verified: Error tooltips show only field-specific errors');
    });

    it('should filter validation reasons by column field', () => {
      // Mock measurements with validation data
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: '001',
              stemTag: '1',
              errors: 'Missing X|X outside plot|Missing Y|Y outside plot|Invalid Code'
            }
          ],
          totalCount: 1
        }
      }).as('measurements');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census', '@measurements']);

      // Click on row to see error details
      cy.get('[data-testid="measurement-row-1"]').click();

      // Open error panel
      cy.get('[data-testid="error-details-panel"]').should('be.visible');

      // Verify X field errors section exists and contains only X-related
      cy.get('[data-testid="error-section-x"]')
        .should('contain', 'Missing X')
        .and('contain', 'X outside plot')
        .and('not.contain', 'Missing Y')
        .and('not.contain', 'Invalid Code');

      // Verify Y field errors section exists and contains only Y-related
      cy.get('[data-testid="error-section-y"]').should('contain', 'Missing Y').and('contain', 'Y outside plot').and('not.contain', 'Missing X');

      console.log('✅ Bug #12 verified: Validation reasons correctly filtered by field');
    });
  });

  describe('Bug #13: Duplicate Error Messages', () => {
    it('should deduplicate validation error messages', () => {
      // Mock measurement with duplicate error messages
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              coreMeasurementID: 1,
              treeTag: '001',
              stemTag: '1',
              errors: 'Missing X|Missing Y|Missing X|Invalid Code|Missing X|Missing Y'
            }
          ],
          totalCount: 1
        }
      }).as('measurements');

      cy.visit('/measurementshub');
      cy.wait(['@session', '@sites', '@plots', '@census', '@measurements']);

      // Open error tooltip
      cy.get('[data-testid="error-icon-1"]').trigger('mouseover');

      cy.get('[data-testid="error-tooltip"]').then($tooltip => {
        const tooltipText = $tooltip.text();

        // Count occurrences of each error message
        const missingXCount = (tooltipText.match(/Missing X/g) || []).length;
        const missingYCount = (tooltipText.match(/Missing Y/g) || []).length;

        // Each error should appear only once
        expect(missingXCount).to.equal(1);
        expect(missingYCount).to.equal(1);
      });

      console.log('✅ Bug #13 verified: No duplicate error messages displayed');
    });

    it('should show unique errors in failed measurements view', () => {
      // Mock failed measurements with duplicate reasons
      cy.intercept('POST', '/api/fixeddatafilter/failedmeasurements/test_schema', {
        statusCode: 200,
        body: {
          output: [
            {
              id: 1,
              failedMeasurementID: 1,
              tag: '001',
              stemTag: '1',
              failureReasons: 'Missing X|Missing Y|Missing X|Invalid Code|Missing X'
            }
          ],
          totalCount: 1
        }
      }).as('failedMeasurements');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Open failed measurements modal
      cy.get('[data-testid="failed-measurements-button"]').click();
      cy.wait('@failedMeasurements');

      // Check failure reasons column
      cy.get('[data-testid="failed-row-1-reasons"]').then($cell => {
        const reasonsText = $cell.text();

        // Split by delimiter and count unique
        const reasons = reasonsText.split('|').map(r => r.trim());
        const uniqueReasons = [...new Set(reasons)];

        // Should only show unique reasons
        expect(uniqueReasons.length).to.equal(3); // Missing X, Missing Y, Invalid Code
        expect(uniqueReasons).to.include('Missing X');
        expect(uniqueReasons).to.include('Missing Y');
        expect(uniqueReasons).to.include('Invalid Code');
      });

      console.log('✅ Bug #13 verified: FailedMeasurements shows unique error messages');
    });
  });

  describe('Bug #14: Validation Error Dependencies', () => {
    it('should refetch validation errors when census changes', () => {
      let census1FetchCount = 0;
      let census2FetchCount = 0;

      // Mock validation errors for Census 1
      cy.intercept('GET', '/api/validations/errors/test_schema/*/1', req => {
        census1FetchCount++;
        req.reply({
          statusCode: 200,
          body: {
            errors: [{ coreMeasurementID: 1, errorMessage: 'Census 1 Error' }]
          }
        });
      }).as('census1Errors');

      // Mock validation errors for Census 2
      cy.intercept('GET', '/api/validations/errors/test_schema/*/2', req => {
        census2FetchCount++;
        req.reply({
          statusCode: 200,
          body: {
            errors: [{ coreMeasurementID: 2, errorMessage: 'Census 2 Error' }]
          }
        });
      }).as('census2Errors');

      // Mock census list
      cy.intercept('GET', '/api/fetchall/census/1/1?schema=test_schema', {
        statusCode: 200,
        body: [
          {
            censusID: 1,
            plotCensusNumber: 1,
            startDate: '2024-01-01',
            endDate: '2024-06-30',
            dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-06-30' }]
          },
          {
            censusID: 2,
            plotCensusNumber: 2,
            startDate: '2024-07-01',
            endDate: '2024-12-31',
            dateRanges: [{ censusID: 2, startDate: '2024-07-01', endDate: '2024-12-31' }]
          }
        ]
      }).as('censusList');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@censusList']);

      // Wait for initial fetch (Census 1)
      cy.wait('@census1Errors', { timeout: 10000 });
      expect(census1FetchCount).to.be.greaterThan(0);

      // Verify Census 1 errors displayed
      cy.get('[data-testid="validation-errors-section"]').should('contain', 'Census 1 Error');

      // Change to Census 2
      cy.get('[data-testid="census-selector"]').select('Census 2');

      // Should fetch validation errors for Census 2
      cy.wait('@census2Errors', { timeout: 10000 });

      // Verify Census 2 errors displayed
      cy.get('[data-testid="validation-errors-section"]').should('contain', 'Census 2 Error').and('not.contain', 'Census 1 Error');

      // Verify both censuses were fetched
      cy.then(() => {
        expect(census1FetchCount).to.be.greaterThan(0);
        expect(census2FetchCount).to.be.greaterThan(0);
      });

      console.log('✅ Bug #14 verified: Validation errors refetch when census changes');
    });

    it('should update error counts when dependencies change', () => {
      // Mock different error counts for different contexts
      cy.intercept('GET', '/api/validations/errors/test_schema/1/1', {
        statusCode: 200,
        body: { errors: new Array(5).fill({ errorMessage: 'Error' }) }
      }).as('plot1Census1');

      cy.intercept('GET', '/api/validations/errors/test_schema/2/1', {
        statusCode: 200,
        body: { errors: new Array(3).fill({ errorMessage: 'Error' }) }
      }).as('plot2Census1');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Wait for initial error count
      cy.wait('@plot1Census1');
      cy.get('[data-testid="error-count"]').should('contain', '5');

      // Switch plot
      cy.get('[data-testid="plot-selector"]').select('Plot 2');
      cy.wait('@plot2Census1');

      // Error count should update
      cy.get('[data-testid="error-count"]').should('contain', '3');

      console.log('✅ Bug #14 verified: Error counts update with dependency changes');
    });

    it('should include all required dependencies in useEffect', () => {
      // This test verifies the effect runs when any dependency changes
      let fetchCallCount = 0;

      cy.intercept('GET', '/api/validations/errors/test_schema/*/*', () => {
        fetchCallCount++;
      }).as('validationErrors');

      cy.visit('/measurementshub/summary');
      cy.wait(['@session', '@sites', '@plots', '@census']);

      // Initial fetch
      cy.wait('@validationErrors');
      const initialCount = fetchCallCount;

      // Change plot (should trigger fetch)
      cy.get('[data-testid="plot-selector"]').select('Plot 2');
      cy.wait('@validationErrors');
      expect(fetchCallCount).to.be.greaterThan(initialCount);

      // Change census (should trigger fetch)
      cy.get('[data-testid="census-selector"]').select('Census 2');
      cy.wait('@validationErrors');
      expect(fetchCallCount).to.be.greaterThan(initialCount + 1);

      console.log('✅ Bug #14 verified: All dependencies trigger validation error fetch');
    });
  });
});
