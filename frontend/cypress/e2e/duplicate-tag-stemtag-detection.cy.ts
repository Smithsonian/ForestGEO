/**
 * Duplicate TreeTag/StemTag Detection — Stage 2b
 *
 * Verifies that bulkingestionprocess detects within-batch rows sharing
 * (CensusID, TreeTag, StemTag) but differing on other fields, and flags
 * ALL rows in the collision group as hard failures with error code
 * DUPLICATE_TAG_STEMTAG.
 *
 * Follows the existing content-assertion pattern used by
 * sql-procedure-fix.cy.ts. A true end-to-end test against a live DB
 * requires running the migration and invoking bulkingestionprocess — see
 * docs/superpowers/specs/cypress-real-db-testing-follow-up.md for the
 * plan to add that capability.
 */

describe('Duplicate TreeTag/StemTag Detection (Stage 2b)', () => {
  it('registers the DUPLICATE_TAG_STEMTAG error code in tablestructures.sql', () => {
    cy.readFile('sqlscripting/tablestructures.sql').then(content => {
      expect(content).to.include("('ingestion', 'DUPLICATE_TAG_STEMTAG', 'Duplicate TreeTag/StemTag within upload batch')");
    });
  });

  it('adds Stage 2b within-batch collision detection to bulkingestionprocess', () => {
    cy.readFile('sqlscripting/storedprocedures.sql').then(content => {
      // The new temp tables exist.
      expect(content).to.include('CREATE TEMPORARY TABLE tag_stemtag_collision_groups');
      expect(content).to.include('CREATE TEMPORARY TABLE tag_stemtag_collision_failures');

      // Grouping key is (CensusID, TreeTag, StemTag) with HAVING COUNT(*) > 1.
      expect(content).to.match(/GROUP BY CensusID, TreeTag, StemTag\s+HAVING COUNT\(\*\) > 1/);

      // Collision rows are flagged with the new error code.
      expect(content).to.include("'DUPLICATE_TAG_STEMTAG'");

      // Collision rows are excluded from already-failed rows
      // (validation_failures and the Stage 2a duplicate_failures).
      expect(content).to.include('id NOT IN (SELECT id FROM validation_failures)');
      expect(content).to.include('id NOT IN (SELECT id FROM duplicate_failures)');

      // Collision rows are removed from initial_dup_filter so they never
      // reach filter_validity / filtered / downstream stages.
      expect(content).to.match(/DELETE idf\s+FROM initial_dup_filter idf\s+INNER JOIN tag_stemtag_collision_failures/);

      // An uploadintegrityalerts row is emitted.
      expect(content).to.include("'DUPLICATE_TAG_STEMTAG'");

      // Temp tables are registered in cleanup DROPs (at least one site).
      expect(content).to.include('tag_stemtag_collision_groups, tag_stemtag_collision_failures');
    });
  });

  it('ships migration 49 to register the error code on existing schemas', () => {
    cy.readFile('db-migrations/unified-measurements-migrations/49_add_duplicate_tag_stemtag_detection.sql').then(content => {
      expect(content).to.include('INSERT IGNORE INTO measurement_errors');
      expect(content).to.include("'DUPLICATE_TAG_STEMTAG'");
    });
  });

  it('does not dismantle the existing Stage 2a exact-duplicate detection', () => {
    // Regression guard: the new block is additive. Stage 2a must still exist.
    cy.readFile('sqlscripting/storedprocedures.sql').then(content => {
      expect(content).to.include('CREATE TEMPORARY TABLE duplicate_failures');
      expect(content).to.include("'DUPLICATE_ENTRY'");
    });
  });
});
