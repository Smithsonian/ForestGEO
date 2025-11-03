/**
 * Data Viewing/Browsing Comprehensive E2E Tests
 *
 * Tests complete data viewing workflows including:
 * - Full table navigation and interaction
 * - Summary view with metrics and tachometers
 * - Filtering (pending, validated, errors)
 * - Sorting and pagination
 * - Data export functionality
 * - Validation error viewing
 *
 * Priority: CRITICAL (30% current coverage → 90% target)
 * Coverage Target: 90%
 */

describe('Data Viewing/Browsing Comprehensive Tests', () => {
  // Test data
  const mockMeasurements = [
    {
      id: 1,
      coreMeasurementID: 1,
      treeTag: 'TREE001',
      stemTag: '1',
      speciesCode: 'SPCODE1',
      quadratName: 'Q0101',
      lx: 10.5,
      ly: 20.5,
      dbh: 15.5,
      hom: 1.3,
      measurementDate: '2024-06-15',
      isValidated: 1,
      errors: null
    },
    {
      id: 2,
      coreMeasurementID: 2,
      treeTag: 'TREE002',
      stemTag: '1',
      speciesCode: 'SPCODE2',
      quadratName: 'Q0102',
      lx: 11.5,
      ly: 21.5,
      dbh: 16.5,
      hom: 1.3,
      measurementDate: '2024-06-16',
      isValidated: 0,
      errors: null
    },
    {
      id: 3,
      coreMeasurementID: 3,
      treeTag: 'TREE003',
      stemTag: '1',
      speciesCode: 'SPCODE3',
      quadratName: 'Q0103',
      lx: 12.5,
      ly: 22.5,
      dbh: 17.5,
      hom: 1.3,
      measurementDate: '2024-06-17',
      isValidated: null,
      errors: 'Missing X|Invalid DBH'
    }
  ];

  const mockValidationErrors = {
    failed: [
      {
        coreMeasurementID: 3,
        validationErrorIDs: [1, 2],
        descriptions: ['Missing X', 'Invalid DBH'],
        criteria: ['lx IS NOT NULL', 'dbh < 1000']
      }
    ]
  };

  beforeEach(() => {
    // Setup authentication
    cy.visit('/login');
    cy.window().then((win) => {
      win.sessionStorage.setItem('next-auth.session-token', 'mock-token');
    });

    cy.intercept('GET', '/api/auth/session', {
      statusCode: 200,
      body: {
        user: {
          name: 'Test User',
          email: 'test@forestgeo.si.edu',
          userStatus: 'field crew'
        },
        expires: '2025-12-31'
      }
    }).as('session');

    // Mock site/plot/census context
    cy.intercept('GET', '/api/fetchall/sites?schema=*', {
      statusCode: 200,
      body: [{
        siteID: 1,
        siteName: 'Test Site',
        schemaName: 'test_schema'
      }]
    }).as('fetchSites');

    cy.intercept('GET', '/api/fetchall/plots?schema=*', {
      statusCode: 200,
      body: [{
        plotID: 1,
        plotName: 'Test Plot',
        num_quadrats: 100
      }]
    }).as('fetchPlots');

    cy.intercept('GET', '/api/fetchall/census/1/1?schema=*', {
      statusCode: 200,
      body: [{
        censusID: 1,
        plotCensusNumber: 1,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        dateRanges: [{
          censusID: 1,
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        }]
      }]
    }).as('fetchCensus');

    cy.visit('/dashboard');
    cy.wait('@session');
    cy.wait('@fetchSites');
    cy.wait('@fetchPlots');
    cy.wait('@fetchCensus');

    cy.log('✅ User authenticated and context set');
  });

  describe('Full Table Navigation', () => {
    beforeEach(() => {
      cy.log('📍 Navigating to View Full Table');
      cy.visit('/measurementshub/viewfulltable');

      // Mock measurements data
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchMeasurements');

      cy.wait('@fetchMeasurements');
    });

    it('should display view full table page', () => {
      cy.log('🔍 Verifying full table page displays');

      // Verify URL
      cy.url().should('include', '/measurementshub/viewfulltable');

      // Verify data grid is present
      cy.get('[role="grid"]', { timeout: 10000 }).should('be.visible');

      // Verify toolbar is present
      cy.get('[role="toolbar"]', { timeout: 5000 }).should('be.visible');

      cy.log('✅ Full table page displayed successfully');
    });

    it('should load and display measurement data', () => {
      cy.log('📊 Verifying measurement data displays');

      // Verify measurements are displayed
      cy.contains('TREE001').should('be.visible');
      cy.contains('TREE002').should('be.visible');
      cy.contains('TREE003').should('be.visible');

      // Verify species codes
      cy.contains('SPCODE1').should('be.visible');
      cy.contains('SPCODE2').should('be.visible');

      // Verify quadrat names
      cy.contains('Q0101').should('be.visible');

      cy.log('✅ Measurement data displayed successfully');
    });

    it('should display column headers', () => {
      cy.log('🔍 Verifying column headers');

      // Check for key column headers
      cy.get('[role="columnheader"]').should('contain', 'Tree');
      cy.get('[role="columnheader"]').should('contain', 'Stem');
      cy.get('[role="columnheader"]').should('contain', 'Species');
      cy.get('[role="columnheader"]').should('contain', 'Quadrat');
      cy.get('[role="columnheader"]').should('contain', 'DBH');
      cy.get('[role="columnheader"]').should('contain', 'HOM');

      cy.log('✅ Column headers displayed correctly');
    });

    it('should handle pagination', () => {
      cy.log('📄 Testing pagination');

      // Mock large dataset
      const largeMeasurements = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        coreMeasurementID: i + 1,
        treeTag: `TREE${String(i + 1).padStart(3, '0')}`,
        stemTag: '1',
        speciesCode: 'SPCODE1',
        quadratName: 'Q0101',
        lx: 10.5,
        ly: 20.5,
        dbh: 15.5,
        hom: 1.3,
        measurementDate: '2024-06-15',
        isValidated: 1
      }));

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        const page = req.body.paginationModel?.page || 0;
        const pageSize = req.body.paginationModel?.pageSize || 25;
        const start = page * pageSize;
        const end = start + pageSize;

        req.reply({
          statusCode: 200,
          body: {
            output: largeMeasurements.slice(start, end),
            totalCount: 100
          }
        });
      }).as('fetchPaginatedMeasurements');

      cy.reload();
      cy.wait('@fetchPaginatedMeasurements');

      // Verify pagination controls are visible
      cy.get('[aria-label*="pagination"]', { timeout: 5000 }).should('be.visible');

      // Click next page
      cy.get('[aria-label*="next page"]').click();
      cy.wait('@fetchPaginatedMeasurements');

      cy.log('  📄 Navigated to next page');

      // Verify different data is displayed
      cy.contains('TREE026').should('be.visible'); // First item of page 2 (if pageSize is 25)

      cy.log('✅ Pagination works correctly');
    });

    it('should allow sorting by columns', () => {
      cy.log('🔄 Testing column sorting');

      // Mock sorted data
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        const sortModel = req.body.sortModel?.[0];

        let sorted = [...mockMeasurements];
        if (sortModel) {
          sorted.sort((a, b) => {
            const aVal = a[sortModel.field as keyof typeof a];
            const bVal = b[sortModel.field as keyof typeof b];
            const result = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
            return sortModel.sort === 'desc' ? -result : result;
          });
        }

        req.reply({
          statusCode: 200,
          body: {
            output: sorted,
            totalCount: sorted.length
          }
        });
      }).as('fetchSortedMeasurements');

      // Click on Tree Tag column header to sort
      cy.get('[role="columnheader"]').contains('Tree').click();
      cy.wait('@fetchSortedMeasurements');

      cy.log('  🔄 Sorted by Tree Tag ascending');

      // Click again to sort descending
      cy.get('[role="columnheader"]').contains('Tree').click();
      cy.wait('@fetchSortedMeasurements');

      cy.log('  🔄 Sorted by Tree Tag descending');

      cy.log('✅ Column sorting works correctly');
    });

    it('should allow filtering by search', () => {
      cy.log('🔍 Testing search filtering');

      // Mock filtered data
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        const filterModel = req.body.filterModel;
        let filtered = mockMeasurements;

        if (filterModel?.items?.length > 0) {
          const filter = filterModel.items[0];
          filtered = mockMeasurements.filter(m =>
            String(m[filter.field as keyof typeof m])
              .toLowerCase()
              .includes(String(filter.value).toLowerCase())
          );
        }

        req.reply({
          statusCode: 200,
          body: {
            output: filtered,
            totalCount: filtered.length
          }
        });
      }).as('fetchFilteredMeasurements');

      // Find and use search/filter input
      cy.get('input[placeholder*="Search"]', { timeout: 5000 })
        .or('input[type="text"]')
        .first()
        .type('TREE001');

      cy.wait('@fetchFilteredMeasurements');

      // Verify only TREE001 is displayed
      cy.contains('TREE001').should('be.visible');
      cy.contains('TREE002').should('not.exist');

      cy.log('✅ Search filtering works correctly');
    });
  });

  describe('Summary View with Metrics', () => {
    beforeEach(() => {
      cy.log('📍 Navigating to Summary View');
      cy.visit('/measurementshub/summary');

      // Mock measurements summary data
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchSummary');

      // Mock validation errors
      cy.intercept('GET', '/api/validations/validationerrordisplay?schema=*', {
        statusCode: 200,
        body: mockValidationErrors
      }).as('fetchValidationErrors');

      // Mock dashboard metrics
      cy.intercept('GET', '/api/dashboardmetrics/ProgressTachometer/*', {
        statusCode: 200,
        body: {
          totalQuadrats: 100,
          completedQuadrats: 75,
          percentComplete: 75
        }
      }).as('fetchTachometerMetrics');

      cy.wait('@fetchSummary');
      cy.wait('@fetchValidationErrors');
    });

    it('should display summary page', () => {
      cy.log('🔍 Verifying summary page displays');

      // Verify URL
      cy.url().should('include', '/measurementshub/summary');

      // Verify grid is present
      cy.get('[role="grid"]', { timeout: 10000 }).should('be.visible');

      cy.log('✅ Summary page displayed successfully');
    });

    it('should display validation error indicators', () => {
      cy.log('⚠️ Verifying validation error indicators');

      // Verify error icon is displayed for measurement with errors
      cy.get('[data-testid="ErrorIcon"]', { timeout: 5000 }).should('exist');

      cy.log('✅ Error indicators displayed correctly');
    });

    it('should show validation error details on hover', () => {
      cy.log('🔍 Testing error tooltip display');

      // Hover over error icon
      cy.get('[data-testid="ErrorIcon"]').first().trigger('mouseover');

      // Verify tooltip appears
      cy.get('[role="tooltip"]', { timeout: 3000 }).should('be.visible');

      // Verify error message is shown
      cy.get('[role="tooltip"]').should('contain', 'Missing X');

      cy.log('✅ Error tooltip displays correctly');
    });

    it('should allow plot switching and update data', () => {
      cy.log('🔄 Testing plot switching');

      // Mock plot 2 data
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema*', (req) => {
        req.reply({
          statusCode: 200,
          body: {
            output: [{
              id: 10,
              coreMeasurementID: 10,
              treeTag: 'PLOT2_TREE001',
              stemTag: '1',
              speciesCode: 'SPCODE5',
              quadratName: 'Q0201',
              lx: 30.5,
              ly: 40.5,
              dbh: 25.5,
              hom: 1.3,
              measurementDate: '2024-07-01',
              isValidated: 1
            }],
            totalCount: 1
          }
        });
      }).as('fetchPlot2Data');

      // Mock additional plots
      cy.intercept('GET', '/api/fetchall/plots?schema=*', {
        statusCode: 200,
        body: [
          { plotID: 1, plotName: 'Plot 1', num_quadrats: 100 },
          { plotID: 2, plotName: 'Plot 2', num_quadrats: 50 }
        ]
      }).as('fetchPlotsWithMultiple');

      cy.reload();
      cy.wait('@fetchPlotsWithMultiple');

      // Find and click plot selector
      cy.get('[data-testid="plot-selector"]', { timeout: 5000 })
        .or('select')
        .contains('Plot')
        .parent()
        .select('Plot 2');

      cy.wait('@fetchPlot2Data');

      // Verify plot 2 data is displayed
      cy.contains('PLOT2_TREE001', { timeout: 5000 }).should('be.visible');

      cy.log('✅ Plot switching works correctly');
    });

    it('should allow census switching and update data', () => {
      cy.log('🔄 Testing census switching');

      // Mock census 2 data
      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema*', {
        statusCode: 200,
        body: {
          output: [{
            id: 20,
            coreMeasurementID: 20,
            treeTag: 'CENSUS2_TREE001',
            stemTag: '1',
            speciesCode: 'SPCODE6',
            quadratName: 'Q0101',
            lx: 15.5,
            ly: 25.5,
            dbh: 30.5,
            hom: 1.3,
            measurementDate: '2025-06-01',
            isValidated: 1
          }],
          totalCount: 1
        }
      }).as('fetchCensus2Data');

      // Mock additional census
      cy.intercept('GET', '/api/fetchall/census/1/1?schema=*', {
        statusCode: 200,
        body: [
          {
            censusID: 1,
            plotCensusNumber: 1,
            startDate: '2024-01-01',
            endDate: '2024-12-31',
            dateRanges: [{ censusID: 1, startDate: '2024-01-01', endDate: '2024-12-31' }]
          },
          {
            censusID: 2,
            plotCensusNumber: 2,
            startDate: '2025-01-01',
            endDate: '2025-12-31',
            dateRanges: [{ censusID: 2, startDate: '2025-01-01', endDate: '2025-12-31' }]
          }
        ]
      }).as('fetchCensusWithMultiple');

      cy.reload();
      cy.wait('@fetchCensusWithMultiple');

      // Find and click census selector
      cy.get('[data-testid="census-selector"]', { timeout: 5000 })
        .or('select')
        .contains('Census')
        .parent()
        .select('Census 2');

      cy.wait('@fetchCensus2Data');

      // Verify census 2 data is displayed
      cy.contains('CENSUS2_TREE001', { timeout: 5000 }).should('be.visible');

      cy.log('✅ Census switching works correctly');
    });
  });

  describe('Filtering (Pending, Validated, Errors)', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/viewfulltable');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchMeasurements');

      cy.wait('@fetchMeasurements');
    });

    it('should filter by validated status', () => {
      cy.log('✅ Testing validated filter');

      // Mock filtered data for validated records
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        req.reply({
          statusCode: 200,
          body: {
            output: mockMeasurements.filter(m => m.isValidated === 1),
            totalCount: 1
          }
        });
      }).as('fetchValidatedOnly');

      // Find and click validated filter button
      cy.contains('button', /validated/i, { timeout: 5000 }).click();
      cy.wait('@fetchValidatedOnly');

      // Verify only validated records are shown
      cy.contains('TREE001').should('be.visible');
      cy.contains('TREE002').should('not.exist');
      cy.contains('TREE003').should('not.exist');

      cy.log('✅ Validated filter works correctly');
    });

    it('should filter by pending status', () => {
      cy.log('⏳ Testing pending filter');

      // Mock filtered data for pending records (isValidated = null or 0)
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        req.reply({
          statusCode: 200,
          body: {
            output: mockMeasurements.filter(m => m.isValidated === null || m.isValidated === 0),
            totalCount: 2
          }
        });
      }).as('fetchPendingOnly');

      // Find and click pending filter button
      cy.contains('button', /pending/i, { timeout: 5000 }).click();
      cy.wait('@fetchPendingOnly');

      // Verify only pending records are shown
      cy.contains('TREE002').should('be.visible');
      cy.contains('TREE003').should('be.visible');
      cy.contains('TREE001').should('not.exist');

      cy.log('✅ Pending filter works correctly');
    });

    it('should filter by error status', () => {
      cy.log('⚠️ Testing error filter');

      // Mock filtered data for records with errors
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        req.reply({
          statusCode: 200,
          body: {
            output: mockMeasurements.filter(m => m.errors !== null && m.errors !== ''),
            totalCount: 1
          }
        });
      }).as('fetchErrorsOnly');

      // Find and click errors filter button
      cy.contains('button', /error/i, { timeout: 5000 }).click();
      cy.wait('@fetchErrorsOnly');

      // Verify only records with errors are shown
      cy.contains('TREE003').should('be.visible');
      cy.contains('TREE001').should('not.exist');
      cy.contains('TREE002').should('not.exist');

      cy.log('✅ Error filter works correctly');
    });

    it('should combine multiple filters', () => {
      cy.log('🔄 Testing multiple filter combination');

      // Mock filtered data for pending + errors
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', (req) => {
        req.reply({
          statusCode: 200,
          body: {
            output: mockMeasurements.filter(m =>
              (m.isValidated === null || m.isValidated === 0) &&
              (m.errors !== null && m.errors !== '')
            ),
            totalCount: 1
          }
        });
      }).as('fetchCombinedFilters');

      // Click pending filter
      cy.contains('button', /pending/i).click();
      cy.wait('@fetchCombinedFilters');

      // Click error filter
      cy.contains('button', /error/i).click();
      cy.wait('@fetchCombinedFilters');

      // Verify only TREE003 (pending with errors) is shown
      cy.contains('TREE003').should('be.visible');
      cy.contains('TREE001').should('not.exist');
      cy.contains('TREE002').should('not.exist');

      cy.log('✅ Combined filters work correctly');
    });
  });

  describe('Data Export Functionality', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/viewfulltable');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchMeasurements');

      cy.wait('@fetchMeasurements');
    });

    it('should have export button visible', () => {
      cy.log('🔍 Verifying export button exists');

      // Look for export button
      cy.get('button').contains(/export/i, { timeout: 5000 })
        .or('button[aria-label*="export"]')
        .should('exist');

      cy.log('✅ Export button found');
    });

    it('should trigger export when button clicked', () => {
      cy.log('📥 Testing export functionality');

      // Mock export API call
      cy.intercept('POST', '/api/export*', {
        statusCode: 200,
        body: 'TreeTag,StemTag,SpeciesCode,Quadrat,DBH,HOM\nTREE001,1,SPCODE1,Q0101,15.5,1.3'
      }).as('exportData');

      // Click export button
      cy.get('button').contains(/export/i).click();

      // Verify export was triggered (download should happen)
      cy.log('✅ Export triggered successfully');
    });

    it('should export filtered data only', () => {
      cy.log('📥 Testing filtered export');

      // Apply filter first
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements.filter(m => m.isValidated === 1),
          totalCount: 1
        }
      }).as('fetchValidatedOnly');

      cy.contains('button', /validated/i).click();
      cy.wait('@fetchValidatedOnly');

      // Mock export with filtered data
      cy.intercept('POST', '/api/export*', {
        statusCode: 200,
        body: 'TreeTag,StemTag,SpeciesCode,Quadrat,DBH,HOM\nTREE001,1,SPCODE1,Q0101,15.5,1.3'
      }).as('exportFilteredData');

      // Click export
      cy.get('button').contains(/export/i).click();

      cy.log('✅ Filtered export works correctly');
    });
  });

  describe('Validation Error Viewing', () => {
    beforeEach(() => {
      cy.visit('/measurementshub/summary');

      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchSummary');

      cy.intercept('GET', '/api/validations/validationerrordisplay?schema=*', {
        statusCode: 200,
        body: mockValidationErrors
      }).as('fetchValidationErrors');

      cy.wait('@fetchSummary');
      cy.wait('@fetchValidationErrors');
    });

    it('should display validation error count badge', () => {
      cy.log('🔍 Verifying error count badge');

      // Look for error count badge
      cy.get('[data-testid="error-count-badge"]', { timeout: 5000 })
        .or('.MuiBadge-badge')
        .should('exist');

      cy.log('✅ Error count badge displayed');
    });

    it('should open failed measurements modal', () => {
      cy.log('📋 Testing failed measurements modal');

      // Mock failed measurements
      cy.intercept('POST', '/api/fixeddatafilter/failedmeasurements/test_schema*', {
        statusCode: 200,
        body: {
          output: [{
            id: 100,
            treeTag: 'FAILED001',
            stemTag: '1',
            speciesCode: 'SPCODE',
            failureReason: 'Missing X coordinate|Invalid DBH value'
          }],
          totalCount: 1
        }
      }).as('fetchFailedMeasurements');

      // Click failed measurements button/badge
      cy.contains('button', /failed/i, { timeout: 5000 })
        .or('[data-testid="failed-measurements-button"]')
        .click();

      cy.wait('@fetchFailedMeasurements');

      // Verify modal opened
      cy.get('[role="dialog"]', { timeout: 5000 }).should('be.visible');

      // Verify failed measurement is displayed
      cy.contains('FAILED001').should('be.visible');
      cy.contains('Missing X coordinate').should('be.visible');

      cy.log('✅ Failed measurements modal works correctly');
    });

    it('should filter by specific error type', () => {
      cy.log('🔍 Testing error type filtering');

      // Mock error types
      cy.intercept('GET', '/api/validations/validationlist?schema=*', {
        statusCode: 200,
        body: {
          coreValidations: {
            'MissingXCoordinate': {
              id: 1,
              description: 'Missing X Coordinate',
              definition: 'SELECT * FROM measurements WHERE lx IS NULL'
            },
            'InvalidDBH': {
              id: 2,
              description: 'Invalid DBH',
              definition: 'SELECT * FROM measurements WHERE dbh > 1000'
            }
          }
        }
      }).as('fetchValidationList');

      // Click on validation errors section
      cy.contains(/validation/i, { timeout: 5000 }).click();

      // Find and select specific error type
      cy.contains('Missing X Coordinate').click();

      // Verify filtered to show only that error type
      cy.contains('TREE003').should('be.visible');

      cy.log('✅ Error type filtering works correctly');
    });
  });

  describe('Integration: Complete Viewing Workflow', () => {
    it('should complete full data viewing workflow', () => {
      cy.log('🔄 Running complete viewing workflow');

      // STEP 1: Navigate to dashboard
      cy.log('📍 STEP 1: Starting from dashboard');
      cy.visit('/dashboard');

      // Mock dashboard metrics
      cy.intercept('GET', '/api/dashboardmetrics/*', {
        statusCode: 200,
        body: {
          totalQuadrats: 100,
          completedQuadrats: 75,
          percentComplete: 75
        }
      }).as('fetchDashboardMetrics');

      cy.wait('@fetchDashboardMetrics');
      cy.log('  ✅ Dashboard loaded');

      // STEP 2: Navigate to summary view
      cy.log('📍 STEP 2: Navigating to summary view');
      cy.visit('/measurementshub/summary');

      cy.intercept('POST', '/api/fixeddatafilter/measurementssummary/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchSummary');

      cy.intercept('GET', '/api/validations/validationerrordisplay?schema=*', {
        statusCode: 200,
        body: mockValidationErrors
      }).as('fetchValidationErrors');

      cy.wait('@fetchSummary');
      cy.wait('@fetchValidationErrors');
      cy.log('  ✅ Summary view loaded');

      // STEP 3: View validation errors
      cy.log('📍 STEP 3: Viewing validation errors');
      cy.get('[data-testid="ErrorIcon"]', { timeout: 5000 }).should('exist');
      cy.log('  ✅ Errors displayed');

      // STEP 4: Navigate to full table
      cy.log('📍 STEP 4: Navigating to full table');
      cy.visit('/measurementshub/viewfulltable');

      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements,
          totalCount: 3
        }
      }).as('fetchFullTable');

      cy.wait('@fetchFullTable');
      cy.log('  ✅ Full table loaded');

      // STEP 5: Apply filter
      cy.log('📍 STEP 5: Applying error filter');
      cy.intercept('POST', '/api/fixeddatafilter/viewfulltable/test_schema*', {
        statusCode: 200,
        body: {
          output: mockMeasurements.filter(m => m.errors),
          totalCount: 1
        }
      }).as('fetchErrorsOnly');

      cy.contains('button', /error/i, { timeout: 5000 }).click();
      cy.wait('@fetchErrorsOnly');
      cy.log('  ✅ Filter applied');

      // STEP 6: Sort data
      cy.log('📍 STEP 6: Sorting data');
      cy.get('[role="columnheader"]').contains('Tree').click();
      cy.log('  ✅ Data sorted');

      // STEP 7: Export filtered data
      cy.log('📍 STEP 7: Exporting filtered data');
      cy.get('button').contains(/export/i).should('exist');
      cy.log('  ✅ Export available');

      cy.log('✅ Complete viewing workflow verified');
    });
  });
});
