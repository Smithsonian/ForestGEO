import { getConn, runQuery } from './processormacros';

export async function validateDBHGrowthExceedsMax(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;
  let expectedCount = 0;
  let veID: number;

  try {
    // Fetch the ValidationErrorID for this stored procedure
    const validationProcedureQuery = `
            SELECT ValidationID
            FROM catalog.validationprocedures
            WHERE ProcedureName = 'ValidateDBHGrowthExceedsMax';
        `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
    const cursorQuery = `
            SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH AS vPrevDBH, cm2.MeasuredDBH AS vCurrDBH
            FROM coremeasurements cm1
            JOIN coremeasurements cm2 ON cm1.StemID = cm2.StemID AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
            LEFT JOIN stems st2 ON cm2.StemID = st2.StemID
            LEFT JOIN quadrats q ON st2.QuadratID = q.QuadratID
            LEFT JOIN cmattributes cma ON cm1.CoreMeasurementID = cma.CoreMeasurementID
            LEFT JOIN attributes a ON cma.Code = a.Code
            WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
              AND cm1.MeasuredDBH IS NOT NULL
              AND cm2.MeasuredDBH IS NOT NULL
              AND (cm2.MeasuredDBH - cm1.MeasuredDBH > 65)
              AND cm1.IsValidated IS TRUE
              AND cm2.IsValidated IS FALSE
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    for (const row of cursorResults) {
      const { CoreMeasurementID, vPrevDBH, vCurrDBH } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                SELECT 1
                FROM cmverrors
                WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
            `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Growth exceeds max threshold.',
                        'Annual DBH Growth', ?, 'Growth <= 65', 'Checked for excessive DBH growth over a year');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateDBHGrowthExceedsMax', CoreMeasurementID, `Previous DBH: ${vPrevDBH}, Current DBH: ${vCurrDBH}`]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Growth validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
    const cursorQuery = `
            SELECT cm2.CoreMeasurementID, cm1.MeasuredDBH AS vPrevDBH, cm2.MeasuredDBH AS vCurrDBH
            FROM coremeasurements cm1
            JOIN coremeasurements cm2 ON cm1.StemID = cm2.StemID AND YEAR(cm2.MeasurementDate) = YEAR(cm1.MeasurementDate) + 1
            LEFT JOIN stems st ON cm2.StemID = st.StemID
            LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
            LEFT JOIN cmattributes cma ON cm1.CoreMeasurementID = cma.CoreMeasurementID
            LEFT JOIN attributes a ON cma.Code = a.Code
            WHERE (a.Status NOT IN ('dead', 'stem dead', 'broken below', 'missing', 'omitted') OR a.Status IS NULL)
              AND cm1.MeasuredDBH IS NOT NULL
              AND cm2.MeasuredDBH IS NOT NULL
              AND cm1.IsValidated IS TRUE
              AND cm2.IsValidated IS FALSE
              AND (cm2.MeasuredDBH < cm1.MeasuredDBH * 0.95) -- Validation condition
              AND (${p_CensusID !== null ? `q.CensusID = ?` : `1=1`})
              AND (${p_PlotID !== null ? `q.PlotID = ?` : `1=1`});
        `;

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    for (const row of cursorResults) {
      const { CoreMeasurementID, vPrevDBH, vCurrDBH } = row;
      expectedCount++;

      // Check if validation error already exists
      const errorCheckQuery = `
                SELECT 1
                FROM cmverrors
                WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
            `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Shrinkage exceeds maximum allowed threshold.',
                        'Annual DBH Shrinkage', ?, 'Shrinkage < 5% of previous DBH', 'Checked for excessive DBH shrinkage over a year');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateDBHShrinkageExceedsMax', CoreMeasurementID, `Previous DBH: ${vPrevDBH}, Current DBH: ${vCurrDBH}`]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Shrinkage validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Invalid species code detected.',
                        'Species Code Validation', 'Species ID: NULL',
                        'Non-null and valid Species ID',
                        'Checking for the existence of valid species codes for each measurement.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindAllInvalidSpeciesCodes', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Species Code validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Duplicate stem and tree tag combination detected.',
                        'Duplicate Stem-Tree Tag Combinations per Census', 'N/A',
                        'Unique Stem-Tree Tag Combinations',
                        'Checking for duplicate stem and tree tag combinations in each census.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindDuplicateStemTreeTagCombinationsPerCensus', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Duplicate Stem-Tree Tag validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Duplicated quadrat name detected.',
                        'Quadrat Name Duplication', 'N/A',
                        'Unique Quadrat Names per Plot', 'Checking for duplicated quadrat names within the same plot.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindDuplicatedQuadratsByName', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Quadrat Name Duplication validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Measurement outside census date bounds.',
                        'Measurement Date vs Census Date Bounds', 'Measurement Date',
                        'Within Census Start and End Dates',
                        'Checking if measurement dates fall within the start and end dates of their respective censuses.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Measurement Date validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Stems in the same tree have different species.',
                        'Species consistency across tree stems', 'One species per tree',
                        'One species per tree', 'Checking if stems belonging to the same tree have different species IDs.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindStemsInTreeWithDifferentSpecies', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Species Consistency validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Stem is outside plot dimensions.',
                        'Stem Placement within Plot Boundaries', 'Stem Plot Coordinates',
                        'Within Plot Dimensions', 'Validating whether stems are located within the specified plot dimensions.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindStemsOutsidePlots', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem Placement validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

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
        // Log the validation error
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      // Insert into validationchangelog
      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Stems in the same tree are in different quadrats.',
                        'Stem Quadrat Consistency within Trees', 'Quadrat IDs of Stems',
                        'Consistent Quadrat IDs for all Stems in a Tree',
                        'Validating that all stems within the same tree are located in the same quadrat.');
            `;
      await runQuery(conn, logValidationQuery, ['ValidateFindTreeStemsInDifferentQuadrats', CoreMeasurementID]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem Quadrat Consistency validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
  }
}

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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
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

    const cursorParams = [];
    if (minHOM !== null) cursorParams.push(minHOM);
    if (maxHOM !== null) cursorParams.push(maxHOM);
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      const measuredValueQuery = `
                SELECT MeasuredHOM
                FROM coremeasurements
                WHERE CoreMeasurementID = ?;
            `;
      const measuredValueResult = await runQuery(conn, measuredValueQuery, [CoreMeasurementID]);
      const measuredHOM = measuredValueResult[0]?.MeasuredHOM;

      const validationCriteria = 'HOM Measurement Range Validation';
      const measuredValue = `Measured HOM: ${measuredHOM}`;
      const expectedValueRange = `Expected HOM Range: ${minHOM} - ${maxHOM}`;
      const additionalDetails = 'Checks if the measured HOM falls within the specified minimum and maximum range.';

      // Log the failed validation
      const errorCheckQuery = `
                SELECT 1
                FROM cmverrors
                WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
            `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
            `;
      await runQuery(conn, logValidationQuery, [
        'ValidateHOMUpperAndLowerBounds',
        CoreMeasurementID,
        `HOM outside bounds: ${minHOM} - ${maxHOM}`,
        validationCriteria,
        measuredValue,
        expectedValueRange,
        additionalDetails
      ]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during HOM Bounds validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
    const cursorQuery = `
            SELECT cm.CoreMeasurementID
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

    const cursorParams = [];
    if (maxDBH !== null) cursorParams.push(maxDBH);
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      const measuredValueQuery = `
                SELECT MeasuredDBH
                FROM coremeasurements
                WHERE CoreMeasurementID = ?;
            `;
      const measuredValueResult = await runQuery(conn, measuredValueQuery, [CoreMeasurementID]);
      const measuredDBH = measuredValueResult[0]?.MeasuredDBH;

      const validationCriteria = 'DBH Measurement Range Validation';
      const measuredValue = `Measured DBH: ${measuredDBH}`;
      const expectedValueRange = `Expected DBH Range: ${minDBH} - ${maxDBH}`;
      const additionalDetails = 'Checks if the measured DBH falls within the specified minimum and maximum range.';

      // Log the failed validation
      const errorCheckQuery = `
                SELECT 1
                FROM cmverrors
                WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
            `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
            `;
      await runQuery(conn, logValidationQuery, [
        'ValidateScreenMeasuredDiameterMinMax',
        CoreMeasurementID,
        `DBH outside bounds: ${minDBH} - ${maxDBH}`,
        validationCriteria,
        measuredValue,
        expectedValueRange,
        additionalDetails
      ]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Bounds validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
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
    veID = validationResult[0]?.ValidationID;

    // Cursor-like operation: SELECT and then iterate over results
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

    const cursorParams = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    for (const row of cursorResults) {
      const { CoreMeasurementID } = row;
      expectedCount++;

      const validationCriteria = 'Stem Measurements with Dead Attributes Validation';
      const additionalDetails = 'Verifies that stems marked as dead do not have active measurements.';

      // Log the failed validation
      const errorCheckQuery = `
                SELECT 1
                FROM cmverrors
                WHERE CoreMeasurementID = ? AND ValidationErrorID = ?;
            `;
      const errorCheckResult = await runQuery(conn, errorCheckQuery, [CoreMeasurementID, veID]);

      if (errorCheckResult.length === 0) {
        const insertErrorQuery = `
                    INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
                    VALUES (?, ?);
                `;
        await runQuery(conn, insertErrorQuery, [CoreMeasurementID, veID]);

        insertCount++;
      }

      const logValidationQuery = `
                INSERT INTO validationchangelog (ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
                                                 ValidationCriteria, AdditionalDetails)
                VALUES (?, NOW(), ?, 'Failed', 'Stem with measurements but dead attributes detected.',
                        ?, ?);
            `;
      await runQuery(conn, logValidationQuery, [
        'ValidateScreenStemsWithMeasurementsButDeadAttributes',
        CoreMeasurementID,
        validationCriteria,
        additionalDetails
      ]);
    }

    // Return the summary
    return {
      TotalRows: expectedCount,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${expectedCount}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem with Dead Attributes validation:', error.message);
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
  }
}
