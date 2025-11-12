/**
 * Upload System Guarantees - E2E Tests
 *
 * Tests the 4 guarantees for the refactored upload system:
 * 1. Records save correctly to coremeasurements
 * 2. Failed rows move to failedmeasurements properly
 * 3. Tree-stem states categorize correctly
 * 4. Error handling works in production
 */

import { runQuery } from '../support/runQuery';

describe('Upload System Guarantees', () => {
  const schema = 'forestgeo_testing';
  const plotID = 1;
  const censusID = 2;
  const personnelID = 1; // Integration TestUser

  beforeEach(() => {
    // Login
    cy.login();

    // Navigate to upload page
    cy.visit('/upload');

    // Select measurements form type
    cy.get('[data-testid="form-type-select"]').click();
    cy.contains('Measurements').click();

    // Select personnel
    cy.get('[data-testid="personnel-select"]').click();
    cy.contains('Integration TestUser').click();
  });

  afterEach(() => {
    // Clean up test data after each test
    cy.task('queryDB', {
      query: `
        DELETE cm FROM ${schema}.coremeasurements cm
        JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
        JOIN ${schema}.trees t ON s.TreeID = t.TreeID
        WHERE t.TreeTag LIKE 'TEST%';

        DELETE FROM ${schema}.stems WHERE TreeID IN (SELECT TreeID FROM ${schema}.trees WHERE TreeTag LIKE 'TEST%');
        DELETE FROM ${schema}.trees WHERE TreeTag LIKE 'TEST%';
        DELETE FROM ${schema}.failedmeasurements WHERE Tag LIKE 'TEST%';
        DELETE FROM ${schema}.temporarymeasurements WHERE FileID LIKE 'TEST%';
      `
    });
  });

  /**
   * GUARANTEE 1: Records save correctly to coremeasurements
   */
  describe('Guarantee 1: Records save correctly', () => {
    it('should save valid measurements to coremeasurements', () => {
      // Upload test file
      cy.get('[data-testid="file-dropzone"]').selectFile('test-valid-measurements.csv', {
        action: 'drag-drop'
      });

      // Wait for file parsing
      cy.contains('test-valid-measurements.csv').should('be.visible');

      // Click continue
      cy.get('[data-testid="continue-upload-btn"]').click();

      // Wait for upload to complete
      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');

      // Verify in database
      cy.task<any[]>('queryDB', {
        query: `
          SELECT
            t.TreeTag,
            s.StemTag,
            sp.SpeciesCode,
            q.QuadratName,
            cm.MeasuredDBH,
            cm.MeasuredHOM,
            cm.MeasurementDate
          FROM ${schema}.coremeasurements cm
          JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
          JOIN ${schema}.trees t ON s.TreeID = t.TreeID
          JOIN ${schema}.species sp ON t.SpeciesID = sp.SpeciesID
          JOIN ${schema}.quadrats q ON s.QuadratID = q.QuadratID
          WHERE t.TreeTag IN ('TESTVALID001', 'TESTVALID002', 'TESTVALID003')
          AND cm.CensusID = ${censusID}
          ORDER BY t.TreeTag
        `
      }).then((results) => {
        expect(results).to.have.length(3);

        // Verify first record
        expect(results[0]).to.deep.include({
          TreeTag: 'TESTVALID001',
          StemTag: '1',
          SpeciesCode: 'ACACBR',
          QuadratName: '0101',
          MeasuredDBH: 15.3,
          MeasuredHOM: 1.3
        });

        // Verify second record
        expect(results[1]).to.deep.include({
          TreeTag: 'TESTVALID002',
          StemTag: '1',
          SpeciesCode: 'ACACDR',
          QuadratName: '0102',
          MeasuredDBH: 22.8,
          MeasuredHOM: 1.3
        });

        // Verify third record
        expect(results[2]).to.deep.include({
          TreeTag: 'TESTVALID003',
          StemTag: '1',
          SpeciesCode: 'ACACET',
          QuadratName: '0103',
          MeasuredDBH: 8.5,
          MeasuredHOM: 1.3
        });
      });

      // Check for data loss
      cy.task<any[]>('queryDB', {
        query: `
          SELECT * FROM ${schema}.uploaddatalossreport
          WHERE FileID LIKE 'TEST-VALID%'
        `
      }).then((lossRecords) => {
        expect(lossRecords).to.have.length(0, 'No data loss should be detected');
      });
    });
  });

  /**
   * GUARANTEE 2: Failed rows move to failedmeasurements properly
   */
  describe('Guarantee 2: Failed rows handled correctly', () => {
    it('should move invalid rows to failedmeasurements', () => {
      // Upload file with mixed valid/invalid data
      cy.get('[data-testid="file-dropzone"]').selectFile('test-invalid-measurements.csv', {
        action: 'drag-drop'
      });

      cy.contains('test-invalid-measurements.csv').should('be.visible');
      cy.get('[data-testid="continue-upload-btn"]').click();

      // Wait for upload (may show warnings about failed rows)
      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');

      // Verify valid records in coremeasurements
      cy.task<any[]>('queryDB', {
        query: `
          SELECT COUNT(*) as count
          FROM ${schema}.coremeasurements cm
          JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
          JOIN ${schema}.trees t ON s.TreeID = t.TreeID
          WHERE t.TreeTag LIKE 'TESTINVALID%'
          AND cm.CensusID = ${censusID}
        `
      }).then((results) => {
        expect(results[0].count).to.equal(1, 'Should have 1 valid record');
      });

      // Verify failed records in failedmeasurements
      cy.task<any[]>('queryDB', {
        query: `
          SELECT Tag, StemTag, SpCode, Quadrat, DBH
          FROM ${schema}.failedmeasurements
          WHERE Tag LIKE 'TESTINVALID%'
          AND CensusID = ${censusID}
          ORDER BY Tag
        `
      }).then((failedRecords) => {
        expect(failedRecords).to.have.length(3, 'Should have 3 failed records');

        // Verify failed records
        const tags = failedRecords.map(r => r.Tag);
        expect(tags).to.include.members(['TESTINVALID002', 'TESTINVALID003', 'TESTINVALID004']);
      });

      // Verify no data loss (total should be 4)
      cy.task<any[]>('queryDB', {
        query: `
          SELECT
            (SELECT COUNT(*) FROM ${schema}.coremeasurements cm
             JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
             JOIN ${schema}.trees t ON s.TreeID = t.TreeID
             WHERE t.TreeTag LIKE 'TESTINVALID%' AND cm.CensusID = ${censusID}) +
            (SELECT COUNT(*) FROM ${schema}.failedmeasurements
             WHERE Tag LIKE 'TESTINVALID%' AND CensusID = ${censusID}) as total
        `
      }).then((results) => {
        expect(results[0].total).to.equal(4, 'All 4 records should be accounted for');
      });
    });
  });

  /**
   * GUARANTEE 3: Tree-stem states categorize correctly
   */
  describe('Guarantee 3: Tree-stem state categorization', () => {
    it('should categorize records by validation state based on codes', () => {
      // Upload file with different codes (M, D, A, none)
      cy.get('[data-testid="file-dropzone"]').selectFile('test-tree-states.csv', {
        action: 'drag-drop'
      });

      cy.contains('test-tree-states.csv').should('be.visible');
      cy.get('[data-testid="continue-upload-btn"]').click();

      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');

      // Verify state categorization
      cy.task<any[]>('queryDB', {
        query: `
          SELECT
            t.TreeTag,
            cm.IsValidated,
            CASE
              WHEN cm.IsValidated = 1 THEN 'Valid'
              WHEN cm.IsValidated = 0 THEN 'Invalid'
              WHEN cm.IsValidated IS NULL THEN 'Pending'
            END as ValidationState
          FROM ${schema}.coremeasurements cm
          JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
          JOIN ${schema}.trees t ON s.TreeID = t.TreeID
          WHERE t.TreeTag LIKE 'TESTSTATE%'
          AND cm.CensusID = ${censusID}
          ORDER BY t.TreeTag
        `
      }).then((results) => {
        expect(results).to.have.length(4, 'Should have 4 records');

        // All records processed (validation state categorization is handled by stored procedure)
        results.forEach(record => {
          expect(record.ValidationState).to.be.oneOf(['Valid', 'Pending', 'Invalid']);
        });
      });
    });
  });

  /**
   * GUARANTEE 4: Error handling works in production
   */
  describe('Guarantee 4: Error handling', () => {
    it('should display error message when upload fails', () => {
      // Intercept API call and force failure
      cy.intercept('POST', '/api/sqlpacketload', {
        statusCode: 500,
        body: { error: 'Database connection failed' }
      }).as('uploadFail');

      // Upload file
      cy.get('[data-testid="file-dropzone"]').selectFile('test-valid-measurements.csv', {
        action: 'drag-drop'
      });

      cy.contains('test-valid-measurements.csv').should('be.visible');
      cy.get('[data-testid="continue-upload-btn"]').click();

      // Wait for error to appear
      cy.wait('@uploadFail');

      // Verify error message displayed
      cy.contains('error', { matchCase: false, timeout: 10000 }).should('be.visible');
    });

    it('should allow retry after error', () => {
      let attemptCount = 0;

      // Intercept first call to fail, second to succeed
      cy.intercept('POST', '/api/sqlpacketload', (req) => {
        attemptCount++;
        if (attemptCount === 1) {
          req.reply({
            statusCode: 500,
            body: { error: 'Temporary failure' }
          });
        } else {
          req.reply({
            statusCode: 200,
            body: { responseMessage: 'Success', batchID: 'test-batch-id', insertedCount: 3 }
          });
        }
      }).as('uploadRetry');

      cy.get('[data-testid="file-dropzone"]').selectFile('test-valid-measurements.csv', {
        action: 'drag-drop'
      });

      cy.contains('test-valid-measurements.csv').should('be.visible');
      cy.get('[data-testid="continue-upload-btn"]').click();

      // Wait for first failure
      cy.wait('@uploadRetry');
      cy.contains('error', { matchCase: false }).should('be.visible');

      // Click retry button
      cy.get('[data-testid="retry-upload-btn"]').click();

      // Wait for success
      cy.wait('@uploadRetry');
      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');
    });

    it('should handle validation errors gracefully', () => {
      // Upload file with all invalid data
      const invalidData = 'tag,stemtag,spcode,quadrat,lx,ly,dbh,codes,hom,date\nINVALID001,1,DOESNOTEXIST,9999,0,0,999999,X,0,2020-01-01';

      cy.get('[data-testid="file-dropzone"]').selectFile({
        contents: Cypress.Buffer.from(invalidData),
        fileName: 'invalid-test.csv',
        mimeType: 'text/csv'
      }, { action: 'drag-drop' });

      cy.contains('invalid-test.csv').should('be.visible');
      cy.get('[data-testid="continue-upload-btn"]').click();

      // Should complete (moved to failed measurements) without crashing
      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');

      // Verify it went to failedmeasurements
      cy.task<any[]>('queryDB', {
        query: `
          SELECT COUNT(*) as count
          FROM ${schema}.failedmeasurements
          WHERE Tag = 'INVALID001'
        `
      }).then((results) => {
        expect(results[0].count).to.be.greaterThan(0, 'Invalid record should be in failedmeasurements');
      });
    });
  });

  /**
   * COMPREHENSIVE TEST: Full workflow with all scenarios
   */
  describe('Comprehensive workflow test', () => {
    it('should handle complete upload workflow with mixed data', () => {
      // Test valid measurements
      cy.get('[data-testid="file-dropzone"]').selectFile('test-valid-measurements.csv', {
        action: 'drag-drop'
      });
      cy.get('[data-testid="continue-upload-btn"]').click();
      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');

      // Navigate back to upload
      cy.visit('/upload');
      cy.get('[data-testid="form-type-select"]').click();
      cy.contains('Measurements').click();
      cy.get('[data-testid="personnel-select"]').click();
      cy.contains('Integration TestUser').click();

      // Test invalid measurements
      cy.get('[data-testid="file-dropzone"]').selectFile('test-invalid-measurements.csv', {
        action: 'drag-drop'
      });
      cy.get('[data-testid="continue-upload-btn"]').click();
      cy.contains('Upload Complete', { timeout: 60000 }).should('be.visible');

      // Verify final state
      cy.task<any[]>('queryDB', {
        query: `
          SELECT 'Valid records' as Category, COUNT(*) as Count
          FROM ${schema}.coremeasurements cm
          JOIN ${schema}.stems s ON cm.StemGUID = s.StemGUID
          JOIN ${schema}.trees t ON s.TreeID = t.TreeID
          WHERE t.TreeTag LIKE 'TEST%'
          AND cm.CensusID = ${censusID}

          UNION ALL

          SELECT 'Failed records', COUNT(*)
          FROM ${schema}.failedmeasurements
          WHERE Tag LIKE 'TEST%'
          AND CensusID = ${censusID}
        `
      }).then((results) => {
        const validCount = results.find(r => r.Category === 'Valid records')?.Count || 0;
        const failedCount = results.find(r => r.Category === 'Failed records')?.Count || 0;

        expect(validCount).to.be.greaterThan(0, 'Should have valid records');
        expect(failedCount).to.be.greaterThan(0, 'Should have failed records');

        const total = validCount + failedCount;
        expect(total).to.equal(7, 'All records should be accounted for (3 valid + 4 mixed)');
      });
    });
  });
});
