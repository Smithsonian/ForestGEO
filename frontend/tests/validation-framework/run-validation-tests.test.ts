/**
 * Validation Tests Runner
 *
 * Executes comprehensive tests for all validation queries in sitespecificvalidations table.
 *
 * Usage:
 * ```bash
 * npm run test:validations
 * ```
 *
 * NOTE: Requires database connection. Tests will be skipped if database is unavailable.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mysql from 'mysql2/promise';
import { ValidationTester, ValidationTestResult } from './validation-test-framework';
import { allValidationScenarios } from './validation-scenarios';

const dbConfig = {
  host: process.env.AZURE_SQL_SERVER || 'forestgeo-mysqldataserver.mysql.database.azure.com',
  user: process.env.AZURE_SQL_USER || 'azureroot',
  password: process.env.AZURE_SQL_PASSWORD || 'P@ssw0rd',
  port: parseInt(process.env.AZURE_SQL_PORT || '3306'),
  database: process.env.AZURE_SQL_SCHEMA || 'forestgeo_testing'
};

describe('Validation Query Tests', () => {
  let connection: mysql.Connection;
  let dbAvailable = false;
  let tester: ValidationTester;

  beforeAll(async () => {
    try {
      // Log connection attempt for debugging
      console.log('\n🔍 Attempting database connection...');
      console.log(`  Host: ${dbConfig.host}`);
      console.log(`  User: ${dbConfig.user}`);
      console.log(`  Database: ${dbConfig.database}`);
      console.log(`  Port: ${dbConfig.port}\n`);

      connection = await mysql.createConnection(dbConfig);
      dbAvailable = true;
      tester = new ValidationTester(connection, dbConfig.database);
      console.log(`✓ Connected to database: ${dbConfig.database}\n`);
    } catch (error: any) {
      console.warn('\n⚠ Database not available for testing. Skipping validation tests.');
      console.warn(`  Error: ${error.message || error.code || 'Unknown error'}`);
      if (error.errno) console.warn(`  Error Code: ${error.errno}`);
      console.warn(`  Stack: ${error.stack}\n`);
      console.warn('💡 To run validation tests:');
      console.warn('  1. Create .env.local file with database credentials');
      console.warn('  2. Set: AZURE_SQL_SERVER, AZURE_SQL_USER, AZURE_SQL_PASSWORD, AZURE_SQL_SCHEMA');
      console.warn('  3. Use a testing schema (NOT production!)\n');
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  /**
   * Validation 1: DBH Growth Exceeds Maximum Rate
   */
  describe('Validation 1: DBH Growth Exceeds Max (65mm)', () => {
    const validationID = 1;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        // Log details
        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        // Assertions
        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Validation 2: DBH Shrinkage Exceeds Maximum Rate
   */
  describe('Validation 2: DBH Shrinkage Exceeds Max (5%)', () => {
    const validationID = 2;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Validation 3: Invalid Species Codes
   */
  describe('Validation 3: Invalid Species Codes', () => {
    const validationID = 3;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Validation 6: Measurement Date Outside Census Bounds
   */
  describe('Validation 6: Measurement Date Outside Census Bounds', () => {
    const validationID = 6;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Validation 8: Stems Outside Plot Boundaries
   */
  describe('Validation 8: Stems Outside Plot Boundaries', () => {
    const validationID = 8;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Validation 14: Invalid Attribute Codes
   */
  describe('Validation 14: Invalid Attribute Codes', () => {
    const validationID = 14;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Validation 15: Abnormally High DBH Values
   */
  describe('Validation 15: Abnormally High DBH (>= 3500mm)', () => {
    const validationID = 15;
    const scenarios = allValidationScenarios.get(validationID) || [];

    scenarios.forEach(scenario => {
      it(scenario.name, async () => {
        if (!dbAvailable) {
          console.warn('Skipping: Database not available');
          return;
        }

        // Don't pass census/plot parameters - let validation run on all data including test data
        const params = undefined;

        const result = await tester.testValidation(validationID, scenario, params);

        console.log(`\n  ${scenario.name}:`);
        result.details.forEach(detail => console.log(`    ${detail}`));

        expect(result.passed).toBe(true);
        expect(result.missedErrors).toHaveLength(0);
        expect(result.falsePositives).toHaveLength(0);
      });
    });
  });

  /**
   * Summary Test: Run all validations and report overall status
   */
  describe('Summary: All Validation Tests', () => {
    it('should provide summary of all validation test results', { timeout: 30000 }, async () => {
      if (!dbAvailable) {
        console.warn('Skipping: Database not available');
        return;
      }

      console.log('\n═══════════════════════════════════════════════════');
      console.log('           VALIDATION TEST SUMMARY');
      console.log('═══════════════════════════════════════════════════\n');

      let totalTests = 0;
      let passedTests = 0;
      let failedTests = 0;
      const results: ValidationTestResult[] = [];

      // Don't pass census/plot parameters - let validation run on all data including test data
      const params = undefined;

      for (const [validationID, scenarios] of allValidationScenarios.entries()) {
        console.log(`\nValidation ${validationID}:`);

        for (const scenario of scenarios) {
          totalTests++;
          const result = await tester.testValidation(validationID, scenario, params);
          results.push(result);

          if (result.passed) {
            passedTests++;
            console.log(`  ✓ ${scenario.name}`);
          } else {
            failedTests++;
            console.log(`  ✗ ${scenario.name}`);
            console.log(`    - Missed: ${result.missedErrors.length}`);
            console.log(`    - False Positives: ${result.falsePositives.length}`);
          }
        }
      }

      console.log('\n═══════════════════════════════════════════════════');
      console.log(`Total Tests: ${totalTests}`);
      console.log(`Passed: ${passedTests}`);
      console.log(`Failed: ${failedTests}`);
      console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
      console.log('═══════════════════════════════════════════════════\n');

      // Test should pass if all individual tests pass
      expect(failedTests).toBe(0);
    });
  });
});
