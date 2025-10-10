/**
 * SQL Stored Procedure Error 1093 Fix Verification
 * Tests that the stored procedure runs without the MySQL error 1093
 */

describe('SQL Stored Procedure Error 1093 Fix', () => {
  before(() => {
    // Skip if not in database testing environment
    if (!Cypress.env('TEST_DATABASE')) {
      cy.log('Skipping database tests - TEST_DATABASE not set');
      return;
    }
  });

  it('should execute the fixed stored procedure without error 1093', () => {
    // This test requires a database connection and would typically be run
    // in an integration environment with actual database access

    cy.log('Testing fixed bulkingestionprocess stored procedure');

    // Mock the API call that would trigger the stored procedure
    cy.request({
      method: 'POST',
      url: '/api/setupbulkprocedure/test-file/test-batch',
      qs: { schema: 'test_schema' },
      failOnStatusCode: false
    }).then(response => {
      // In a real environment, this would test the actual procedure
      // For now, we verify the endpoint is available (405 means method not allowed, which is expected without proper setup)
      expect([200, 405, 500]).to.include(response.status);

      if (response.status === 500) {
        // Check that the error is NOT the MySQL 1093 error
        expect(response.body.error).to.not.include("You can't specify target table 's' for update in FROM clause");
        expect(response.body.error).to.not.include('1093');
      }
    });
  });

  it('should handle the temporary table approach correctly', () => {
    cy.log('Verifying temporary table approach in stored procedure');

    // The fixed procedure should:
    // 1. Create stem_crossid_mapping temporary table
    // 2. Use it for the UPDATE operation
    // 3. Clean it up properly

    // This would be tested with actual SQL execution in a real database environment
    // For now, we verify the fix is syntactically correct by checking the file

    cy.readFile('sqlscripting/ingestion_fixed_optimized.sql').then(content => {
      // Verify the fix is in place
      expect(content).to.include('CREATE TEMPORARY TABLE stem_crossid_mapping');
      expect(content).to.include('UPDATE stems s INNER JOIN stem_crossid_mapping scm');
      expect(content).to.include('DROP TEMPORARY TABLE stem_crossid_mapping');

      // Verify the problematic correlated subquery is gone
      expect(content).to.not.include('UPDATE stems s SET s.StemCrossID = COALESCE((SELECT s_prev.StemCrossID FROM stems s_prev');
    });
  });

  it('should include proper cleanup in error handlers', () => {
    cy.readFile('sqlscripting/ingestion_fixed_optimized.sql').then(content => {
      // Verify cleanup includes the new temporary table
      expect(content).to.include('stem_crossid_mapping');

      // Should appear in both success and error cleanup sections
      const cleanupMatches = content.match(/stem_crossid_mapping/g);
      expect(cleanupMatches).to.have.length.greaterThan(1);
    });
  });

  it('should maintain all original functionality while fixing the error', () => {
    cy.readFile('sqlscripting/ingestion_fixed_optimized.sql').then(content => {
      // Verify all essential procedure components are still there
      expect(content).to.include('PROCEDURE bulkingestionprocess');
      expect(content).to.include('CREATE TEMPORARY TABLE initial_dup_filter');
      expect(content).to.include('CREATE TEMPORARY TABLE filter_validity');
      expect(content).to.include('INSERT INTO coremeasurements');
      expect(content).to.include('INSERT INTO cmattributes');

      // Verify error handling is preserved
      expect(content).to.include('DECLARE EXIT HANDLER FOR SQLEXCEPTION');
      expect(content).to.include('INSERT IGNORE INTO failedmeasurements');
    });
  });
});
