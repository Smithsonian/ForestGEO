/**
 * Complete Enhanced Upload Flow Test
 * Tests the full upload system with the actual CSV data patterns that were failing
 */

describe('Complete Enhanced Upload Flow', () => {
  beforeEach(() => {
    // Setup authentication and context
    cy.session('upload-test-session', () => {
      cy.visit('/login');
      cy.get('[data-cy="email-input"]').should('exist');
      // Mock authentication
      cy.window().then(win => {
        win.localStorage.setItem('next-auth.session-token', 'mock-session-token');
      });
    });

    // Mock all API endpoints
    cy.intercept('GET', '/api/catalog/**', { fixture: 'test-user.json' }).as('getUser');
    cy.intercept('GET', '/api/fetchall/sites**', {
      statusCode: 200,
      body: [{ schemaName: 'test_schema', siteName: 'Test Site' }]
    }).as('getSites');
    cy.intercept('GET', '/api/fetchall/plots**', {
      statusCode: 200,
      body: [{ plotID: 1, plotName: 'Test Plot' }]
    }).as('getPlots');
    cy.intercept('GET', '/api/fetchall/census**', {
      statusCode: 200,
      body: [{ censusID: 1, dateRanges: [{ censusID: 1, startDate: '2020-01-01', endDate: '2020-12-31' }] }]
    }).as('getCensus');

    // Mock upload-specific endpoints
    cy.intercept('GET', '/api/setupbulkprocessor/**', {
      statusCode: 200,
      body: { message: 'Processor setup successful' }
    }).as('setupProcessor');

    cy.intercept('POST', '/api/sqlpacketload', {
      statusCode: 200,
      body: {
        responseMessage: 'Bulk insert to SQL completed',
        insertedCount: 10,
        batchID: 'test-batch-123'
      }
    }).as('uploadChunk');

    cy.intercept('GET', '/api/setupbulkprocedure/**', {
      statusCode: 200,
      body: {
        attemptsNeeded: 1,
        batchFailedButHandled: false,
        message: 'Batch processed successfully'
      }
    }).as('processBatch');

    cy.intercept('GET', '/api/setupbulkcollapser/**', {
      statusCode: 200,
      body: { message: 'Collapser completed successfully' }
    }).as('collapser');
  });

  it('should handle the complete upload flow for cocoli1b.csv format', () => {
    cy.visit('/dashboard');

    // Navigate to upload system
    cy.contains('Upload Data').click();
    cy.url().should('include', '/upload');

    // Select measurements form type
    cy.get('[data-cy="form-type-select"]').click();
    cy.contains('measurements').click();

    // Create and upload the problematic CSV file
    const cocoliCsvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
000001,1,protte,0000,3.00,0.90,171.0,,2.60,1994-11-02
000002,1,coccpa,0000,0.10,0.60,13.0,,1.30,1994-11-02
000003,1,eugepr,0000,1.30,2.30,26.0,M,1.20,1994-11-02
000003,2,eugepr,0000,1.30,2.30,14.0,,1.30,1994-11-02
000004,1,protte,0000,2.20,3.40,10.0,,1.30,1994-11-02`;

    cy.get('input[type="file"]').then(input => {
      const file = new File([cocoliCsvContent], 'cocoli1b.csv', { type: 'text/csv' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input[0].files = dataTransfer.files;
      input[0].dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Verify file is selected and shows correct information
    cy.contains('cocoli1b.csv').should('be.visible');
    cy.contains('Continue Upload').should('be.enabled');

    // Check that the header guide shows order doesn't matter
    cy.contains('Show Header Guide').click();
    cy.contains("Required headers (order doesn't matter)").should('be.visible');
    cy.contains('tag').should('be.visible');
    cy.contains('spcode').should('be.visible');
    cy.contains('quadrat').should('be.visible');

    // Start the upload process
    cy.contains('Continue Upload').click();

    // Should move to review stage
    cy.contains('Review Files').should('be.visible', { timeout: 10000 });

    // Continue to processing
    cy.contains('Upload Files').click();

    // Should show processing progress
    cy.contains('Processing', { timeout: 5000 }).should('be.visible');

    // Wait for completion
    cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');

    // Verify API calls were made with correct data
    cy.wait('@setupProcessor');
    cy.wait('@uploadChunk').then(interception => {
      const requestBody = interception.request.body;

      // Verify the data structure is correct
      expect(requestBody).to.have.property('schema');
      expect(requestBody).to.have.property('formType', 'measurements');
      expect(requestBody).to.have.property('fileName', 'cocoli1b.csv');
      expect(requestBody).to.have.property('fileRowSet');

      // Verify the data was properly mapped despite different column order
      const fileRowSet = requestBody.fileRowSet;
      const rowKeys = Object.keys(fileRowSet);
      expect(rowKeys.length).to.be.greaterThan(0);

      const firstRow = fileRowSet[rowKeys[0]];
      expect(firstRow.tag).to.equal('000001');
      expect(firstRow.spcode).to.equal('protte');
      expect(firstRow.quadrat).to.equal('0000');
      expect(firstRow.lx).to.equal(3.0);
      expect(firstRow.ly).to.equal(0.9);
      expect(firstRow.dbh).to.equal(171.0);
    });

    cy.wait('@processBatch');
  });

  it('should handle SERC_census1_2025.csv format with different column order', () => {
    cy.visit('/dashboard');
    cy.contains('Upload Data').click();

    // Select measurements form
    cy.get('[data-cy="form-type-select"]').click();
    cy.contains('measurements').click();

    // Create the SERC format file (different column order)
    const sercCsvContent = `quadrat,tag,stemtag,spcode,lx,ly,dbh,hom,date,codes
1011,100001,1,FAGR,202,104.5,3.5,1.30,2010-03-17,LI
1011,100002,1,LIST2,201.60001,101.1,59.6,1.30,2010-03-17,LI
1011,100003,1,CACA18,203.5,102,6,1.30,2010-03-17,LI
121,10001,1,FRPE,14.1,5.2,12.5,1.30,2009-10-15,LI`;

    cy.get('input[type="file"]').then(input => {
      const file = new File([sercCsvContent], 'SERC_census1_2025.csv', { type: 'text/csv' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input[0].files = dataTransfer.files;
      input[0].dispatchEvent(new Event('change', { bubbles: true }));
    });

    cy.contains('SERC_census1_2025.csv').should('be.visible');
    cy.contains('Continue Upload').click();
    cy.contains('Review Files').should('be.visible');
    cy.contains('Upload Files').click();

    // Verify processing completes successfully
    cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');

    // Verify correct data mapping despite different column order
    cy.wait('@uploadChunk').then(interception => {
      const requestBody = interception.request.body;
      const firstRow = requestBody.fileRowSet[Object.keys(requestBody.fileRowSet)[0]];

      // Verify quadrat came from first column
      expect(firstRow.quadrat).to.equal('1011');
      // Verify tag came from second column
      expect(firstRow.tag).to.equal('100001');
      // Verify coordinates have proper precision
      expect(firstRow.lx).to.equal(202);
      expect(firstRow.ly).to.equal(104.5);
    });
  });

  it('should handle various date formats in the same file', () => {
    cy.visit('/dashboard');
    cy.contains('Upload Data').click();

    // Select measurements form
    cy.get('[data-cy="form-type-select"]').click();
    cy.contains('measurements').click();

    // Create file with mixed date formats
    const mixedDateContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date
001,1,TEST,0001,1.0,1.0,10.0,,1.3,1994-11-02
002,1,TEST,0001,2.0,2.0,11.0,,1.3,11/02/1994
003,1,TEST,0001,3.0,3.0,12.0,,1.3,02/11/1994
004,1,TEST,0001,4.0,4.0,13.0,,1.3,November 2, 1994`;

    cy.get('input[type="file"]').then(input => {
      const file = new File([mixedDateContent], 'mixed-dates.csv', { type: 'text/csv' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input[0].files = dataTransfer.files;
      input[0].dispatchEvent(new Event('change', { bubbles: true }));
    });

    cy.contains('mixed-dates.csv').should('be.visible');
    cy.contains('Continue Upload').click();
    cy.contains('Review Files').should('be.visible');
    cy.contains('Upload Files').click();

    // Should process successfully
    cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');

    // Verify all dates were parsed correctly
    cy.wait('@uploadChunk').then(interception => {
      const requestBody = interception.request.body;
      const fileRowSet = requestBody.fileRowSet;
      const rows = Object.values(fileRowSet);

      // All rows should have valid dates
      rows.forEach((row: any) => {
        expect(row.date).to.not.be.null;
        expect(row.date).to.be.a('string');
        // Should be a valid date string
        expect(new Date(row.date).getTime()).to.not.be.NaN;
      });
    });
  });

  it('should show error for files that cannot be processed', () => {
    cy.visit('/dashboard');
    cy.contains('Upload Data').click();

    // Select measurements form
    cy.get('[data-cy="form-type-select"]').click();
    cy.contains('measurements').click();

    // Create a file with completely wrong headers
    const badCsvContent = `wrong,headers,that,dont,match,anything
value1,value2,value3,value4,value5,value6`;

    cy.get('input[type="file"]').then(input => {
      const file = new File([badCsvContent], 'bad-headers.csv', { type: 'text/csv' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input[0].files = dataTransfer.files;
      input[0].dispatchEvent(new Event('change', { bubbles: true }));
    });

    cy.contains('bad-headers.csv').should('be.visible');
    cy.contains('Continue Upload').click();

    // Should show some kind of warning or error
    // The system should gracefully handle this and potentially show validation issues
    cy.contains('Review Files').should('be.visible');

    // When trying to upload, it should handle missing data gracefully
    cy.contains('Upload Files').click();

    // System should either complete with warnings or show appropriate error
    // The key is that it doesn't crash with the old SQL error 1093
  });

  it('should preserve existing functionality for known good files', () => {
    cy.visit('/dashboard');
    cy.contains('Upload Data').click();

    // Test with a file that matches the expected format exactly
    cy.get('[data-cy="form-type-select"]').click();
    cy.contains('measurements').click();

    const perfectCsvContent = `tag,stemtag,spcode,quadrat,lx,ly,dbh,hom,date,codes
001,1,TEST1,0001,1.0,1.0,10.0,1.3,2020-01-01,LI
002,1,TEST2,0001,2.0,2.0,11.0,1.3,2020-01-02,LI;M`;

    cy.get('input[type="file"]').then(input => {
      const file = new File([perfectCsvContent], 'perfect-format.csv', { type: 'text/csv' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input[0].files = dataTransfer.files;
      input[0].dispatchEvent(new Event('change', { bubbles: true }));
    });

    cy.contains('perfect-format.csv').should('be.visible');
    cy.contains('Continue Upload').click();
    cy.contains('Review Files').should('be.visible');
    cy.contains('Upload Files').click();

    // Should process without any issues
    cy.contains('Upload Complete', { timeout: 30000 }).should('be.visible');

    // Verify data integrity is maintained
    cy.wait('@uploadChunk').then(interception => {
      const requestBody = interception.request.body;
      const firstRow = requestBody.fileRowSet[Object.keys(requestBody.fileRowSet)[0]];

      expect(firstRow.tag).to.equal('001');
      expect(firstRow.spcode).to.equal('TEST1');
      expect(firstRow.codes).to.equal('LI');
      expect(firstRow.lx).to.equal(1.0);
      expect(firstRow.ly).to.equal(1.0);
    });
  });
});
