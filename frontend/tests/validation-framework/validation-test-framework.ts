/**
 * Validation Test Framework
 *
 * This framework provides a comprehensive testing system for validation queries
 * stored in the sitespecificvalidations table. It can:
 *
 * 1. Create test data for specific validation scenarios
 * 2. Execute validation queries
 * 3. Verify correct errors are flagged in cmverrors
 * 4. Clean up test data after testing
 *
 * Usage:
 * ```typescript
 * const tester = new ValidationTester(connection, 'test_schema');
 * await tester.testValidation(validationID, testScenario);
 * ```
 */

import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';

export interface ValidationTestScenario {
  name: string;
  description: string;
  setupData: TestDataSetup;
  expectedErrors: ExpectedValidationError[];
  expectedNoErrors?: ExpectedNoError[];
}

export interface TestDataSetup {
  plots?: Partial<Plot>[];
  census?: Partial<Census>[];
  quadrats?: Partial<Quadrat>[];
  species?: Partial<Species>[];
  trees?: Partial<Tree>[];
  stems?: Partial<Stem>[];
  coremeasurements?: Partial<CoreMeasurement>[];
  cmattributes?: Partial<CMAttribute>[];
  attributes?: Partial<Attribute>[];
}

export interface ExpectedValidationError {
  coreMeasurementID?: number;
  treeTag?: string;
  stemTag?: string;
  condition: string; // Description of why this should be flagged
}

export interface ExpectedNoError {
  coreMeasurementID?: number;
  treeTag?: string;
  stemTag?: string;
  condition: string; // Description of why this should NOT be flagged
}

// Type definitions matching database schema
export interface Plot {
  PlotID: number;
  PlotName: string;
  LocationName: string;
  DimensionX: number;
  DimensionY: number;
  GlobalX?: number;
  GlobalY?: number;
  DefaultDBHUnits?: string;
  DefaultHOMUnits?: string;
  IsActive: boolean;
}

export interface Census {
  CensusID: number;
  PlotID: number;
  StartDate: Date;
  EndDate: Date;
  PlotCensusNumber: number;
  IsActive: boolean;
}

export interface Quadrat {
  QuadratID: number;
  PlotID: number;
  QuadratName: string;
  DimensionX: number;
  DimensionY: number;
  StartX: number;
  StartY: number;
  IsActive: boolean;
}

export interface Species {
  SpeciesID: number;
  SpeciesCode: string;
  SpeciesName: string;
  IsActive: boolean;
}

export interface Tree {
  TreeID: number;
  TreeTag: string;
  SpeciesID: number;
  CensusID: number;
  IsActive: boolean;
}

export interface Stem {
  StemGUID: number | string; // Can be int or UUID depending on schema
  TreeID: number;
  QuadratID: number;
  CensusID: number;
  StemCrossID?: number | string; // Can be int or UUID depending on schema
  StemTag?: string;
  LocalX?: number;
  LocalY?: number;
  IsActive: boolean;
}

export interface CoreMeasurement {
  CoreMeasurementID: number;
  StemGUID: number | string; // Can be int or UUID depending on schema
  CensusID: number;
  MeasurementDate?: Date;
  MeasuredDBH?: number;
  MeasuredHOM?: number;
  IsValidated?: boolean;
  IsActive: boolean;
}

export interface CMAttribute {
  CMAID: number;
  CoreMeasurementID: number;
  Code: string;
}

export interface Attribute {
  Code: string;
  Description: string;
  Status: string;
  IsActive: boolean;
}

export interface ValidationTestResult {
  passed: boolean;
  validationID: number;
  validationName: string;
  scenarioName: string;
  expectedErrorCount: number;
  actualErrorCount: number;
  unexpectedErrors: any[];
  missedErrors: ExpectedValidationError[];
  falsePositives: any[];
  details: string[];
}

export class ValidationTester {
  private connection: mysql.Connection;
  private schema: string;
  private testDataIDs: Map<string, number[]> = new Map();
  private testStemGUIDs: (number | string)[] = [];
  private nextStemGUID = 1000000; // Use high numbers to avoid conflicts with existing data

  constructor(connection: mysql.Connection, schema: string) {
    this.connection = connection;
    this.schema = schema;
  }

