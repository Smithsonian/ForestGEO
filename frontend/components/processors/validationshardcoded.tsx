import { getConn, runQuery } from './processormacros';

// Centralized validation function
export async function runValidation(
  validationProcedureName: string,
  cursorQuery: string,
  cursorParams: any[],
  validationCriteria: string,
  errorMessage: string,
  expectedValueRange: string,
  measuredValue: (row: any) => string,
  additionalDetails: string
) {
  const conn = await getConn();
  let insertCount = 0;

  try {
    const validationProcedureQuery = `
      SELECT ValidationID
      FROM catalog.validationprocedures
      WHERE ProcedureName = ?;
    `;
    const validationResult = await runQuery(conn, validationProcedureQuery, [validationProcedureName]);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    const veID = validationResult[0]?.ValidationID;

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;
      const logValidationQuery = `
        INSERT INTO validationchangelog (
          ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
          ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
        ) VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
      `;

      const insertErrorParams: any[] = [];
      const logValidationParams: any[] = [];

      for (const row of cursorResults) {
        insertErrorParams.push(row.CoreMeasurementID, veID, row.CoreMeasurementID, veID);
        logValidationParams.push(
          validationProcedureName,
          row.CoreMeasurementID,
          errorMessage,
          validationCriteria,
          measuredValue(row),
          expectedValueRange,
          additionalDetails
        );

        insertCount++;
      }

      // Execute batch inserts
      await runQuery(conn, insertErrorQuery, insertErrorParams);
      await runQuery(conn, logValidationQuery, logValidationParams);
    }

    return {
      TotalRows: cursorResults.length,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${cursorResults.length}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error(`Error during ${validationProcedureName} validation:`, error.message);
    throw new Error(`${validationProcedureName} validation failed. Please check the logs for more details.`);
  } finally {
    if (conn) conn.release();
  }
}

// centralized function:
// Define the enum for DBH and HOM units
enum Units {
  km = 'km',
  hm = 'hm',
  dam = 'dam',
  m = 'm',
  dm = 'dm',
  cm = 'cm',
  mm = 'mm'
}

// Map the units to their conversion factors for DBH (in mm) and HOM (in meters)
const unitConversionFactors: Record<Units, number> = {
  km: 1000000,
  hm: 100000,
  dam: 10000,
  m: 1000,
  dm: 100,
  cm: 10,
  mm: 1
};

const unitConversionFactorsHOM: Record<Units, number> = {
  km: 1000,
  hm: 100,
  dam: 10,
  m: 1,
  dm: 0.1,
  cm: 0.01,
  mm: 0.001
};

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

export async function validateDBHGrowthExceedsMax(p_CensusID: number | null, p_PlotID: number | null) {
  const cursorQuery = `
    SELECT 
      cm2.CoreMeasurementID, 
      cm1.MeasuredDBH * (CASE cm1.DBHUnit 
                            WHEN 'km' THEN 1000000 
                            WHEN 'hm' THEN 100000 
                            WHEN 'dam' THEN 10000 
                            WHEN 'm' THEN 1000 
                            WHEN 'dm' THEN 100 
                            WHEN 'cm' THEN 10 
                            WHEN 'mm' THEN 1 
                            ELSE 1 END) AS vPrevDBHInMM,
      cm2.MeasuredDBH * (CASE cm2.DBHUnit 
                            WHEN 'km' THEN 1000000 
                            WHEN 'hm' THEN 100000 
                            WHEN 'dam' THEN 10000 
                            WHEN 'm' THEN 1000 
                            WHEN 'dm' THEN 100 
                            WHEN 'cm' THEN 10 
                            WHEN 'mm' THEN 1 
                            ELSE 1 END) AS vCurrDBHInMM
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
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
      AND (cm2.MeasuredDBH * (CASE cm2.DBHUnit 
                                WHEN 'km' THEN 1000000 
                                WHEN 'hm' THEN 100000 
                                WHEN 'dam' THEN 10000 
                                WHEN 'm' THEN 1000 
                                WHEN 'dm' THEN 100 
                                WHEN 'cm' THEN 10 
                                WHEN 'mm' THEN 1 
                                ELSE 1 END) 
            - cm1.MeasuredDBH * (CASE cm1.DBHUnit 
                                  WHEN 'km' THEN 1000000 
                                  WHEN 'hm' THEN 100000 
                                  WHEN 'dam' THEN 10000 
                                  WHEN 'm' THEN 1000 
                                  WHEN 'dm' THEN 100 
                                  WHEN 'cm' THEN 10 
                                  WHEN 'mm' THEN 1 
                                  ELSE 1 END) > 65);
  `;

  const cursorParams = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateDBHGrowthExceedsMax',
    cursorQuery,
    cursorParams,
    'Annual DBH Growth',
    'Growth exceeds max threshold.',
    'Growth <= 65 mm',
    row => `Previous DBH in mm: ${row.vPrevDBHInMM}, Current DBH in mm: ${row.vCurrDBHInMM}`,
    'Checked for excessive DBH growth over a year'
  );
}

