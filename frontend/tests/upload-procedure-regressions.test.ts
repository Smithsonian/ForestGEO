import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSql(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\s+/g, ' ');
}

describe('upload procedure regressions', () => {
  it('uses bounded hashed upload ids in bulkingestionprocess sources', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');
    const migrationSql = readSql('db-migrations/ctfs-migrations/15_deploy_bulkingestionprocess.sql');

    for (const sql of [canonicalSql, migrationSql]) {
      expect(sql).toContain("SET vUploadId = LEFT( SHA2( CONCAT_WS( '#', DATABASE()");
      expect(sql).not.toContain("SET vUploadId = CONCAT(vFileID, '-', vBatchID);");
      expect(sql).not.toContain("SET vUploadId = CONCAT(vFileIDSafe, '-', vBatchIDSafe);");
    }
  });

  it('writes complete collapser deduplication alerts', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');

    expect(canonicalSql).toContain(
      'INSERT INTO uploadintegrityalerts (uploadId, fileID, batchID, plotID, censusID, type, message, severity, sourceRecords, processedRecords, failedRecords, missingRecords)'
    );
    expect(canonicalSql).not.toContain('INSERT INTO uploadintegrityalerts (plotID, censusID, type, message, severity, failedRecords)');
    expect(canonicalSql).toContain("DECLARE vAlertFileID VARCHAR(50) DEFAULT '__collapser__';");
    expect(canonicalSql).toContain("SET vAlertBatchID = CONCAT('census-', vCensusID);");
  });

  it('cleans up stale failed sub-batches before retrying the same batch id', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');

    expect(canonicalSql).toContain("AND status IN ('processing', 'failed')");
    expect(canonicalSql).toContain("WHERE batchID = vBatchID AND censusID = vCurrentCensusID AND status IN ('processing', 'failed');");
  });

  it('uses duplicate-tolerant stem inserts for within-batch stem collisions', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');

    expect(canonicalSql).toContain(
      'INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)'
    );
    expect(canonicalSql).not.toContain(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemCrossID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)'
    );
  });

  it('degrades duplicate coremeasurement candidates to row-level failures', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');

    expect(canonicalSql).toContain('CREATE TEMPORARY TABLE source_row_insert_conflicts AS');
    expect(canonicalSql).toContain("'Measurement insert skipped: source row resolved to multiple candidate measurements'");
    expect(canonicalSql).toContain(
      'INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields, UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawComments, SourceRowIndex, IsActive)'
    );
    expect(canonicalSql).toContain('FROM core_insert_candidates cic ORDER BY cic.id;');
    expect(canonicalSql).toContain('core_insert_candidates, source_row_insert_conflicts, core_insert_failures, resolved_coremeasurements');
  });

  it('builds a deduped previous-census lookup before cross-census location validation aggregation', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');

    expect(canonicalSql).toContain('CREATE TEMPORARY TABLE current_cross_census_previous_map');
    expect(canonicalSql).toContain('INSERT INTO current_cross_census_previous_map (CurrentCensusID, PreviousCensusID)');
    expect(canonicalSql).toContain('SELECT c.CensusID, MAX(c_prev.CensusID) AS PreviousCensusID');
    expect(canonicalSql).toContain('CREATE TEMPORARY TABLE current_cross_census_keys');
    expect(canonicalSql).toContain('INSERT IGNORE INTO current_cross_census_keys (PreviousCensusID, TreeTag, StemTag)');
    expect(canonicalSql).toContain('CREATE TEMPORARY TABLE previous_cross_census_lookup');
    expect(canonicalSql).toContain('SELECT DISTINCT scope_keys.PreviousCensusID,');
    expect(canonicalSql).toContain('FROM current_cross_census_scope scope JOIN previous_cross_census_lookup prev_lookup');
    expect(canonicalSql).toContain('GROUP BY scope.CoreMeasurementID;');
    expect(canonicalSql).toContain('JOIN current_cross_census_previous_map prev_map ON prev_map.CurrentCensusID = c.CensusID');
    expect(canonicalSql).not.toContain('INSERT INTO measurement_error_log (MeasurementID, ErrorID) SELECT scope.CoreMeasurementID');
  });

  it('uses PlotCensusNumber for previous-census selection and user-facing messages', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');

    expect(canonicalSql).toContain('DECLARE vCurrentPlotCensusNumber INT DEFAULT NULL;');
    expect(canonicalSql).toContain('DECLARE vPreviousPlotCensusNumber INT DEFAULT NULL;');
    expect(canonicalSql).toContain('SELECT tm.CensusID, tm.PlotID, c.PlotCensusNumber');
    expect(canonicalSql).toContain('INTO vCurrentCensusID, vCurrentPlotID, vCurrentPlotCensusNumber');
    expect(canonicalSql).toContain('INTO vPreviousCensusID, vPreviousPlotCensusNumber');
    expect(canonicalSql).toContain('AND c_prev.PlotCensusNumber = vCurrentPlotCensusNumber - 1');
    expect(canonicalSql).toContain("' active trees in Census ', vPreviousPlotCensusNumber");
    expect(canonicalSql).toContain("' active stems in Census ', vPreviousPlotCensusNumber");
    expect(canonicalSql).not.toContain("' active trees in census ', vPreviousCensusID");
    expect(canonicalSql).not.toContain("' active stems in census ', vPreviousCensusID");
  });

  it('keeps invalid attribute codes as soft validation 14 instead of hard-failing them', () => {
    const canonicalSql = readSql('sqlscripting/storedprocedures.sql');
    const tableStructuresSql = readSql('sqlscripting/tablestructures.sql');

    expect(canonicalSql).not.toContain("SELECT id, 'INVALID_ATTRIBUTE_CODE', FailureReason");
    expect(canonicalSql).toContain("ON me.ErrorSource = 'validation' AND me.ErrorCode = '14'");
    expect(canonicalSql).toContain('LEFT JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1');
    expect(tableStructuresSql).toContain("('validation', '14', 'Invalid attribute code')");
    expect(tableStructuresSql).not.toContain('INVALID_ATTRIBUTE_CODE');
  });
});