  /**
   * Main test execution method
   */
  async testValidation(
    validationID: number,
    scenario: ValidationTestScenario,
    params?: { p_PlotID?: number; p_CensusID?: number; minDBH?: number; maxDBH?: number }
  ): Promise<ValidationTestResult> {
    const result: ValidationTestResult = {
      passed: false,
      validationID,
      validationName: '',
      scenarioName: scenario.name,
      expectedErrorCount: scenario.expectedErrors.length,
      actualErrorCount: 0,
      unexpectedErrors: [],
      missedErrors: [],
      falsePositives: [],
      details: []
    };

    try {
      // 1. Get validation details
      const [validations] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT ValidationID, ProcedureName, Description, Definition
         FROM ${this.schema}.sitespecificvalidations
         WHERE ValidationID = ?`,
        [validationID]
      );

      if (validations.length === 0) {
        throw new Error(`Validation ${validationID} not found`);
      }

      result.validationName = validations[0].ProcedureName;
      result.details.push(`Testing: ${result.validationName}`);
      result.details.push(`Scenario: ${scenario.name}`);

      // 2. Setup test data
      result.details.push('Setting up test data...');
      await this.setupTestData(scenario.setupData, params);

      // 3. Clear any existing errors for test data
      await this.clearTestErrors(validationID);

      // 4. Execute the validation query
      result.details.push('Executing validation query...');
      await this.executeValidation(validationID, validations[0].Definition, params);

      // 5. Verify results
      result.details.push('Verifying results...');
      const verificationResult = await this.verifyResults(validationID, scenario);

      result.actualErrorCount = verificationResult.totalErrors;
      result.unexpectedErrors = verificationResult.unexpectedErrors;
      result.missedErrors = verificationResult.missedErrors;
      result.falsePositives = verificationResult.falsePositives;

      // 6. Determine if test passed
      result.passed =
        result.missedErrors.length === 0 && result.falsePositives.length === 0 && result.unexpectedErrors.length === 0;

      if (result.passed) {
        result.details.push(`✓ Test PASSED: Found ${result.actualErrorCount} errors as expected`);
      } else {
        result.details.push(`✗ Test FAILED:`);
        if (result.missedErrors.length > 0) {
          result.details.push(`  - Missed ${result.missedErrors.length} expected errors`);
        }
        if (result.falsePositives.length > 0) {
          result.details.push(`  - ${result.falsePositives.length} false positives (should not be flagged)`);
        }
        if (result.unexpectedErrors.length > 0) {
          result.details.push(`  - ${result.unexpectedErrors.length} unexpected errors`);
        }
      }

      return result;
    } catch (error: any) {
      result.details.push(`ERROR: ${error.message}`);
      throw error;
    } finally {
      // 7. Cleanup test data
      await this.cleanupTestData();
    }
  }

  /**
   * Setup test data based on scenario
   */
  private async setupTestData(setup: TestDataSetup, params?: any): Promise<void> {
    const testID = uuidv4().substring(0, 8);

    // Setup in correct dependency order
    if (setup.attributes) {
      await this.insertAttributes(setup.attributes);
    }

    if (setup.species) {
      await this.insertSpecies(setup.species);
    }

    if (setup.plots) {
      await this.insertPlots(setup.plots, testID);
    }

    if (setup.census) {
      await this.insertCensus(setup.census, testID, params);
    }

    if (setup.quadrats) {
      await this.insertQuadrats(setup.quadrats, testID);
    }

    if (setup.trees) {
      await this.insertTrees(setup.trees, testID, params);
    }

    if (setup.stems) {
      await this.insertStems(setup.stems, testID);
    }

    if (setup.coremeasurements) {
      await this.insertCoreMeasurements(setup.coremeasurements, testID);
    }

    if (setup.cmattributes) {
      await this.insertCMAttributes(setup.cmattributes);
    }
  }

  /**
   * Insert helper methods for each table
   */
  private async insertPlots(plots: Partial<Plot>[], testID: string): Promise<void> {
    const ids: number[] = [];
    for (const plot of plots) {
      // Note: plots table doesn't have IsActive column in some schemas
      const [result] = await this.connection.query<mysql.ResultSetHeader>(
        `INSERT INTO ${this.schema}.plots
         (PlotName, LocationName, DimensionX, DimensionY, GlobalX, GlobalY, DefaultDBHUnits, DefaultHOMUnits)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plot.PlotName || `TEST_PLOT_${testID}`,
          plot.LocationName || `TEST_LOCATION`,
          plot.DimensionX || 100,
          plot.DimensionY || 100,
          plot.GlobalX || 0,
          plot.GlobalY || 0,
          plot.DefaultDBHUnits || 'mm',
          plot.DefaultHOMUnits || 'cm'
        ]
      );
      ids.push(result.insertId);
    }
    this.testDataIDs.set('plots', ids);
  }

  private async insertCensus(census: Partial<Census>[], testID: string, params?: any): Promise<void> {
    const ids: number[] = [];
    const plotIDs = this.testDataIDs.get('plots') || [];

    for (let i = 0; i < census.length; i++) {
      const c = census[i];
      const [result] = await this.connection.query<mysql.ResultSetHeader>(
        `INSERT INTO ${this.schema}.census
         (PlotID, StartDate, EndDate, PlotCensusNumber, IsActive)
         VALUES (?, ?, ?, ?, ?)`,
        [
          c.PlotID || plotIDs[0] || params?.p_PlotID || 1,
          c.StartDate || new Date('2020-01-01'),
          c.EndDate || new Date('2020-12-31'),
          c.PlotCensusNumber ?? i + 1,
          c.IsActive ?? true
        ]
      );
      ids.push(result.insertId);
    }
    this.testDataIDs.set('census', ids);
  }

  private async insertQuadrats(quadrats: Partial<Quadrat>[], testID: string): Promise<void> {
    const ids: number[] = [];
    const plotIDs = this.testDataIDs.get('plots') || [];

    for (const quadrat of quadrats) {
      const [result] = await this.connection.query<mysql.ResultSetHeader>(
        `INSERT INTO ${this.schema}.quadrats
         (PlotID, QuadratName, DimensionX, DimensionY, StartX, StartY, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          quadrat.PlotID || plotIDs[0] || 1,
          quadrat.QuadratName || `TEST_Q_${testID}`,
          quadrat.DimensionX || 20,
          quadrat.DimensionY || 20,
          quadrat.StartX || 0,
          quadrat.StartY || 0,
          quadrat.IsActive ?? true
        ]
      );
      ids.push(result.insertId);
    }
    this.testDataIDs.set('quadrats', ids);
  }

  private async insertSpecies(species: Partial<Species>[]): Promise<void> {
    const ids: number[] = [];
    for (const sp of species) {
      // Check if species already exists
      const [existing] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT SpeciesID FROM ${this.schema}.species WHERE SpeciesCode = ?`,
        [sp.SpeciesCode]
      );

      if (existing.length > 0) {
        ids.push(existing[0].SpeciesID);
      } else {
        const [result] = await this.connection.query<mysql.ResultSetHeader>(
          `INSERT INTO ${this.schema}.species (SpeciesCode, SpeciesName, IsActive)
           VALUES (?, ?, ?)`,
          [sp.SpeciesCode || 'TEST_SP', sp.SpeciesName || 'Test Species', sp.IsActive ?? true]
        );
        ids.push(result.insertId);
      }
    }
    this.testDataIDs.set('species', ids);
  }

  private async insertTrees(trees: Partial<Tree>[], testID: string, params?: any): Promise<void> {
    const ids: number[] = [];
    const censusIDs = this.testDataIDs.get('census') || [];
    const speciesIDs = this.testDataIDs.get('species') || [];

    for (const tree of trees) {
      // Check if we need to bypass FK constraints (for testing invalid species)
      const needsBypass = tree.SpeciesID && tree.SpeciesID > 90000; // High numbers indicate test for invalid species

      if (needsBypass) {
        await this.connection.query('SET FOREIGN_KEY_CHECKS = 0');
      }

      const [result] = await this.connection.query<mysql.ResultSetHeader>(
        `INSERT INTO ${this.schema}.trees (TreeTag, SpeciesID, CensusID, IsActive)
         VALUES (?, ?, ?, ?)`,
        [
          tree.TreeTag || `TEST_TREE_${testID}`,
          tree.SpeciesID || speciesIDs[0] || 1,
          tree.CensusID || censusIDs[0] || params?.p_CensusID || 1,
          tree.IsActive ?? true
        ]
      );

      if (needsBypass) {
        await this.connection.query('SET FOREIGN_KEY_CHECKS = 1');
      }

      ids.push(result.insertId);
    }
    this.testDataIDs.set('trees', ids);
  }

  private async insertStems(stems: Partial<Stem>[], testID: string): Promise<void> {
    const treeIDs = this.testDataIDs.get('trees') || [];
    const quadratIDs = this.testDataIDs.get('quadrats') || [];
    const censusIDs = this.testDataIDs.get('census') || [];

    for (const stem of stems) {
      // Generate unique StemGUID (integer for int schema, could be UUID for string schema)
      const stemGUID = stem.StemGUID || this.nextStemGUID++;
      const stemCrossID = stem.StemCrossID || stemGUID;

      await this.connection.query(
        `INSERT INTO ${this.schema}.stems
         (StemGUID, TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          stemGUID,
          stem.TreeID || treeIDs[0] || 1,
          stem.QuadratID || quadratIDs[0] || 1,
          stem.CensusID || censusIDs[0] || 1,
          stemCrossID,
          stem.StemTag || `TEST_STEM_${testID}`,
          stem.LocalX ?? 10,
          stem.LocalY ?? 10,
          stem.IsActive ?? true
        ]
      );
      this.testStemGUIDs.push(stemGUID);
    }
  }

  private async insertCoreMeasurements(measurements: Partial<CoreMeasurement>[], testID: string): Promise<void> {
    const ids: number[] = [];
    const censusIDs = this.testDataIDs.get('census') || [];

    for (const cm of measurements) {
      const [result] = await this.connection.query<mysql.ResultSetHeader>(
        `INSERT INTO ${this.schema}.coremeasurements
         (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM, IsValidated, IsActive)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          cm.StemGUID || this.testStemGUIDs[0],
          cm.CensusID || censusIDs[0] || 1,
          cm.MeasurementDate || new Date('2020-06-01'),
          cm.MeasuredDBH ?? null,
          cm.MeasuredHOM ?? null,
          cm.IsValidated ?? null,
          cm.IsActive ?? true
        ]
      );
      ids.push(result.insertId);
    }
    this.testDataIDs.set('coremeasurements', ids);
  }

  private async insertCMAttributes(cmattributes: Partial<CMAttribute>[]): Promise<void> {
    const cmIDs = this.testDataIDs.get('coremeasurements') || [];

    // Track which CoreMeasurementID gets which codes to handle unique constraints
    for (let i = 0; i < cmattributes.length; i++) {
      const cma = cmattributes[i];
      const coreMeasurementID = cma.CoreMeasurementID || cmIDs[i] || cmIDs[0];

      await this.connection.query(
        `INSERT INTO ${this.schema}.cmattributes (CoreMeasurementID, Code)
         VALUES (?, ?)`,
        [coreMeasurementID, cma.Code]
      );
    }
  }

  private async insertAttributes(attributes: Partial<Attribute>[]): Promise<void> {
    for (const attr of attributes) {
      // Check if exists first
      const [existing] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT Code FROM ${this.schema}.attributes WHERE Code = ?`,
        [attr.Code]
      );

      if (existing.length === 0) {
        await this.connection.query(
          `INSERT INTO ${this.schema}.attributes (Code, Description, Status, IsActive)
           VALUES (?, ?, ?, ?)`,
          [attr.Code || 'TEST', attr.Description || 'Test Attribute', attr.Status || 'alive', attr.IsActive ?? true]
        );
      }
    }
  }

  /**
   * Execute validation query with parameter replacement
   */
  private async executeValidation(
    validationID: number,
    queryDefinition: string,
    params?: { p_PlotID?: number; p_CensusID?: number; minDBH?: number; maxDBH?: number }
  ): Promise<void> {
    // Set validation procedure ID
    await this.connection.query(`SET @validationProcedureID = ?`, [validationID]);

    // Set parameters
    if (params) {
      if (params.p_PlotID !== undefined) {
        await this.connection.query(`SET @p_PlotID = ?`, [params.p_PlotID]);
      }
      if (params.p_CensusID !== undefined) {
        await this.connection.query(`SET @p_CensusID = ?`, [params.p_CensusID]);
      }
      if (params.minDBH !== undefined) {
        await this.connection.query(`SET @minDBH = ?`, [params.minDBH]);
      }
      if (params.maxDBH !== undefined) {
        await this.connection.query(`SET @maxDBH = ?`, [params.maxDBH]);
      }
    }

    // Execute the validation query
    await this.connection.query(queryDefinition);
  }

  /**
   * Verify results match expectations
   */
  private async verifyResults(
    validationID: number,
    scenario: ValidationTestScenario
  ): Promise<{
    totalErrors: number;
    unexpectedErrors: any[];
    missedErrors: ExpectedValidationError[];
    falsePositives: any[];
  }> {
    // Get all errors created by this validation for test data
    const [errors] = await this.connection.query<mysql.RowDataPacket[]>(
      `SELECT e.CoreMeasurementID, cm.StemGUID, t.TreeTag, s.StemTag
       FROM ${this.schema}.cmverrors e
       JOIN ${this.schema}.coremeasurements cm ON e.CoreMeasurementID = cm.CoreMeasurementID
       JOIN ${this.schema}.stems s ON cm.StemGUID = s.StemGUID
       JOIN ${this.schema}.trees t ON s.TreeID = t.TreeID
       WHERE e.ValidationErrorID = ?
         AND cm.CoreMeasurementID IN (${this.testDataIDs.get('coremeasurements')?.join(',') || '0'})`,
      [validationID]
    );

    const totalErrors = errors.length;
    const unexpectedErrors: any[] = [];
    const missedErrors: ExpectedValidationError[] = [...scenario.expectedErrors];
    const falsePositives: any[] = [];

    // Check each error against expected errors
    for (const error of errors) {
      const matchIndex = missedErrors.findIndex(
        expected =>
          (expected.coreMeasurementID && expected.coreMeasurementID === error.CoreMeasurementID) ||
          (expected.treeTag && expected.treeTag === error.TreeTag) ||
          (expected.stemTag && expected.stemTag === error.StemTag)
      );

      if (matchIndex >= 0) {
        // Expected error found
        missedErrors.splice(matchIndex, 1);
      } else {
        // Unexpected error
        unexpectedErrors.push(error);
      }
    }

    // Check for false positives (things that should NOT be flagged but were)
    if (scenario.expectedNoErrors) {
      for (const noError of scenario.expectedNoErrors) {
        const found = errors.find(
          error =>
            (noError.coreMeasurementID && noError.coreMeasurementID === error.CoreMeasurementID) ||
            (noError.treeTag && noError.treeTag === error.TreeTag) ||
            (noError.stemTag && noError.stemTag === error.StemTag)
        );

        if (found) {
          falsePositives.push({ ...found, expectedCondition: noError.condition });
        }
      }
    }

    return { totalErrors, unexpectedErrors, missedErrors, falsePositives };
  }

  /**
   * Clear test errors before running validation
   */
  private async clearTestErrors(validationID: number): Promise<void> {
    const cmIDs = this.testDataIDs.get('coremeasurements') || [];
    if (cmIDs.length > 0) {
      await this.connection.query(
        `DELETE FROM ${this.schema}.cmverrors
         WHERE ValidationErrorID = ?
           AND CoreMeasurementID IN (${cmIDs.join(',')})`,
        [validationID]
      );
    }
  }

  /**
   * Cleanup all test data
   */
  private async cleanupTestData(): Promise<void> {
    try {
      // Delete in reverse dependency order
      const cmIDs = this.testDataIDs.get('coremeasurements') || [];
      if (cmIDs.length > 0) {
        await this.connection.query(`DELETE FROM ${this.schema}.cmattributes WHERE CoreMeasurementID IN (${cmIDs.join(',')})`);
        await this.connection.query(`DELETE FROM ${this.schema}.cmverrors WHERE CoreMeasurementID IN (${cmIDs.join(',')})`);
        await this.connection.query(`DELETE FROM ${this.schema}.coremeasurements WHERE CoreMeasurementID IN (${cmIDs.join(',')})`);
      }

      if (this.testStemGUIDs.length > 0) {
        // Handle both integer and string StemGUIDs
        const guids = this.testStemGUIDs.map(g => (typeof g === 'string' ? `'${g}'` : g)).join(',');
        await this.connection.query(`DELETE FROM ${this.schema}.stems WHERE StemGUID IN (${guids})`);
      }

      const treeIDs = this.testDataIDs.get('trees') || [];
      if (treeIDs.length > 0) {
        await this.connection.query(`DELETE FROM ${this.schema}.trees WHERE TreeID IN (${treeIDs.join(',')})`);
      }

      const quadratIDs = this.testDataIDs.get('quadrats') || [];
      if (quadratIDs.length > 0) {
        await this.connection.query(`DELETE FROM ${this.schema}.quadrats WHERE QuadratID IN (${quadratIDs.join(',')})`);
      }

      const censusIDs = this.testDataIDs.get('census') || [];
      if (censusIDs.length > 0) {
        await this.connection.query(`DELETE FROM ${this.schema}.census WHERE CensusID IN (${censusIDs.join(',')})`);
      }

      const plotIDs = this.testDataIDs.get('plots') || [];
      if (plotIDs.length > 0) {
        await this.connection.query(`DELETE FROM ${this.schema}.plots WHERE PlotID IN (${plotIDs.join(',')})`);
      }

      // Clear tracking maps
      this.testDataIDs.clear();
      this.testStemGUIDs = [];
    } catch (error: any) {
      console.error('Error during cleanup:', error.message);
    }
  }
}
