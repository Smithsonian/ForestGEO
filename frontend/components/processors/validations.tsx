import { getConn, runQuery } from './processormacros';

// Define the enum for DBH units
enum DBHUnits {
  km = 'km',
  hm = 'hm',
  dam = 'dam',
  m = 'm',
  dm = 'dm',
  cm = 'cm',
  mm = 'mm'
}

// Map the units to their conversion factors
const unitConversionFactors: Record<DBHUnits, number> = {
  km: 1000000,
  hm: 100000,
  dam: 10000,
  m: 1000,
  dm: 100,
  cm: 10,
  mm: 1
};

export async function validateDBHGrowthExceedsMax(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateDBHGrowthExceedsMax';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    const cursorQuery = `
            SELECT 
                cm2.CoreMeasurementID, 
                cm1.MeasuredDBH AS vPrevDBH, 
                cm2.MeasuredDBH AS vCurrDBH, 
                cm1.DBHUnit AS vPrevDBHUnit, 
                cm2.DBHUnit AS vCurrDBHUnit
            FROM coremeasurements cm1
            JOIN coremeasurements cm2 
                ON cm1.StemID = cm2.StemID 
                AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
            LEFT JOIN stems st2 
                ON cm2.StemID = st2.StemID
            LEFT JOIN quadrats q 
                ON st2.QuadratID = q.QuadratID
            LEFT JOIN cmattributes cma 
                ON cm1.CoreMeasurementID = cma.CoreMeasurementID
            LEFT JOIN attributes a 
                ON cma.Code = a.Code
            WHERE 
                (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
                AND cm1.MeasuredDBH IS NOT NULL
                AND cm2.MeasuredDBH IS NOT NULL
                AND cm1.IsValidated IS TRUE
                AND cm2.IsValidated IS FALSE
                AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
                AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID, vPrevDBH, vCurrDBH, vPrevDBHUnit, vCurrDBHUnit } = row;

      expectedCount++;

      // Type assertions for the DBH unit
      const prevDBHUnit = vPrevDBHUnit as DBHUnits;
      const currDBHUnit = vCurrDBHUnit as DBHUnits;

      // Convert DBH values to millimeters
      const prevDBHInMM = vPrevDBH * (unitConversionFactors[prevDBHUnit] || 1);
      const currDBHInMM = vCurrDBH * (unitConversionFactors[currDBHUnit] || 1);

      // Check if growth exceeds 65mm
      if (currDBHInMM - prevDBHInMM > 65) {
        const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
        const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

        if (errorCheckResult.length === 0) {
          insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
          insertErrorParams.push(CoreMeasurementID, veID);

          insertCount++;
        }

        logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Growth exceeds max threshold.',
                              'Annual DBH Growth', ?, 'Growth <= 65', 'Checked for excessive DBH growth over a year');
                `);
        logValidationParams.push(
          'ValidateDBHGrowthExceedsMax',
          CoreMeasurementID,
          `Previous DBH: ${vPrevDBH} ${vPrevDBHUnit}, Current DBH: ${vCurrDBH} ${vCurrDBHUnit}`
        );
      }
    }

    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Growth validation:', error.message);
    throw new Error('DBH Growth validation failed. Please check the logs for more details.');
  } finally {
    if (conn) conn.release();
  }
}

export async function validateDBHShrinkageExceedsMax(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateDBHShrinkageExceedsMax';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to fetch all relevant measurement pairs
    const cursorQuery = `
            SELECT 
                cm2.CoreMeasurementID, 
                cm1.MeasuredDBH AS vPrevDBH, 
                cm2.MeasuredDBH AS vCurrDBH, 
                cm1.DBHUnit AS vPrevDBHUnit, 
                cm2.DBHUnit AS vCurrDBHUnit
            FROM coremeasurements cm1
            JOIN coremeasurements cm2 
                ON cm1.StemID = cm2.StemID 
                AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
            LEFT JOIN stems st 
                ON cm2.StemID = st.StemID
            LEFT JOIN quadrats q 
                ON st.QuadratID = q.QuadratID
            LEFT JOIN cmattributes cma 
                ON cm1.CoreMeasurementID = cma.CoreMeasurementID
            LEFT JOIN attributes a 
                ON cma.Code = a.Code
            WHERE 
                (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
                AND cm1.MeasuredDBH IS NOT NULL
                AND cm2.MeasuredDBH IS NOT NULL
                AND cm1.IsValidated IS TRUE
                AND cm2.IsValidated IS FALSE
                AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
                AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID, vPrevDBH, vCurrDBH, vPrevDBHUnit, vCurrDBHUnit } = row;
      expectedCount++;

      // Type assertions for the DBH unit
      const prevDBHUnit = vPrevDBHUnit as DBHUnits;
      const currDBHUnit = vCurrDBHUnit as DBHUnits;

      // Convert DBH values to millimeters
      const prevDBHInMM = vPrevDBH * (unitConversionFactors[prevDBHUnit] || 1);
      const currDBHInMM = vCurrDBH * (unitConversionFactors[currDBHUnit] || 1);

      // Check if shrinkage exceeds 5%
      if (currDBHInMM < prevDBHInMM * 0.95) {
        // Check if validation error already exists
        const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
        const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

        if (errorCheckResult.length === 0) {
          // Queue insertion of validation error
          insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
          insertErrorParams.push(CoreMeasurementID, veID);

          insertCount++;
        }

        // Queue insertion into validationchangelog
        logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Shrinkage exceeds maximum allowed threshold.',
                              'Annual DBH Shrinkage', ?, 'Shrinkage < 5% of previous DBH', 'Checked for excessive DBH shrinkage over a year');
                `);
        logValidationParams.push(
          'ValidateDBHShrinkageExceedsMax',
          CoreMeasurementID,
          `Previous DBH: ${vPrevDBH} ${vPrevDBHUnit}, Current DBH: ${vCurrDBH} ${vCurrDBHUnit}`
        );
      }
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Shrinkage validation:', error.message);
    throw new Error('DBH Shrinkage validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindAllInvalidSpeciesCodes(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindAllInvalidSpeciesCodes';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to fetch all relevant measurements with invalid species codes
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
            FROM stems s
            JOIN trees t ON s.TreeID = t.TreeID
            LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
            JOIN coremeasurements cm ON s.StemID = cm.StemID
            LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
            WHERE sp.SpeciesID IS NULL
              AND cm.IsValidated IS FALSE
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`})
            GROUP BY cm.CoreMeasurementID;
        `;

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Invalid species code detected.',
                              'Species Code Validation', 'Species ID: NULL',
                              'Non-null and valid Species ID',
                              'Checking for the existence of valid species codes for each measurement.');
                `);
      logValidationParams.push('ValidateFindAllInvalidSpeciesCodes', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Species Code validation:', error.message);
    throw new Error('Species Code validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindDuplicateStemTreeTagCombinationsPerCensus(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindDuplicateStemTreeTagCombinationsPerCensus';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to fetch all relevant measurements with duplicate stem-tree tag combinations
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
            FROM coremeasurements cm
            INNER JOIN stems s ON cm.StemID = s.StemID
            INNER JOIN trees t ON s.TreeID = t.TreeID
            INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
            WHERE (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`})
              AND cm.IsValidated = FALSE
            GROUP BY q.CensusID, s.StemTag, t.TreeTag, cm.CoreMeasurementID
            HAVING COUNT(cm.CoreMeasurementID) > 1;
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Duplicate stem and tree tag combination detected.',
                              'Duplicate Stem-Tree Tag Combinations per Census', 'N/A',
                              'Unique Stem-Tree Tag Combinations',
                              'Checking for duplicate stem and tree tag combinations in each census.');
                `);
      logValidationParams.push('ValidateFindDuplicateStemTreeTagCombinationsPerCensus', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Duplicate Stem-Tree Tag validation:', error.message);
    throw new Error('Duplicate Stem-Tree Tag validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindDuplicatedQuadratsByName(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindDuplicatedQuadratsByName';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to fetch all relevant measurements with duplicated quadrat names
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
            FROM quadrats q
            LEFT JOIN stems st ON q.QuadratID = st.QuadratID
            JOIN coremeasurements cm ON st.StemID = cm.StemID
            WHERE cm.IsValidated IS FALSE
              AND (q.PlotID, q.QuadratName) IN (
                  SELECT PlotID, QuadratName
                  FROM quadrats
                  GROUP BY PlotID, QuadratName
                  HAVING COUNT(*) > 1
              )
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`})
            GROUP BY cm.CoreMeasurementID;
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Duplicated quadrat name detected.',
                              'Quadrat Name Duplication', 'N/A',
                              'Unique Quadrat Names per Plot', 'Checking for duplicated quadrat names within the same plot.');
                `);
      logValidationParams.push('ValidateFindDuplicatedQuadratsByName', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Quadrat Name Duplication validation:', error.message);
    throw new Error('Quadrat Name Duplication validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to fetch all relevant measurements outside census date bounds
    const cursorQuery = `
            SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID
            FROM coremeasurements cm
            JOIN stems st ON cm.StemID = st.StemID
            JOIN quadrats q ON st.QuadratID = q.QuadratID
            JOIN census c ON q.CensusID = c.CensusID
            WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
              AND cm.MeasurementDate IS NOT NULL
              AND cm.IsValidated IS FALSE
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `c.PlotID = ?` : `1=1`})
            GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate;
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Measurement outside census date bounds.',
                              'Measurement Date vs Census Date Bounds', 'Measurement Date',
                              'Within Census Start and End Dates',
                              'Checking if measurement dates fall within the start and end dates of their respective censuses.');
                `);
      logValidationParams.push('ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Measurement Date validation:', error.message);
    throw new Error('Measurement Date validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindStemsInTreeWithDifferentSpecies(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindStemsInTreeWithDifferentSpecies';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to find stems in the same tree with different species
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
            FROM coremeasurements cm
            JOIN stems s ON cm.StemID = s.StemID
            JOIN trees t ON s.TreeID = t.TreeID
            JOIN quadrats q ON s.QuadratID = q.QuadratID
            WHERE cm.IsValidated = FALSE
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`})
            GROUP BY t.TreeID, cm.CoreMeasurementID
            HAVING COUNT(DISTINCT t.SpeciesID) > 1;
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Stems in the same tree have different species.',
                              'Species consistency across tree stems', 'One species per tree',
                              'One species per tree', 'Checking if stems belonging to the same tree have different species IDs.');
                `);
      logValidationParams.push('ValidateFindStemsInTreeWithDifferentSpecies', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Species Consistency validation:', error.message);
    throw new Error('Species Consistency validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindStemsOutsidePlots(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindStemsOutsidePlots';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to find stems outside plot dimensions
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
            FROM stems s
            INNER JOIN coremeasurements cm ON s.StemID = cm.StemID
            INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
            INNER JOIN plots p ON q.PlotID = p.PlotID
            WHERE (s.LocalX > p.DimensionX OR s.LocalY > p.DimensionY)
              AND s.LocalX IS NOT NULL
              AND s.LocalY IS NOT NULL
              AND p.DimensionX > 0
              AND p.DimensionY > 0
              AND cm.IsValidated IS FALSE
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`})
            GROUP BY cm.CoreMeasurementID;
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Stem is outside plot dimensions.',
                              'Stem Placement within Plot Boundaries', 'Stem Plot Coordinates',
                              'Within Plot Dimensions', 'Validating whether stems are located within the specified plot dimensions.');
                `);
      logValidationParams.push('ValidateFindStemsOutsidePlots', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem Placement validation:', error.message);
    throw new Error('Stem Placement validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateFindTreeStemsInDifferentQuadrats(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateFindTreeStemsInDifferentQuadrats';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to find tree stems located in different quadrats
    const cursorQuery = `
            SELECT cm1.CoreMeasurementID
            FROM stems s1
            JOIN stems s2 ON s1.TreeID = s2.TreeID AND s1.StemID != s2.StemID
            JOIN quadrats q1 ON s1.QuadratID = q1.QuadratID
            JOIN quadrats q2 ON s2.QuadratID = q2.QuadratID
            JOIN coremeasurements cm1 ON s1.StemID = cm1.StemID
            WHERE q1.QuadratID != q2.QuadratID
              AND cm1.IsValidated IS FALSE
              AND (${p_CensusID !== null ? `q1.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q1.PlotID = ?` : `1=1`})
            GROUP BY cm1.CoreMeasurementID;
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Stems in the same tree are in different quadrats.',
                              'Stem Quadrat Consistency within Trees', 'Quadrat IDs of Stems',
                              'Consistent Quadrat IDs for all Stems in a Tree',
                              'Validating that all stems within the same tree are located in the same quadrat.');
                `);
      logValidationParams.push('ValidateFindTreeStemsInDifferentQuadrats', CoreMeasurementID);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem Quadrat Consistency validation:', error.message);
    throw new Error('Stem Quadrat Consistency validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

// Enum for HOM units
enum HOMUnits {
  km = 'km',
  hm = 'hm',
  dam = 'dam',
  m = 'm',
  dm = 'dm',
  cm = 'cm',
  mm = 'mm'
}

// Map the units to their conversion factors to meters
const unitConversionFactorsHOM: Record<HOMUnits, number> = {
  km: 1000,
  hm: 100,
  dam: 10,
  m: 1,
  dm: 0.1,
  cm: 0.01,
  mm: 0.001
};

export async function validateHOMUpperAndLowerBounds(p_CensusID: number | null, p_PlotID: number | null, minHOM: number | null, maxHOM: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateHOMUpperAndLowerBounds';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to find measurements outside the HOM bounds
    const cursorQuery = `
            SELECT cm.CoreMeasurementID, cm.MeasuredHOM, cm.HOMUnit
            FROM coremeasurements cm
            LEFT JOIN stems st ON cm.StemID = st.StemID
            LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
            WHERE (
                (${minHOM !== null ? `cm.MeasuredHOM < ?` : `1=0`}) OR
                (${maxHOM !== null ? `cm.MeasuredHOM > ?` : `1=0`})
            )
            AND cm.IsValidated IS FALSE
            AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
            AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams: any[] = [];
    if (minHOM !== null) cursorParams.push(minHOM);
    if (maxHOM !== null) cursorParams.push(maxHOM);
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID, MeasuredHOM, HOMUnit } = row;
      expectedCount++;

      // Convert HOM to meters
      const homUnit = HOMUnit as HOMUnits;
      const measuredHOMInMeters = MeasuredHOM * (unitConversionFactorsHOM[homUnit] || 1);

      const validationCriteria = 'HOM Measurement Range Validation';
      const measuredValue = `Measured HOM: ${measuredHOMInMeters} meters`;
      const expectedValueRange = `Expected HOM Range: ${minHOM} - ${maxHOM} meters`;
      const additionalDetails = 'Checks if the measured HOM falls within the specified minimum and maximum range in meters.';

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
                `);
      logValidationParams.push(
        'ValidateHOMUpperAndLowerBounds',
        CoreMeasurementID,
        `HOM outside bounds: ${minHOM} - ${maxHOM} meters`,
        validationCriteria,
        measuredValue,
        expectedValueRange,
        additionalDetails
      );
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during HOM Bounds validation:', error.message);
    throw new Error('HOM Bounds validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateScreenMeasuredDiameterMinMax(p_CensusID: number | null, p_PlotID: number | null, minDBH: number | null, maxDBH: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateScreenMeasuredDiameterMinMax';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to find measurements outside the DBH bounds
    const cursorQuery = `
            SELECT cm.CoreMeasurementID, cm.MeasuredDBH, cm.DBHUnit
            FROM coremeasurements cm
            LEFT JOIN stems st ON cm.StemID = st.StemID
            LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
            WHERE (
                cm.MeasuredDBH < 0 OR
                (${maxDBH !== null ? `cm.MeasuredDBH > ?` : `1=0`})
            )
            AND cm.IsValidated IS FALSE
            AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
            AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams: any[] = [];
    if (maxDBH !== null) cursorParams.push(maxDBH);
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID, MeasuredDBH, DBHUnit } = row;
      expectedCount++;

      // Convert DBH to millimeters
      const dbhUnit = DBHUnit as DBHUnits;
      const measuredDBHInMM = MeasuredDBH * (unitConversionFactors[dbhUnit] || 1);

      const validationCriteria = 'DBH Measurement Range Validation';
      const measuredValue = `Measured DBH: ${measuredDBHInMM} mm`;
      const expectedValueRange = `Expected DBH Range: ${minDBH} - ${maxDBH} mm`;
      const additionalDetails = 'Checks if the measured DBH falls within the specified minimum and maximum range in millimeters.';

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
                `);
      logValidationParams.push(
        'ValidateScreenMeasuredDiameterMinMax',
        CoreMeasurementID,
        `DBH outside bounds: ${minDBH} - ${maxDBH} mm`,
        validationCriteria,
        measuredValue,
        expectedValueRange,
        additionalDetails
      );
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Bounds validation:', error.message);
    throw new Error('DBH Bounds validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}

export async function validateScreenStemsWithMeasurementsButDeadAttributes(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateScreenStemsWithMeasurementsButDeadAttributes';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    veID = validationResult[0]?.ValidationID;

    // Query to find stems with measurements but dead attributes
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
            FROM coremeasurements cm
            JOIN cmattributes cma ON cm.CoreMeasurementID = cma.CoreMeasurementID
            JOIN attributes a ON cma.Code = a.Code
            JOIN stems st ON cm.StemID = st.StemID
            JOIN quadrats q ON st.QuadratID = q.QuadratID
            WHERE (
                (cm.MeasuredDBH IS NOT NULL AND cm.MeasuredDBH > 0) OR
                (cm.MeasuredHOM IS NOT NULL AND cm.MeasuredHOM > 0)
            )
            AND a.Status IN ('dead', 'stem dead', 'missing', 'broken below', 'omitted')
            AND cm.IsValidated IS FALSE
            AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
            AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    const insertErrorQueries: string[] = [];
    const insertErrorParams: any[] = [];
    const logValidationQueries: string[] = [];
    const logValidationParams: any[] = [];

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      const validationCriteria = 'Stem Measurements with Dead Attributes Validation';
      const additionalDetails = 'Verifies that stems marked as dead do not have active measurements.';

      // Check if validation error already exists
      const errorCheckQuery = `
                    SELECT 1
                    FROM cmverrors
                    WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
                `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Queue insertion of validation error
        insertErrorQueries.push(`
                        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                        VALUES (?, ?);
                    `);
        insertErrorParams.push(CoreMeasurementID, veID);

        insertCount++;
      }

      // Queue insertion into validationchangelog
      logValidationQueries.push(`
                    INSERT INTO validationchangelog (
                        ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                        ValidationCriteria, AdditionalDetails
                    ) VALUES (?, NOW(), ?, 'Failed', 'Stem with measurements but dead attributes detected.',
                              ?, ?);
                `);
      logValidationParams.push('ValidateScreenStemsWithMeasurementsButDeadAttributes', CoreMeasurementID, validationCriteria, additionalDetails);
    }

    // Execute all queued insertions in one go
    if (insertErrorQueries.length > 0) {
      await runQuery(conn, insertErrorQueries.join(' '), insertErrorParams);
    }
    if (logValidationQueries.length > 0) {
      await runQuery(conn, logValidationQueries.join(' '), logValidationParams);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem with Dead Attributes validation:', error.message);
    throw new Error('Stem with Dead Attributes validation failed. Please check the logs for more details.');
  } finally {
    // Always release the connection back to the pool
    if (conn) conn.release();
  }
}