export async function validateDBHShrinkageExceedsMax(p_CensusID: number | null, p_PlotID: number | null) {
  const cursorQuery = `
    SELECT 
      cm2.CoreMeasurementID, 
      cm1.MeasuredDBH * (CASE cm1.DBHUnit 
                            WHEN 'km' THEN 1000000 
                            WHEN 'hm' THEN 100000 
                            WHEN 'dam' THEN 10000 
                            WHEN 'm' THEN 1000 
                            WHEN 'dm' THEN 100 
                            WHEN 'cm' THEN 10 
                            WHEN 'mm' THEN 1 
                            ELSE 1 END) AS vPrevDBHInMM,
      cm2.MeasuredDBH * (CASE cm2.DBHUnit 
                            WHEN 'km' THEN 1000000 
                            WHEN 'hm' THEN 100000 
                            WHEN 'dam' THEN 10000 
                            WHEN 'm' THEN 1000 
                            WHEN 'dm' THEN 100 
                            WHEN 'cm' THEN 10 
                            WHEN 'mm' THEN 1 
                            ELSE 1 END) AS vCurrDBHInMM
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
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND (cm2.MeasuredDBH * (CASE cm2.DBHUnit 
                                WHEN 'km' THEN 1000000 
                                WHEN 'hm' THEN 100000 
                                WHEN 'dam' THEN 10000 
                                WHEN 'm' THEN 1000 
                                WHEN 'dm' THEN 100 
                                WHEN 'cm' THEN 10 
                                WHEN 'mm' THEN 1 
                                ELSE 1 END) 
            < cm1.MeasuredDBH * (CASE cm1.DBHUnit 
                                  WHEN 'km' THEN 1000000 
                                  WHEN 'hm' THEN 100000 
                                  WHEN 'dam' THEN 10000 
                                  WHEN 'm' THEN 1000 
                                  WHEN 'dm' THEN 100 
                                  WHEN 'cm' THEN 10 
                                  WHEN 'mm' THEN 1 
                                  ELSE 1 END) * 0.95);
  `;

  const cursorParams: any[] = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateDBHShrinkageExceedsMax',
    cursorQuery,
    cursorParams,
    'Annual DBH Shrinkage',
    'Shrinkage exceeds maximum allowed threshold.',
    'Shrinkage < 5% of previous DBH',
    row => `Previous DBH in mm: ${row.vPrevDBHInMM}, Current DBH in mm: ${row.vCurrDBHInMM}`,
    'Checked for excessive DBH shrinkage over a year'
  );
}

export async function validateFindAllInvalidSpeciesCodes(p_CensusID: number | null, p_PlotID: number | null) {
  const cursorQuery = `
    SELECT cm.CoreMeasurementID
    FROM stems s
    JOIN trees t ON s.TreeID = t.TreeID
    LEFT JOIN species sp ON t.SpeciesID = sp.SpeciesID
    JOIN coremeasurements cm ON s.StemID = cm.StemID
    LEFT JOIN quadrats q ON s.QuadratID = q.QuadratID
    WHERE sp.SpeciesID IS NULL
      AND cm.IsValidated IS FALSE
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
    GROUP BY cm.CoreMeasurementID;
  `;

  const cursorParams: any[] = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateFindAllInvalidSpeciesCodes',
    cursorQuery,
    cursorParams,
    'Species Code Validation',
    'Invalid species code detected.',
    'Non-null and valid Species ID',
    () => 'Species ID: NULL',
    'Checking for the existence of valid species codes for each measurement.'
  );
}

