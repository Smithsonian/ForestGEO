/**
 * Revision Upload Integration Tests
 *
 * Tests the classification (match/new/invalid) and apply (UPDATE + cmattributes rebuild)
 * logic for the revision upload feature directly against a local MySQL database.
 *
 * Does NOT go through the HTTP layer — tests execute the same SQL the API routes use,
 * verifying that the database operations are correct in isolation.
 *
 * Classification logic mirrors: app/api/revisionupload/route.ts
 * Apply logic mirrors:          app/api/revisionupload/apply/route.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { cleanupTestMeasurements, insertDirectMeasurements, setupTestDatabase, teardownTestDatabase, type TestData } from '../setup/local-db-setup';

// ---------------------------------------------------------------------------
// Named constants — no magic numbers or strings
// ---------------------------------------------------------------------------

const INITIAL_DBH = 10.5;
const INITIAL_HOM = 1.3;
const INITIAL_MEASUREMENT_DATE = '2024-01-15';
const INITIAL_DESCRIPTION = 'original comment';
const INITIAL_RAW_COMMENTS = 'original comment';
const INITIAL_RAW_CODES = 'A;B';
const INITIAL_UPLOAD_FILE_ID = 'original-upload.csv';
const INITIAL_UPLOAD_BATCH_ID = 'batch-001';

const UPDATED_DBH = 15.0;
const UPDATED_CODES = 'C; D';
const UPDATED_COMMENT = 'revised comment';

const ATTRIBUTE_CODE_A = 'A';
const ATTRIBUTE_CODE_B = 'B';
const ATTRIBUTE_CODE_C = 'C';
const ATTRIBUTE_CODE_D = 'D';

const INGESTION_ERROR_SOURCE = 'ingestion';
const VALIDATION_ERROR_SOURCE = 'validation';
const INGESTION_DUPLICATE_ERROR_CODE = 'DUPLICATE_ENTRY';

// MySQL BIT(1) columns are returned as Node.js Buffers, not numbers.
// readBitColumn() must be used to interpret IsValidated from a RowDataPacket.
const IS_VALIDATED_BIT_TRUE = Buffer.from([1]);

// ux_cm_uploadbatch_rowindex requires (UploadBatchID, SourceRowIndex) to be unique.
// insertMeasurementRow auto-increments this per call; tests that need explicit
// control may pass sourceRowIndex directly.
const SOURCE_ROW_INDEX_DEFAULT = 0;

const NONEXISTENT_CORE_MEASUREMENT_ID = 9999999;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Revision Upload Integration Tests', () => {
  let connection: Connection;
  let testData: TestData;
  let config: { database: string };

  // Auto-incrementing source row counter so each insertMeasurementRow call
  // gets a distinct SourceRowIndex, avoiding the ux_cm_uploadbatch_rowindex
  // unique constraint (UploadBatchID, SourceRowIndex) when multiple rows share
  // the same UploadBatchID default.
  let sourceRowCounter = 0;

  beforeAll(async () => {
    const setup = await setupTestDatabase();
    connection = setup.connection;
    testData = setup.testData;
    config = setup.config;
  }, 90000);

  afterAll(async () => {
    await teardownTestDatabase(connection, config);
  });

  beforeEach(async () => {
    await cleanupTestMeasurements(connection, testData);
    sourceRowCounter = 0;
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Reads a MySQL BIT(1) column value from a RowDataPacket.
   * mysql2 returns BIT columns as Node.js Buffers, not numbers.
   * Returns true if the bit is set (value = 1), false for 0 or NULL.
   */
  function readBitColumn(value: Buffer | null | undefined): boolean {
    if (value === null || value === undefined) return false;
    if (Buffer.isBuffer(value)) return value[0] === 1;
    // Fallback for drivers that return numeric 1/0
    return Number(value) === 1;
  }

  /**
   * Inserts a single measurement directly into coremeasurements and returns its
   * auto-generated CoreMeasurementID.  All fields default to reasonable values;
   * callers may override specific columns for the scenario under test.
   *
   * Each call uses a distinct SourceRowIndex to avoid the
   * ux_cm_uploadbatch_rowindex unique constraint (UploadBatchID, SourceRowIndex).
   */
  async function insertMeasurementRow(
    overrides: {
      stemGUID?: number | null;
      censusID?: number;
      measuredDBH?: number;
      measuredHOM?: number;
      measurementDate?: string;
      description?: string | null;
      rawCodes?: string | null;
      rawComments?: string | null;
      uploadFileID?: string | null;
      uploadBatchID?: string | null;
      isValidated?: Buffer | null;
      isActive?: number;
      sourceRowIndex?: number;
    } = {}
  ): Promise<number> {
    const stemGUID = 'stemGUID' in overrides ? overrides.stemGUID : await resolveDefaultStemGUID();
    const censusID = overrides.censusID ?? testData.census[0].censusID;
    const sourceRowIndex = overrides.sourceRowIndex ?? sourceRowCounter++;

    const [result] = await connection.query<ResultSetHeader>(
      `INSERT INTO \`${config.database}\`.coremeasurements
         (StemGUID, CensusID, MeasuredDBH, MeasuredHOM, MeasurementDate,
          Description, RawCodes, RawComments,
          UploadFileID, UploadBatchID, IsValidated,
          SourceRowIndex, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        stemGUID,
        censusID,
        overrides.measuredDBH ?? INITIAL_DBH,
        overrides.measuredHOM ?? INITIAL_HOM,
        overrides.measurementDate ?? INITIAL_MEASUREMENT_DATE,
        overrides.description ?? INITIAL_DESCRIPTION,
        overrides.rawCodes ?? INITIAL_RAW_CODES,
        overrides.rawComments ?? INITIAL_RAW_COMMENTS,
        overrides.uploadFileID ?? INITIAL_UPLOAD_FILE_ID,
        overrides.uploadBatchID ?? INITIAL_UPLOAD_BATCH_ID,
        overrides.isValidated ?? null,
        sourceRowIndex,
        overrides.isActive ?? 1
      ]
    );

    return result.insertId;
  }

  /**
   * Returns the StemGUID for the first pre-seeded stem in the test dataset,
   * after ensuring the stem is linked to the first census.
   */
  async function resolveDefaultStemGUID(): Promise<number> {
    const plotID = testData.plots[0].plotID;
    const censusID = testData.census[0].censusID;
    const quadratName = testData.quadrats[0].QuadratName;
    const speciesCode = testData.species[0].SpeciesCode;

    const { coreMeasurementIDs } = await insertDirectMeasurements(connection, testData, censusID, [
      {
        treeTag: 'REVTEST-DEFAULT',
        stemTag: 'S-DEFAULT',
        speciesCode,
        quadratName,
        x: 5,
        y: 5,
        dbh: 1,
        hom: 1,
        date: '2023-01-01'
      }
    ]);

    // Retrieve the StemGUID that insertDirectMeasurements just created
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.StemGUID FROM \`${config.database}\`.coremeasurements cm
       WHERE cm.CoreMeasurementID = ?`,
      [coreMeasurementIDs[0]]
    );

    if (rows.length === 0 || rows[0].StemGUID === null) {
      throw new Error('resolveDefaultStemGUID: no stem found after insertDirectMeasurements');
    }

    // Clean up the dummy measurement so it does not pollute the test
    await connection.query(`DELETE FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`, [coreMeasurementIDs[0]]);

    // Activate the quadrat link for the stem so classification JOIN succeeds
    await connection.query(
      `UPDATE \`${config.database}\`.quadrats q
       JOIN \`${config.database}\`.stems st ON st.QuadratID = q.QuadratID
       SET q.IsActive = 1, st.IsActive = 1
       WHERE st.StemGUID = ?`,
      [rows[0].StemGUID]
    );

    return rows[0].StemGUID;
  }

  /**
   * Reads a single coremeasurements row by primary key.
   */
  async function getMeasurementRow(coreMeasurementID: number): Promise<RowDataPacket> {
    const [rows] = await connection.query<RowDataPacket[]>(`SELECT * FROM \`${config.database}\`.coremeasurements WHERE CoreMeasurementID = ?`, [
      coreMeasurementID
    ]);

    if (rows.length === 0) {
      throw new Error(`getMeasurementRow: no row found for CoreMeasurementID=${coreMeasurementID}`);
    }

    return rows[0];
  }

  /**
   * Returns the attribute codes currently stored for a measurement.
   */
  async function getAttributeCodes(coreMeasurementID: number): Promise<string[]> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT Code FROM \`${config.database}\`.cmattributes
       WHERE CoreMeasurementID = ?
       ORDER BY Code`,
      [coreMeasurementID]
    );

    return rows.map(r => String(r.Code));
  }

  /**
   * Inserts attribute codes for a measurement (mirrors the post-ingestion
   * cmattributes seeding done by bulkingestionprocess).
   */
  async function insertAttributes(coreMeasurementID: number, codes: string[]): Promise<void> {
    for (const code of codes) {
      await connection.query(`INSERT IGNORE INTO \`${config.database}\`.cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`, [coreMeasurementID, code]);
    }
  }

  /**
   * Resolves the ErrorID for the DUPLICATE_ENTRY ingestion error seeded by
   * setupTestDatabase → seedMeasurementErrors.
   */
  async function resolveErrorID(errorSource: string, errorCode?: string): Promise<number> {
    const params: Array<string> = [errorSource];
    let whereClause = 'WHERE ErrorSource = ?';

    if (errorCode !== undefined) {
      whereClause += ' AND ErrorCode = ?';
      params.push(errorCode);
    }

    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT ErrorID FROM \`${config.database}\`.measurement_errors
       ${whereClause}
       ORDER BY ErrorID
       LIMIT 1`,
      params
    );

    if (rows.length === 0) {
      throw new Error(`resolveErrorID: no measurement_errors row found for source='${errorSource}'${errorCode ? ` code='${errorCode}'` : ''}`);
    }

    return rows[0].ErrorID;
  }

  /**
   * Inserts an unresolved measurement_error_log entry for the given measurement.
   */
  async function insertUnresolvedErrorLog(coreMeasurementID: number, errorID: number): Promise<void> {
    await connection.query(
      `INSERT INTO \`${config.database}\`.measurement_error_log (MeasurementID, ErrorID, IsResolved)
       VALUES (?, ?, FALSE)`,
      [coreMeasurementID, errorID]
    );
  }

  /**
   * Counts unresolved error_log rows for a measurement.
   */
  async function countUnresolvedErrorLogEntries(coreMeasurementID: number): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM \`${config.database}\`.measurement_error_log
       WHERE MeasurementID = ? AND IsResolved = FALSE`,
      [coreMeasurementID]
    );

    return Number(rows[0].count);
  }

  /**
   * Counts unresolved error_log rows for a measurement filtered by ErrorSource.
   */
  async function countUnresolvedErrorLogEntriesBySource(coreMeasurementID: number, errorSource: string): Promise<number> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM \`${config.database}\`.measurement_error_log mel
       JOIN \`${config.database}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ?
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = ?`,
      [coreMeasurementID, errorSource]
    );

    return Number(rows[0].count);
  }

  // =========================================================================
  // Classification helpers — mirror the SQL from route.ts
  // =========================================================================

  /**
   * Mirrors lookupMeasurementInActiveCensus: returns the full row when the
   * measurement belongs to the given census AND its stem is in an active
   * quadrat that belongs to the given plot.
   */
  async function lookupMeasurementInActiveCensus(coreMeasurementID: number, censusID: number, plotID: number): Promise<RowDataPacket | null> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT cm.CoreMeasurementID, cm.StemGUID, cm.MeasuredDBH, cm.MeasuredHOM,
              cm.MeasurementDate, cm.RawCodes, cm.Description
       FROM \`${config.database}\`.coremeasurements cm
       JOIN \`${config.database}\`.stems st
         ON st.StemGUID = cm.StemGUID AND st.IsActive = 1
       JOIN \`${config.database}\`.quadrats q
         ON q.QuadratID = st.QuadratID AND q.IsActive = 1
       WHERE cm.CoreMeasurementID = ?
         AND cm.CensusID = ?
         AND cm.IsActive = 1
         AND q.PlotID = ?`,
      [coreMeasurementID, censusID, plotID]
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Mirrors measurementExistsWithNullStem: detects failed measurements that
   * exist in the census but have no linked stem.
   */
  async function measurementExistsWithNullStem(coreMeasurementID: number, censusID: number): Promise<boolean> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT 1 FROM \`${config.database}\`.coremeasurements cm
       WHERE cm.CoreMeasurementID = ?
         AND cm.CensusID = ?
         AND cm.StemGUID IS NULL
       LIMIT 1`,
      [coreMeasurementID, censusID]
    );

    return rows.length > 0;
  }

  /**
   * Detects duplicate measurementIDs in a collection of file rows.
   * Mirrors detectDuplicateMeasurementIDs in route.ts.
   */
  function detectDuplicateMeasurementIDs(rows: Array<{ measurementID: string | null | undefined }>): string[] {
    const idCounts = new Map<string, number>();

    for (const row of rows) {
      const rawID = row.measurementID;
      if (rawID !== null && rawID !== undefined && String(rawID).trim() !== '') {
        const normalized = String(rawID).trim();
        idCounts.set(normalized, (idCounts.get(normalized) ?? 0) + 1);
      }
    }

    return Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id);
  }

  // =========================================================================
  // Apply helpers — mirror the SQL from apply/route.ts
  // =========================================================================

  /**
   * Applies a partial update to a coremeasurement row using only the non-blank
   * fields supplied in updateFields.  Mirrors buildUpdateClause + the UPDATE
   * statement in applyMatchedRowUpdate.
   *
   * Always resets IsValidated = NULL when at least one field is updated.
   *
   * Returns 'skipped' when no fields are non-blank.
   * Returns 'dup_entry_error' when MySQL raises ER_DUP_ENTRY.
   */
  async function applyMatchedRowUpdate(
    coreMeasurementID: number,
    updateFields: {
      dbh?: string | null;
      hom?: string | null;
      date?: string | null;
      codes?: string | null;
      comments?: string | null;
    }
  ): Promise<'updated' | 'skipped' | 'dup_entry_error'> {
    const setClauses: string[] = [];
    const setParams: (string | number | null)[] = [];

    if (updateFields.dbh !== null && updateFields.dbh !== undefined && updateFields.dbh.trim() !== '') {
      const parsed = parseFloat(updateFields.dbh.trim());
      if (!isNaN(parsed)) {
        setClauses.push('MeasuredDBH = ?');
        setParams.push(parsed);
      }
    }

    if (updateFields.hom !== null && updateFields.hom !== undefined && updateFields.hom.trim() !== '') {
      const parsed = parseFloat(updateFields.hom.trim());
      if (!isNaN(parsed)) {
        setClauses.push('MeasuredHOM = ?');
        setParams.push(parsed);
      }
    }

    if (updateFields.date !== null && updateFields.date !== undefined && updateFields.date.trim() !== '') {
      setClauses.push('MeasurementDate = ?');
      setParams.push(updateFields.date.trim());
    }

    if (updateFields.codes !== null && updateFields.codes !== undefined && updateFields.codes.trim() !== '') {
      setClauses.push('RawCodes = ?');
      setParams.push(updateFields.codes.trim());
    }

    if (updateFields.comments !== null && updateFields.comments !== undefined && updateFields.comments.trim() !== '') {
      const commentValue = updateFields.comments.trim();
      setClauses.push('Description = ?', 'RawComments = ?');
      setParams.push(commentValue, commentValue);
    }

    if (setClauses.length === 0) {
      return 'skipped';
    }

    setClauses.push('IsValidated = NULL');

    try {
      await connection.query(
        `UPDATE \`${config.database}\`.coremeasurements
         SET ${setClauses.join(', ')}
         WHERE CoreMeasurementID = ?`,
        [...setParams, coreMeasurementID]
      );
    } catch (error: any) {
      if (error.code === 'ER_DUP_ENTRY') {
        return 'dup_entry_error';
      }
      throw error;
    }

    // Rebuild cmattributes when codes were supplied — mirrors apply/route.ts
    if (updateFields.codes !== null && updateFields.codes !== undefined && updateFields.codes.trim() !== '') {
      await connection.query(`DELETE FROM \`${config.database}\`.cmattributes WHERE CoreMeasurementID = ?`, [coreMeasurementID]);

      const parsedCodes = updateFields.codes
        .trim()
        .split(';')
        .map(c => c.trim())
        .filter(c => c.length > 0);

      for (const code of parsedCodes) {
        await connection.query(`INSERT IGNORE INTO \`${config.database}\`.cmattributes (CoreMeasurementID, Code) VALUES (?, ?)`, [coreMeasurementID, code]);
      }
    }

    // Clear unresolved validation error log entries — mirrors apply/route.ts
    await connection.query(
      `DELETE mel
       FROM \`${config.database}\`.measurement_error_log mel
       JOIN \`${config.database}\`.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ?
         AND mel.IsResolved = FALSE
         AND me.ErrorSource = 'validation'`,
      [coreMeasurementID]
    );

    return 'updated';
  }

  // =========================================================================
  // Row Classification Tests
  // =========================================================================

  describe('Row Classification', () => {
    it('active measurement in census + plot → matched (StemGUID non-null, linked to active stem and quadrat)', async () => {
      const coreMeasurementID = await insertMeasurementRow();
      const censusID = testData.census[0].censusID;
      const plotID = testData.plots[0].plotID;

      const matched = await lookupMeasurementInActiveCensus(coreMeasurementID, censusID, plotID);

      expect(matched, 'Expected measurement to be found in active census for plot').not.toBeNull();
      expect(matched!.CoreMeasurementID).toBe(coreMeasurementID);
      expect(matched!.StemGUID, 'Matched row must have a non-null StemGUID').not.toBeNull();
    });

    it('measurementID pointing to a failed row (StemGUID IS NULL) → classified as invalid', async () => {
      const censusID = testData.census[0].censusID;

      const [insertResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO \`${config.database}\`.coremeasurements
           (StemGUID, CensusID, MeasuredDBH, MeasurementDate, SourceRowIndex, IsActive)
         VALUES (NULL, ?, ?, ?, ?, 1)`,
        [censusID, INITIAL_DBH, INITIAL_MEASUREMENT_DATE, SOURCE_ROW_INDEX_DEFAULT]
      );
      const failedCoreMeasurementID = insertResult.insertId;

      // lookupMeasurementInActiveCensus returns null because the JOIN on stems fails
      const plotID = testData.plots[0].plotID;
      const matched = await lookupMeasurementInActiveCensus(failedCoreMeasurementID, censusID, plotID);
      expect(matched, 'JOIN on stems/quadrats must exclude rows with null StemGUID').toBeNull();

      // Disambiguated path: measurementExistsWithNullStem correctly identifies the row
      const isFailedMeasurement = await measurementExistsWithNullStem(failedCoreMeasurementID, censusID);
      expect(isFailedMeasurement, 'Row with StemGUID=NULL must be detected as a failed measurement').toBe(true);
    });

    it('measurementID not found in census → classified as invalid with "not found" reason', async () => {
      const censusID = testData.census[0].censusID;
      const plotID = testData.plots[0].plotID;

      const matched = await lookupMeasurementInActiveCensus(NONEXISTENT_CORE_MEASUREMENT_ID, censusID, plotID);
      expect(matched, 'Non-existent ID must return null from lookup').toBeNull();

      const isFailedMeasurement = await measurementExistsWithNullStem(NONEXISTENT_CORE_MEASUREMENT_ID, censusID);
      expect(isFailedMeasurement, 'Non-existent ID must not match null-stem check either').toBe(false);
      // → caller would classify as "measurementID not found in the active census"
    });

    it('duplicate measurementIDs in file → entire file rejected before any DB lookup', () => {
      const duplicatedID = '42';

      const fileRows = [
        { measurementID: duplicatedID, dbh: '10.5' },
        { measurementID: '55', dbh: '12.0' },
        { measurementID: duplicatedID, dbh: '11.0' } // second occurrence
      ];

      const duplicates = detectDuplicateMeasurementIDs(fileRows);

      expect(duplicates, 'Duplicate detection must identify the repeated ID').toEqual([duplicatedID]);
      expect(duplicates).toHaveLength(1);
    });

    it('blank measurementID + all required fields present → classified as new candidate', () => {
      const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;

      const csvRow = {
        measurementID: '',
        tag: 'T-001',
        spcode: 'ACERRU',
        quadrat: 'Q01',
        lx: '5.0',
        ly: '10.0',
        date: '2025-01-01',
        dbh: '12.5'
      } as Record<string, string>;

      const missingFields = REQUIRED_INSERT_FIELDS.filter(field => {
        const value = csvRow[field];
        return value === null || value === undefined || String(value).trim() === '';
      });

      expect(missingFields, 'All required fields are present — must be classified as new').toHaveLength(0);
    });

    it('blank measurementID + missing required fields → classified as invalid with missing fields listed', () => {
      const REQUIRED_INSERT_FIELDS = ['tag', 'spcode', 'quadrat', 'lx', 'ly', 'date'] as const;

      // Row has tag + dbh but no spcode, quadrat, lx, ly, or date
      const sparseRow = {
        measurementID: '',
        tag: 'T-001',
        dbh: '12.5'
      } as Record<string, string>;

      const missingFields = REQUIRED_INSERT_FIELDS.filter(field => {
        const value = sparseRow[field];
        return value === null || value === undefined || String(value).trim() === '';
      });

      expect(missingFields, 'Sparse row must be detected as invalid with the correct missing fields').toEqual(
        expect.arrayContaining(['spcode', 'quadrat', 'lx', 'ly', 'date'])
      );
      expect(missingFields.length, 'Must report all five missing fields').toBe(5);
    });
  });

  // =========================================================================
  // Apply Update Tests
  // =========================================================================

  describe('Apply Updates', () => {
    it('non-destructive merge: blank CSV fields leave existing DB values intact', async () => {
      const coreMeasurementID = await insertMeasurementRow({
        measuredDBH: INITIAL_DBH,
        measuredHOM: INITIAL_HOM,
        description: INITIAL_DESCRIPTION
      });

      // Only supply dbh — hom and comments are intentionally blank
      const outcome = await applyMatchedRowUpdate(coreMeasurementID, {
        dbh: String(UPDATED_DBH),
        hom: null,
        comments: null
      });

      expect(outcome).toBe('updated');

      const row = await getMeasurementRow(coreMeasurementID);
      expect(parseFloat(row.MeasuredDBH)).toBe(UPDATED_DBH);
      expect(parseFloat(row.MeasuredHOM), 'HOM must remain unchanged when not supplied').toBe(INITIAL_HOM);
      expect(row.Description, 'Description must remain unchanged when not supplied').toBe(INITIAL_DESCRIPTION);
    });

    it('codes update deletes old cmattributes and inserts the new set', async () => {
      const coreMeasurementID = await insertMeasurementRow({ rawCodes: INITIAL_RAW_CODES });
      await insertAttributes(coreMeasurementID, [ATTRIBUTE_CODE_A, ATTRIBUTE_CODE_B]);

      const beforeCodes = await getAttributeCodes(coreMeasurementID);
      expect(beforeCodes).toEqual([ATTRIBUTE_CODE_A, ATTRIBUTE_CODE_B]);

      const outcome = await applyMatchedRowUpdate(coreMeasurementID, { codes: UPDATED_CODES });
      expect(outcome).toBe('updated');

      const afterCodes = await getAttributeCodes(coreMeasurementID);
      expect(afterCodes, 'Old attribute codes must be removed and replaced by new ones').toEqual([ATTRIBUTE_CODE_C, ATTRIBUTE_CODE_D]);

      const row = await getMeasurementRow(coreMeasurementID);
      expect(row.RawCodes).toBe('C; D');
    });

    it('comments update writes the same value to both Description and RawComments', async () => {
      const coreMeasurementID = await insertMeasurementRow({
        description: INITIAL_DESCRIPTION,
        rawComments: INITIAL_RAW_COMMENTS
      });

      const outcome = await applyMatchedRowUpdate(coreMeasurementID, { comments: UPDATED_COMMENT });
      expect(outcome).toBe('updated');

      const row = await getMeasurementRow(coreMeasurementID);
      expect(row.Description, 'Description must reflect the new comment').toBe(UPDATED_COMMENT);
      expect(row.RawComments, 'RawComments must reflect the new comment').toBe(UPDATED_COMMENT);
    });

    it('IsValidated is reset to NULL after any field update', async () => {
      // IsValidated is a BIT(1) column; mysql2 returns it as a Buffer, not a number.
      const coreMeasurementID = await insertMeasurementRow({ isValidated: IS_VALIDATED_BIT_TRUE });

      const rowBefore = await getMeasurementRow(coreMeasurementID);
      expect(readBitColumn(rowBefore.IsValidated as Buffer | null), 'Precondition: IsValidated must be set (1) before apply').toBe(true);

      const outcome = await applyMatchedRowUpdate(coreMeasurementID, { dbh: String(UPDATED_DBH) });
      expect(outcome).toBe('updated');

      const rowAfter = await getMeasurementRow(coreMeasurementID);
      expect(rowAfter.IsValidated, 'IsValidated must be NULL after any field change').toBeNull();
    });

    it('UploadFileID and UploadBatchID are preserved through an update', async () => {
      const coreMeasurementID = await insertMeasurementRow({
        uploadFileID: INITIAL_UPLOAD_FILE_ID,
        uploadBatchID: INITIAL_UPLOAD_BATCH_ID
      });

      const outcome = await applyMatchedRowUpdate(coreMeasurementID, { dbh: String(UPDATED_DBH) });
      expect(outcome).toBe('updated');

      const row = await getMeasurementRow(coreMeasurementID);
      expect(row.UploadFileID, 'UploadFileID must never be modified by a revision apply').toBe(INITIAL_UPLOAD_FILE_ID);
      expect(row.UploadBatchID, 'UploadBatchID must never be modified by a revision apply').toBe(INITIAL_UPLOAD_BATCH_ID);
    });

    it('unique constraint violation on update is surfaced as an apply error, not a thrown exception', async () => {
      const censusID = testData.census[0].censusID;
      const stemGUID = await resolveDefaultStemGUID();

      // The unique constraint being tested is:
      //   ux_measure_unique (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM)
      //
      // A second unique constraint ux_cm_uploadbatch_rowindex (UploadBatchID, SourceRowIndex)
      // must not be hit during the INSERT setup — give each row a distinct batch ID so only
      // the measurement-uniqueness constraint can be triggered by the UPDATE.
      const FIRST_DATE = '2024-03-01';
      const SECOND_DATE = '2024-03-02';
      const SHARED_DBH = 20.0;
      const SHARED_HOM = 1.3;

      await insertMeasurementRow({
        stemGUID,
        censusID,
        measurementDate: FIRST_DATE,
        measuredDBH: SHARED_DBH,
        measuredHOM: SHARED_HOM,
        uploadBatchID: 'constraint-test-batch-first'
      });

      const secondID = await insertMeasurementRow({
        stemGUID,
        censusID,
        measurementDate: SECOND_DATE,
        measuredDBH: SHARED_DBH + 5,
        measuredHOM: SHARED_HOM,
        uploadBatchID: 'constraint-test-batch-second'
      });

      // Attempt to update the second row's date + dbh to match the first row's unique key
      const outcome = await applyMatchedRowUpdate(secondID, {
        date: FIRST_DATE,
        dbh: String(SHARED_DBH)
      });

      expect(outcome, 'ER_DUP_ENTRY must be caught and returned as dup_entry_error, not re-thrown').toBe('dup_entry_error');
    });

    it('successful updates clear unresolved validation errors but preserve ingestion error history', async () => {
      const coreMeasurementID = await insertMeasurementRow();
      const duplicateErrorID = await resolveErrorID(INGESTION_ERROR_SOURCE, INGESTION_DUPLICATE_ERROR_CODE);
      const validationErrorID = await resolveErrorID(VALIDATION_ERROR_SOURCE);
      await insertUnresolvedErrorLog(coreMeasurementID, duplicateErrorID);
      await insertUnresolvedErrorLog(coreMeasurementID, validationErrorID);

      const countBefore = await countUnresolvedErrorLogEntries(coreMeasurementID);
      expect(countBefore, 'Precondition: must have one unresolved ingestion entry and one unresolved validation entry').toBe(2);

      const outcome = await applyMatchedRowUpdate(coreMeasurementID, { dbh: String(UPDATED_DBH) });
      expect(outcome).toBe('updated');

      const countAfter = await countUnresolvedErrorLogEntries(coreMeasurementID);
      expect(countAfter, 'Only ingestion error history should remain after a successful update').toBe(1);
      expect(await countUnresolvedErrorLogEntriesBySource(coreMeasurementID, VALIDATION_ERROR_SOURCE)).toBe(0);
      expect(await countUnresolvedErrorLogEntriesBySource(coreMeasurementID, INGESTION_ERROR_SOURCE)).toBe(1);
    });

    it('no-op apply (all fields blank) → skipped, database unchanged', async () => {
      // IsValidated is a BIT(1) column; mysql2 returns it as a Buffer, not a number.
      const coreMeasurementID = await insertMeasurementRow({
        measuredDBH: INITIAL_DBH,
        isValidated: IS_VALIDATED_BIT_TRUE
      });

      const outcome = await applyMatchedRowUpdate(coreMeasurementID, {
        dbh: null,
        hom: null,
        date: null,
        codes: null,
        comments: null
      });

      expect(outcome).toBe('skipped');

      const row = await getMeasurementRow(coreMeasurementID);
      expect(parseFloat(row.MeasuredDBH), 'DBH must be unchanged after skip').toBe(INITIAL_DBH);
      expect(readBitColumn(row.IsValidated as Buffer | null), 'IsValidated must NOT be reset when no fields are updated').toBe(true);
    });
  });
});
