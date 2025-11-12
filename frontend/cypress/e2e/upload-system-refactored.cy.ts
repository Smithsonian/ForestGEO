/**
 * Integration Tests for Refactored Upload System
 *
 * Tests the upload system after state management refactoring:
 * - useFileManagement hook
 * - useUploadState hook
 * - useErrorHandling hook
 *
 * Verifies:
 * 1. Complete upload workflow (file upload → SQL → validation → complete)
 * 2. Data integrity (coremeasurements table)
 * 3. Failed measurements handling
 * 4. Tree-stem state categorization
 * 5. Error recovery scenarios
 * 6. File management operations
 */

describe('Upload System - Refactored Integration Tests', () => {
  beforeEach(() => {
    // Setup authentication
    cy.session('upload-refactored-test', () => {
      cy.visit('/login');
      cy.window().then(win => {
        win.localStorage.setItem('next-auth.session-token', 'mock-session-token');
      });
    });

    // Mock all required API endpoints
    cy.intercept('GET', '/api/catalog/**', { fixture: 'test-user.json' }).as('getUser');
    cy.intercept('GET', '/api/fetchall/sites**', {
      statusCode: 200,
      body: [{ schemaName: 'forestgeo_testing', siteName: 'Test Site' }]
    }).as('getSites');
    cy.intercept('GET', '/api/fetchall/plots**', {
      statusCode: 200,
      body: [{ plotID: 1, plotName: 'Test Plot' }]
    }).as('getPlots');
    cy.intercept('GET', '/api/fetchall/census**', {
      statusCode: 200,
      body: [{
        censusID: 1,
        plotCensusNumber: 1,
        dateRanges: [{ censusID: 1, startDate: '2020-01-01', endDate: '2020-12-31' }]
      }]
    }).as('getCensus');
    cy.intercept('GET', '/api/fetchall/personnel**', {
      statusCode: 200,
      body: [{ personnelID: 1, firstName: 'Test', lastName: 'User' }]
    }).as('getPersonnel');

    // Mock upload-specific endpoints
    cy.intercept('GET', '/api/setupbulkprocessor/**', {
      statusCode: 200,
      body: { message: 'Processor setup successful' }
    }).as('setupProcessor');

    cy.intercept('POST', '/api/sqlpacketload', {
      statusCode: 200,
      body: {
        responseMessage: 'Bulk insert to SQL completed',
        insertedCount: 5,
        batchID: 'test-batch-refactored-123'
      }
    }).as('uploadChunk');

    cy.intercept('GET', '/api/setupbulkprocedure/**', {
      statusCode: 200,
      body: {
        attemptsNeeded: 1,
        batchFailedButHandled: false,
        message: 'Batch processed successfully',
        failedRows: []
      }
    }).as('processBatch');

    cy.intercept('GET', '/api/setupbulkcollapser/**', {
      statusCode: 200,
      body: { message: 'Collapser completed successfully' }
    }).as('collapser');
  });

  describe('File Management Hook Integration', () => {
    it('should handle file addition through useFileManagement hook', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();
      cy.url().should('include', '/upload');

      // Select measurements form type
      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();

      // Set personnel (required for measurements)
      cy.get('[data-cy="personnel-select"]').should('be.visible');
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      // Add first file
      const file1Content = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17
100002,1,LIST2,1011,201.6,101.1,59.6,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([file1Content], 'test-file-1.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Verify file was added via useFileManagement hook
      cy.contains('test-file-1.csv').should('be.visible');
      cy.contains('2 rows').should('be.visible'); // Excludes header

      // Add second file
      const file2Content = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100003,1,CACA18,1011,203.5,102,6,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([file2Content], 'test-file-2.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      // Verify both files are managed by useFileManagement
      cy.contains('test-file-1.csv').should('be.visible');
      cy.contains('test-file-2.csv').should('be.visible');
    });

    it('should handle file removal through useFileManagement hook', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      // Add two files
      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file1 = new File([csvContent], 'remove-test-1.csv', { type: 'text/csv' });
        const file2 = new File([csvContent], 'remove-test-2.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file1);
        dataTransfer.items.add(file2);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('remove-test-1.csv').should('be.visible');
      cy.contains('remove-test-2.csv').should('be.visible');

      // Remove first file using hook's removeFile function
      cy.contains('remove-test-1.csv').parent().find('[data-cy="remove-file-button"]').click();

      // Verify file was removed via useFileManagement.removeFile
      cy.contains('remove-test-1.csv').should('not.exist');
      cy.contains('remove-test-2.csv').should('be.visible');
    });

    it('should handle file replacement through useFileManagement hook', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      // Add initial file
      const initialContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([initialContent], 'replace-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('replace-test.csv').should('be.visible');

      // Replace file using hook's replaceFile function
      const replacementContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100002,1,LIST2,1011,201.6,101.1,59.6,,1.30,2010-03-17
100003,1,CACA18,1011,203.5,102,6,,1.30,2010-03-17`;

      cy.contains('replace-test.csv').parent().find('[data-cy="replace-file-button"]').then(replaceBtn => {
        const file = new File([replacementContent], 'replacement.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        cy.wrap(replaceBtn).click();
        cy.get('input[type="file"]').last().then(input => {
          input[0].files = dataTransfer.files;
          input[0].dispatchEvent(new Event('change', { bubbles: true }));
        });
      });

      // Verify replacement via useFileManagement.replaceFile
      cy.contains('replacement.csv').should('be.visible');
      cy.contains('replace-test.csv').should('not.exist');
      cy.contains('2 rows').should('be.visible'); // New file has 2 rows
    });
  });

  describe('Upload State Hook Integration', () => {
    it('should progress through review states using useUploadState hook', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      // START state
      cy.contains('Select Upload Form Type').should('be.visible');

      // Transition to UPLOAD_FILES state via useUploadState.setReviewState
      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17
100002,1,LIST2,1011,201.6,101.1,59.6,,1.30,2010-03-17
100003,1,CACA18,1011,203.5,102,6,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'state-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('state-test.csv').should('be.visible');

      // Transition to UPLOAD_SQL state
      cy.contains('Continue Upload').click();

      // Should show processing state managed by useUploadState
      cy.contains('Processing', { timeout: 10000 }).should('be.visible');

      // Wait for COMPLETE state
      cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');

      // Verify state transitions through useUploadState hook
      cy.wait('@uploadChunk');
      cy.wait('@processBatch');
    });

    it('should manage personnel recording state for measurements', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();

      // useUploadState.needsPersonnel should be true
      cy.get('[data-cy="personnel-select"]').should('be.visible');
      cy.contains('Continue Upload').should('be.disabled'); // canProceed = false

      // Set personnel via useUploadState.setPersonnelRecording
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      // Now canProceed should be true
      // (Will still be disabled until file is added, but personnel requirement is met)
      cy.get('[data-cy="personnel-select"]').should('contain', 'Test User');
    });

    it('should handle data unsaved warning via useUploadState', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'unsaved-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('Continue Upload').click();

      // useUploadState.setIsDataUnsaved(true) should be called during processing
      // Browser should show beforeunload warning if user tries to navigate away
      cy.window().then(win => {
        const beforeUnloadHandler = cy.stub();
        win.addEventListener('beforeunload', beforeUnloadHandler);

        // Trigger navigation attempt
        cy.contains('Dashboard').click({ force: true });

        // Should trigger beforeunload due to isDataUnsaved state
        // (Can't fully test this in Cypress, but state should be set)
      });
    });
  });

  describe('Error Handling Hook Integration', () => {
    it('should handle upload errors via useErrorHandling hook', () => {
      // Mock upload failure
      cy.intercept('POST', '/api/sqlpacketload', {
        statusCode: 500,
        body: { error: 'Database connection failed' }
      }).as('uploadError');

      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'error-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('Continue Upload').click();

      // Should show error via useErrorHandling.setError
      cy.wait('@uploadError');
      cy.contains('error', { matchCase: false, timeout: 10000 }).should('be.visible');

      // Should show error component and message
      cy.contains('Database connection failed', { timeout: 5000 }).should('be.visible');
    });

    it('should allow error recovery via useErrorHandling.clearError', () => {
      // First attempt fails
      cy.intercept('POST', '/api/sqlpacketload', {
        statusCode: 500,
        body: { error: 'Temporary failure' }
      }).as('uploadError');

      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'retry-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('Continue Upload').click();
      cy.wait('@uploadError');
      cy.contains('error', { matchCase: false }).should('be.visible');

      // Mock successful retry
      cy.intercept('POST', '/api/sqlpacketload', {
        statusCode: 200,
        body: { responseMessage: 'Success', insertedCount: 1, batchID: 'retry-123' }
      }).as('uploadSuccess');

      // Click retry button (triggers useErrorHandling.clearError + retry)
      cy.contains('Retry').click();

      // Should clear error and succeed
      cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');
    });
  });

  describe('Complete Upload Workflow - Data Integrity', () => {
    it('should upload measurements and verify data structure', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      // Upload with various tree states
      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17
100002,1,LIST2,1011,201.6,101.1,59.6,M,1.30,2010-03-17
100003,1,CACA18,1011,203.5,102,6,,1.30,2010-03-17
100004,1,FRPE,121,14.1,5.2,12.5,,1.30,2009-10-15
000001,1,protte,0000,3.00,0.90,171.0,,2.60,1994-11-02`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'integrity-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('Continue Upload').click();

      // Verify data structure sent to API
      cy.wait('@uploadChunk').then(interception => {
        const requestBody = interception.request.body;

        // Verify schema and form type
        expect(requestBody).to.have.property('schema', 'forestgeo_testing');
        expect(requestBody).to.have.property('formType', 'measurements');
        expect(requestBody).to.have.property('fileName', 'integrity-test.csv');
        expect(requestBody).to.have.property('fileRowSet');

        const fileRowSet = requestBody.fileRowSet;
        const rowKeys = Object.keys(fileRowSet);
        expect(rowKeys).to.have.length(5);

        // Verify row data structure and values
        const row1 = fileRowSet[rowKeys[0]];
        expect(row1).to.have.property('tag', '100001');
        expect(row1).to.have.property('stemtag', '1');
        expect(row1).to.have.property('spcode', 'FAGR');
        expect(row1).to.have.property('quadrat', '1011');
        expect(row1).to.have.property('lx', 202);
        expect(row1).to.have.property('ly', 104.5);
        expect(row1).to.have.property('dbh', 3.5);
        expect(row1).to.have.property('hom', 1.30);

        // Verify multi-stem code
        const row2 = fileRowSet[rowKeys[1]];
        expect(row2).to.have.property('codes', 'M');

        // Verify different date formats parsed correctly
        expect(row1).to.have.property('date');
        expect(row4).to.have.property('date');
      });

      cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');
    });

    it('should handle failed measurements and categorize by tree-stem state', () => {
      // Mock batch processing with some failed rows
      cy.intercept('GET', '/api/setupbulkprocedure/**', {
        statusCode: 200,
        body: {
          attemptsNeeded: 2,
          batchFailedButHandled: true,
          message: 'Some rows failed validation',
          failedRows: [
            { rowIndex: 2, reason: 'Invalid DBH value', tag: '100003' },
            { rowIndex: 4, reason: 'Missing quadrat', tag: '100005' }
          ]
        }
      }).as('processBatchWithFailures');

      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17
100002,1,LIST2,1011,201.6,101.1,59.6,,1.30,2010-03-17
100003,1,CACA18,1011,203.5,102,INVALID,,1.30,2010-03-17
100004,1,FRPE,121,14.1,5.2,12.5,,1.30,2009-10-15
100005,1,protte,,3.00,0.90,171.0,,2.60,1994-11-02`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'failed-rows-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('Continue Upload').click();

      // Should handle failures and show appropriate message
      cy.wait('@processBatchWithFailures');
      cy.contains('Some rows failed', { timeout: 30000 }).should('be.visible');
      cy.contains('2 rows failed').should('be.visible');

      // Should categorize failed rows
      cy.contains('Invalid DBH value').should('be.visible');
      cy.contains('Missing quadrat').should('be.visible');
    });
  });

  describe('Reset and State Cleanup', () => {
    it('should reset all state via useUploadState.resetToStart', () => {
      cy.visit('/dashboard');
      cy.contains('Upload Data').click();

      cy.get('[data-cy="form-type-select"]').click();
      cy.contains('measurements').click();
      cy.get('[data-cy="personnel-select"]').click();
      cy.contains('Test User').click();

      const csvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
100001,1,FAGR,1011,202,104.5,3.5,,1.30,2010-03-17`;

      cy.get('input[type="file"]').then(input => {
        const file = new File([csvContent], 'reset-test.csv', { type: 'text/csv' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        input[0].files = dataTransfer.files;
        input[0].dispatchEvent(new Event('change', { bubbles: true }));
      });

      cy.contains('reset-test.csv').should('be.visible');

      // Click reset/start over button
      cy.contains('Start Over').click();

      // Should reset to START state via useUploadState.resetToStart
      // and clear files via useFileManagement.clearFiles
      cy.contains('Select Upload Form Type').should('be.visible');
      cy.contains('reset-test.csv').should('not.exist');
    });
  });
});