export async function validateFindDuplicateStemTreeTagCombinationsPerCensus(p_CensusID: number | null, p_PlotID: number | null) {
  const cursorQuery = `
    SELECT cm.CoreMeasurementID
    FROM coremeasurements cm
    INNER JOIN stems s ON cm.StemID = s.StemID
    INNER JOIN trees t ON s.TreeID = t.TreeID
    INNER JOIN quadrats q ON s.QuadratID = q.QuadratID
    WHERE (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      AND cm.IsValidated = FALSE
    GROUP BY q.CensusID, s.StemTag, t.TreeTag
    HAVING COUNT(cm.CoreMeasurementID) > 1;
  `;

  const cursorParams: any[] = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateFindDuplicateStemTreeTagCombinationsPerCensus',
    cursorQuery,
    cursorParams,
    'Duplicate Stem-Tree Tag Combinations per Census',
    'Duplicate stem and tree tag combination detected.',
    'Unique Stem-Tree Tag Combinations',
    () => 'N/A',
    'Checking for duplicate stem and tree tag combinations in each census.'
  );
}

export async function validateFindDuplicatedQuadratsByName(p_CensusID: number | null, p_PlotID: number | null) {
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
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
    GROUP BY cm.CoreMeasurementID;
  `;

  const cursorParams: any[] = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateFindDuplicatedQuadratsByName',
    cursorQuery,
    cursorParams,
    'Quadrat Name Duplication',
    'Duplicated quadrat name detected.',
    'Unique Quadrat Names per Plot',
    () => 'N/A',
    'Checking for duplicated quadrat names within the same plot.'
  );
}

export async function validateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat(p_CensusID: number | null, p_PlotID: number | null) {
  const cursorQuery = `
    SELECT MIN(cm.CoreMeasurementID) AS CoreMeasurementID
    FROM coremeasurements cm
    JOIN stems st ON cm.StemID = st.StemID
    JOIN quadrats q ON st.QuadratID = q.QuadratID
    JOIN census c ON q.CensusID = c.CensusID
    WHERE (cm.MeasurementDate < c.StartDate OR cm.MeasurementDate > c.EndDate)
      AND cm.MeasurementDate IS NOT NULL
      AND cm.IsValidated IS FALSE
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
    GROUP BY q.QuadratID, c.CensusID, c.StartDate, c.EndDate;
  `;

  const cursorParams: any[] = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat',
    cursorQuery,
    cursorParams,
    'Measurement Date vs Census Date Bounds',
    'Measurement outside census date bounds.',
    'Within Census Start and End Dates',
    () => 'Measurement Date',
    'Checking if measurement dates fall within the start and end dates of their respective censuses.'
  );
}

export async function validateFindStemsInTreeWithDifferentSpecies(p_CensusID: number | null, p_PlotID: number | null) {
  const cursorQuery = `
    SELECT cm.CoreMeasurementID
    FROM coremeasurements cm
    JOIN stems s ON cm.StemID = s.StemID
    JOIN trees t ON s.TreeID = t.TreeID
    JOIN quadrats q ON s.QuadratID = q.QuadratID
    WHERE cm.IsValidated = FALSE
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
    GROUP BY t.TreeID, cm.CoreMeasurementID
    HAVING COUNT(DISTINCT t.SpeciesID) > 1;
  `;

  const cursorParams: any[] = [];
  if (p_CensusID !== null) cursorParams.push(p_CensusID);
  if (p_PlotID !== null) cursorParams.push(p_PlotID);

  return runValidation(
    'ValidateFindStemsInTreeWithDifferentSpecies',
    cursorQuery,
    cursorParams,
    'Species consistency across tree stems',
    'Stems in the same tree have different species.',
    'One species per tree',
    () => 'One species per tree',
    'Checking if stems belonging to the same tree have different species IDs.'
  );
}

export async function validateFindStemsOutsidePlots(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;

  try {
    const validationProcedureQuery = `
      SELECT ValidationID
      FROM catalog.validationprocedures
      WHERE ProcedureName = 'ValidateFindStemsOutsidePlots';
    `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    const veID = validationResult[0]?.ValidationID;

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
        AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
        AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      GROUP BY cm.CoreMeasurementID;
    `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;
      const logValidationQuery = `
        INSERT INTO validationchangelog (
          ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
          ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
        ) VALUES (?, NOW(), ?, 'Failed', 'Stem is outside plot dimensions.',
                  'Stem Placement within Plot Boundaries', 'Stem Plot Coordinates',
                  'Within Plot Dimensions', 'Validating whether stems are located within the specified plot dimensions.');
      `;

      const insertErrorParams: any[] = [];
      const logValidationParams: any[] = [];

      for (const row of cursorResults) {
        const { CoreMeasurementID } = row;

        insertErrorParams.push(CoreMeasurementID, veID, CoreMeasurementID, veID);
        logValidationParams.push('ValidateFindStemsOutsidePlots', CoreMeasurementID);

        insertCount++;
      }

      // Execute batch inserts
      await runQuery(conn, insertErrorQuery, insertErrorParams);
      await runQuery(conn, logValidationQuery, logValidationParams);
    }

    return {
      TotalRows: cursorResults.length,
      FailedRows: insertCount,
      Message: `Validation completed. Total rows: ${cursorResults.length}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem Placement validation:', error.message);
    throw new Error('Stem Placement validation failed. Please check the logs for more details.');
  } finally {
    if (conn) conn.release();
  }
}

export async function validateFindTreeStemsInDifferentQuadrats(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;

  try {
    const validationProcedureQuery = `
      SELECT ValidationID
      FROM catalog.validationprocedures
      WHERE ProcedureName = 'ValidateFindTreeStemsInDifferentQuadrats';
    `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    const veID = validationResult[0]?.ValidationID;

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
        AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID)
      GROUP BY cm1.CoreMeasurementID;
    `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;
      const logValidationQuery = `
        INSERT INTO validationchangelog (
          ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
          ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
        ) VALUES (?, NOW(), ?, 'Failed', 'Stems in the same tree are in different quadrats.',
                  'Stem Quadrat Consistency within Trees', 'Quadrat IDs of Stems',
                  'Consistent Quadrat IDs for all Stems in a Tree',
                  'Validating that all stems within the same tree are located in the same quadrat.');
      `;

      const insertErrorParams: any[] = [];
      const logValidationParams: any[] = [];

      for (const row of cursorResults) {
        const { CoreMeasurementID } = row;

        insertErrorParams.push(CoreMeasurementID, veID, CoreMeasurementID, veID);
        logValidationParams.push('ValidateFindTreeStemsInDifferentQuadrats', CoreMeasurementID);

        insertCount++;
      }

      // Execute batch inserts
      await runQuery(conn, insertErrorQuery, insertErrorParams);
      await runQuery(conn, logValidationQuery, logValidationParams);
    }

    return {
      TotalRows: cursorResults.length,
      FailedRows: insertCount,
      Message: `Validation completed. Total rows: ${cursorResults.length}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem Quadrat Consistency validation:', error.message);
    throw new Error('Stem Quadrat Consistency validation failed. Please check the logs for more details.');
  } finally {
    if (conn) conn.release();
  }
}

enum HOMUnits {
  km = 'km',
  hm = 'hm',
  dam = 'dam',
  m = 'm',
  dm = 'dm',
  cm = 'cm',
  mm = 'mm'
}

export async function validateHOMUpperAndLowerBounds(p_CensusID: number | null, p_PlotID: number | null, minHOM: number | null, maxHOM: number | null) {
  const conn = await getConn();
  let insertCount = 0;

  try {
    const validationProcedureQuery = `
      SELECT ValidationID
      FROM catalog.validationprocedures
      WHERE ProcedureName = 'ValidateHOMUpperAndLowerBounds';
    `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    const veID = validationResult[0]?.ValidationID;

    // Query to find measurements outside the HOM bounds
    const cursorQuery = `
      SELECT cm.CoreMeasurementID, cm.MeasuredHOM, cm.HOMUnit
      FROM coremeasurements cm
      LEFT JOIN stems st ON cm.StemID = st.StemID
      LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
      WHERE (
        (@minHOM IS NULL OR cm.MeasuredHOM = @minHOM) OR
        (@maxHOM IS NULL OR cm.MeasuredHOM = @maxHOM)
      )
      AND cm.IsValidated IS FALSE
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
    `;

    const cursorParams: any[] = [];
    if (minHOM !== null) cursorParams.push(minHOM);
    if (maxHOM !== null) cursorParams.push(maxHOM);
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;
      const logValidationQuery = `
        INSERT INTO validationchangelog (
          ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
          ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
        ) VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
      `;

      const insertErrorParams: any[] = [];
      const logValidationParams: any[] = [];

      for (const row of cursorResults) {
        const { CoreMeasurementID, MeasuredHOM, HOMUnit } = row;

        const homUnit = HOMUnit as HOMUnits;
        const measuredHOMInMeters = MeasuredHOM * (unitConversionFactorsHOM[homUnit] || 1);

        const validationCriteria = 'HOM Measurement Range Validation';
        const measuredValue = `Measured HOM: ${measuredHOMInMeters} meters`;
        const expectedValueRange = `Expected HOM Range: ${minHOM} - ${maxHOM} meters`;
        const additionalDetails = 'Checks if the measured HOM falls within the specified minimum and maximum range in meters.';

        insertErrorParams.push(CoreMeasurementID, veID, CoreMeasurementID, veID);
        logValidationParams.push(
          'ValidateHOMUpperAndLowerBounds',
          CoreMeasurementID,
          `HOM outside bounds: ${minHOM} - ${maxHOM} meters`,
          validationCriteria,
          measuredValue,
          expectedValueRange,
          additionalDetails
        );

        insertCount++;
      }

      // Execute batch inserts
      await runQuery(conn, insertErrorQuery, insertErrorParams);
      await runQuery(conn, logValidationQuery, logValidationParams);
    }

    return {
      TotalRows: cursorResults.length,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${cursorResults.length}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during HOM Bounds validation:', error.message);
    throw new Error('HOM Bounds validation failed. Please check the logs for more details.');
  } finally {
    if (conn) conn.release();
  }
}

export async function validateScreenMeasuredDiameterMinMax(p_CensusID: number | null, p_PlotID: number | null, minDBH: number | null, maxDBH: number | null) {
  const conn = await getConn();
  let insertCount = 0;

  try {
    const validationProcedureQuery = `
      SELECT ValidationID
      FROM catalog.validationprocedures
      WHERE ProcedureName = 'ValidateScreenMeasuredDiameterMinMax';
    `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    const veID = validationResult[0]?.ValidationID;

    // Query to find measurements outside the DBH bounds
    const cursorQuery = `
      SELECT cm.CoreMeasurementID, cm.MeasuredDBH, cm.DBHUnit
      FROM coremeasurements cm
      LEFT JOIN stems st ON cm.StemID = st.StemID
      LEFT JOIN quadrats q ON st.QuadratID = q.QuadratID
      WHERE (
        (@minDBH IS NULL OR cm.MeasuredDBH = @minDBH) OR
        (@maxDBH IS NULL OR cm.MeasuredDBH = @maxDBH)
      )
      AND cm.IsValidated IS FALSE
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
    `;

    const cursorParams: any[] = [];
    if (minDBH !== null) cursorParams.push(minDBH);
    if (maxDBH !== null) cursorParams.push(maxDBH);
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;
      const logValidationQuery = `
        INSERT INTO validationchangelog (
          ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
          ValidationCriteria, MeasuredValue, ExpectedValueRange, AdditionalDetails
        ) VALUES (?, NOW(), ?, 'Failed', ?, ?, ?, ?, ?);
      `;

      const insertErrorParams: any[] = [];
      const logValidationParams: any[] = [];

      for (const row of cursorResults) {
        const { CoreMeasurementID, MeasuredDBH, DBHUnit } = row;

        // Convert DBH to millimeters
        const dbhUnit = DBHUnit as DBHUnits;
        const measuredDBHInMM = MeasuredDBH * (unitConversionFactors[dbhUnit] || 1);

        const validationCriteria = 'DBH Measurement Range Validation';
        const measuredValue = `Measured DBH: ${measuredDBHInMM} mm`;
        const expectedValueRange = `Expected DBH Range: ${minDBH} - ${maxDBH} mm`;
        const additionalDetails = 'Checks if the measured DBH falls within the specified minimum and maximum range in millimeters.';

        insertErrorParams.push(CoreMeasurementID, veID, CoreMeasurementID, veID);
        logValidationParams.push(
          'ValidateScreenMeasuredDiameterMinMax',
          CoreMeasurementID,
          `DBH outside bounds: ${minDBH} - ${maxDBH} mm`,
          validationCriteria,
          measuredValue,
          expectedValueRange,
          additionalDetails
        );

        insertCount++;
      }

      // Execute batch inserts
      await runQuery(conn, insertErrorQuery, insertErrorParams);
      await runQuery(conn, logValidationQuery, logValidationParams);
    }

    return {
      TotalRows: cursorResults.length,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${cursorResults.length}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during DBH Bounds validation:', error.message);
    throw new Error('DBH Bounds validation failed. Please check the logs for more details.');
  } finally {
    if (conn) conn.release();
  }
}

export async function validateScreenStemsWithMeasurementsButDeadAttributes(p_CensusID: number | null, p_PlotID: number | null) {
  const conn = await getConn();
  let insertCount = 0;

  try {
    const validationProcedureQuery = `
      SELECT ValidationID
      FROM catalog.validationprocedures
      WHERE ProcedureName = 'ValidateScreenStemsWithMeasurementsButDeadAttributes';
    `;
    const validationResult = await runQuery(conn, validationProcedureQuery);
    if (validationResult.length === 0) {
      throw new Error('Validation procedure not found.');
    }
    const veID = validationResult[0]?.ValidationID;

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
      AND (@p_CensusID IS NULL OR q.CensusID = @p_CensusID)
      AND (@p_PlotID IS NULL OR q.PlotID = @p_PlotID);
    `;

    const cursorParams: any[] = [];
    if (p_CensusID !== null) cursorParams.push(p_CensusID);
    if (p_PlotID !== null) cursorParams.push(p_PlotID);

    const cursorResults = await runQuery(conn, cursorQuery, cursorParams);

    if (cursorResults.length > 0) {
      const insertErrorQuery = `
        INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
        SELECT ?, ?
        FROM DUAL
        WHERE NOT EXISTS (
          SELECT 1 
          FROM cmverrors 
          WHERE CoreMeasurementID = ? AND ValidationErrorID = ?
        );
      `;
      const logValidationQuery = `
        INSERT INTO validationchangelog (
          ProcedureName, RunDateTime, TargetRowID, ValidationOutcome, ErrorMessage,
          ValidationCriteria, AdditionalDetails
        ) VALUES (?, NOW(), ?, 'Failed', 'Stem with measurements but dead attributes detected.',
                  ?, ?);
      `;

      const insertErrorParams: any[] = [];
      const logValidationParams: any[] = [];

      for (const row of cursorResults) {
        const { CoreMeasurementID } = row;

        const validationCriteria = 'Stem Measurements with Dead Attributes Validation';
        const additionalDetails = 'Verifies that stems marked as dead do not have active measurements.';

        insertErrorParams.push(CoreMeasurementID, veID, CoreMeasurementID, veID);
        logValidationParams.push('ValidateScreenStemsWithMeasurementsButDeadAttributes', CoreMeasurementID, validationCriteria, additionalDetails);

        insertCount++;
      }

      // Execute batch inserts
      await runQuery(conn, insertErrorQuery, insertErrorParams);
      await runQuery(conn, logValidationQuery, logValidationParams);
    }

    return {
      TotalRows: cursorResults.length,
      FailedRows: insertCount,
      Message: `Validation completed successfully. Total rows: ${cursorResults.length}, Failed rows: ${insertCount}`
    };
  } catch (error: any) {
    console.error('Error during Stem with Dead Attributes validation:', error.message);
    throw new Error('Stem with Dead Attributes validation failed. Please check the logs for more details.');
  } finally {
    if (conn) conn.release();
  }
}
