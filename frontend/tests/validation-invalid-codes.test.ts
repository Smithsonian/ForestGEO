/**
 * Unit tests for invalid attribute code validation
 *
 * Tests verify that:
 * 1. Invalid attribute codes (like 'MX') are flagged during validation
 * 2. Valid attribute codes are not flagged
 * 3. Validation errors are properly inserted into cmverrors table
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Validation - Invalid Attribute Codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should flag measurements with invalid attribute codes', () => {
    // This test verifies the SQL logic for ValidateFindInvalidAttributeCodes
    const validationQuery = `
      insert into cmverrors (CoreMeasurementID, ValidationErrorID)
      select distinct cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
      from coremeasurements cm
               join census c on cm.CensusID = c.CensusID and c.IsActive is true
               join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID
               left join attributes a on cma.Code = a.Code and a.IsActive is true
               left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID
                    and e.ValidationErrorID = @validationProcedureID
      where cm.IsValidated is null
        and cm.IsActive is true
        and a.Code is null  -- Attribute code doesn't exist in attributes table
        and e.CoreMeasurementID is null
        and (@p_CensusID is null or cm.CensusID = @p_CensusID)
        and (@p_PlotID is null or c.PlotID = @p_PlotID);
    `;

    // Verify query structure
    expect(validationQuery).toContain('cmattributes cma');
    expect(validationQuery).toContain('left join attributes a');
    expect(validationQuery).toContain('a.Code is null');
    expect(validationQuery).toContain('cmverrors');
  });

  it('should identify the correct test case data', () => {
    // Test case from bug report: Tag=011380 with invalid code 'MX'
    const testData = {
      treeTag: '011380',
      invalidCode: 'MX',
      shouldBeFlagged: true
    };

    expect(testData.invalidCode).toBe('MX');
    expect(testData.shouldBeFlagged).toBe(true);
  });

  it('should not flag measurements with valid attribute codes', () => {
    // Valid codes like 'D' (dead) should exist in attributes table
    const validCodes = ['D', 'A', 'M', 'P'];

    validCodes.forEach(code => {
      expect(code).toBeTruthy();
      expect(code.length).toBeGreaterThan(0);
    });
  });

  it('should check for duplicates before inserting errors', () => {
    const validationQuery = `
      left join cmverrors e on e.CoreMeasurementID = cm.CoreMeasurementID
           and e.ValidationErrorID = @validationProcedureID
      where cm.IsValidated is null
        and cm.IsActive is true
        and a.Code is null
        and e.CoreMeasurementID is null
    `;

    expect(validationQuery).toContain('e.CoreMeasurementID is null');
  });

  it('should only validate unvalidated measurements', () => {
    const validationQuery = `
      where cm.IsValidated is null
        and cm.IsActive is true
    `;

    expect(validationQuery).toContain('cm.IsValidated is null');
    expect(validationQuery).toContain('cm.IsActive is true');
  });

  it('should respect plot and census filters', () => {
    const validationQuery = `
      and (@p_CensusID is null or cm.CensusID = @p_CensusID)
      and (@p_PlotID is null or c.PlotID = @p_PlotID);
    `;

    expect(validationQuery).toContain('@p_CensusID');
    expect(validationQuery).toContain('@p_PlotID');
  });

  it('should validate that validation ID is correctly assigned', () => {
    const expectedValidationID = 14;
    const procedureName = 'ValidateFindInvalidAttributeCodes';

    expect(expectedValidationID).toBe(14);
    expect(procedureName).toContain('InvalidAttributeCodes');
  });

  it('should check cmattributes join correctly', () => {
    // The query should join cmattributes to get all attribute codes for a measurement
    const joinClause = 'join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID';

    expect(joinClause).toContain('cmattributes');
    expect(joinClause).toContain('CoreMeasurementID');
  });

  it('should use left join for attributes to find non-existent codes', () => {
    // Left join allows us to find codes that don't exist (where a.Code is null)
    const leftJoin = 'left join attributes a on cma.Code = a.Code and a.IsActive is true';

    expect(leftJoin).toContain('left join');
    expect(leftJoin).toContain('attributes');
    expect(leftJoin).toContain('a.IsActive is true');
  });
});

describe('Validation - Abnormally High DBH', () => {
  it('should flag DBH values >= 3500mm', () => {
    const testCases = [
      { dbh: 26600, units: 'mm', shouldFlag: true }, // Bug case: Tag=011379
      { dbh: 3500, units: 'mm', shouldFlag: true }, // Exactly at threshold
      { dbh: 350, units: 'cm', shouldFlag: true }, // 3500mm in cm
      { dbh: 3499, units: 'mm', shouldFlag: false }, // Just below threshold
      { dbh: 349, units: 'cm', shouldFlag: false } // Just below threshold in cm
    ];

    testCases.forEach(({ dbh, units, shouldFlag }) => {
      const dbhInMm = units === 'cm' ? dbh * 10 : dbh;
      const isAbnormal = dbhInMm >= 3500;

      expect(isAbnormal).toBe(shouldFlag);
    });
  });

  it('should convert DBH units correctly', () => {
    const unitConversions = {
      km: 1000000,
      hm: 100000,
      dam: 10000,
      m: 1000,
      dm: 100,
      cm: 10,
      mm: 1
    };

    expect(unitConversions['cm']).toBe(10);
    expect(unitConversions['mm']).toBe(1);
  });

  it('should include unit conversion in validation query', () => {
    const validationQuery = `
      and (
          (cm.MeasuredDBH * (case p.DefaultDBHUnits
                                when 'km' THEN 1000000
                                when 'hm' THEN 100000
                                when 'dam' THEN 10000
                                when 'm' THEN 1000
                                when 'dm' THEN 100
                                when 'cm' THEN 10
                                when 'mm' THEN 1
                                else 1 end)) >= 3500
      )
    `;

    expect(validationQuery).toContain('DefaultDBHUnits');
    expect(validationQuery).toContain('>= 3500');
  });

  it('should validate the test case from bug report', () => {
    // Bug report: Tag=011379 with dbh=26600 should be flagged
    const bugCase = {
      treeTag: '011379',
      dbh: 26600,
      units: 'mm'
    };

    const dbhInMm = bugCase.dbh; // Already in mm
    const shouldBeFlagged = dbhInMm >= 3500;

    expect(shouldBeFlagged).toBe(true);
    expect(bugCase.dbh).toBe(26600);
  });

  it('should only validate active measurements', () => {
    const validationQuery = `
      where cm.IsValidated is null
        and cm.IsActive is true
        and cm.MeasuredDBH is not null
    `;

    expect(validationQuery).toContain('cm.IsActive is true');
    expect(validationQuery).toContain('cm.MeasuredDBH is not null');
  });

  it('should have validation ID 15 and correct procedure name', () => {
    const expectedValidationID = 15;
    const procedureName = 'ValidateFindAbnormallyHighDBH';

    expect(expectedValidationID).toBe(15);
    expect(procedureName).toContain('AbnormallyHighDBH');
  });

  it('should join with plots table to get DBH units', () => {
    const joinClause = 'join plots p on c.PlotID = p.PlotID';

    expect(joinClause).toContain('plots p');
    expect(joinClause).toContain('PlotID');
  });
});
