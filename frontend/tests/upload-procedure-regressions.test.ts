import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSql(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8').replace(/\s+/g, ' ');
}

function extractSqlSegment(sql: string, startMarker: string, endMarker: string): string {
  const start = sql.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = sql.indexOf(endMarker, start + startMarker.length);
  expect(end).toBeGreaterThan(start);

  return sql.slice(start, end);
}

describe('upload procedure regressions', () => {
  it('uses bounded hashed upload ids in bulkingestionprocess sources', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');
    const migrationSql = readSql('db/migrations/ctfs-migrations/15_deploy_bulkingestionprocess.sql');

    for (const sql of [canonicalSql, migrationSql]) {
      expect(sql).toContain("SET vUploadId = LEFT( SHA2( CONCAT_WS( '#', DATABASE()");
      expect(sql).not.toContain("SET vUploadId = CONCAT(vFileID, '-', vBatchID);");
      expect(sql).not.toContain("SET vUploadId = CONCAT(vFileIDSafe, '-', vBatchIDSafe);");
    }
  });

  it('preserves collapser duplicate conflicts and writes complete alerts', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');
    const collapserSql = extractSqlSegment(canonicalSql, 'procedure bulkingestioncollapser', 'procedure clearcensusfull');

    expect(canonicalSql).toContain(
      'INSERT INTO uploadintegrityalerts (uploadId, fileID, batchID, plotID, censusID, type, message, severity, sourceRecords, processedRecords, failedRecords, missingRecords)'
    );
    expect(canonicalSql).not.toContain('INSERT INTO uploadintegrityalerts (plotID, censusID, type, message, severity, failedRecords)');
    expect(canonicalSql).toContain("DECLARE vAlertFileID VARCHAR(50) DEFAULT '__collapser__';");
    expect(canonicalSql).toContain("SET vAlertBatchID = CONCAT('census-', vCensusID);");
    expect(collapserSql).toContain("'COLLAPSER_STEM_DATE_CONFLICT'");
    expect(collapserSql).toContain("'COLLAPSER_TREE_STEM_TAG_CONFLICT'");
    expect(collapserSql).toContain('AND resolved = 0');
    expect(collapserSql).toContain('IF EXISTS ( SELECT 1 FROM uploadintegrityalerts');
    expect(collapserSql).toContain('ELSE INSERT INTO uploadintegrityalerts');
    expect(collapserSql).toContain('preserved for user review');
    expect(collapserSql).not.toContain('DELETE cm FROM coremeasurements');
    expect(collapserSql).not.toContain('ROW_NUMBER() OVER');
  });

  it('surfaces cross-batch TreeTag/StemTag conflicts instead of inserting a second success', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');
    const tableStructuresSql = readSql('db/sql/tablestructures.sql');
    const collisionSql = extractSqlSegment(
      canonicalSql,
      'CREATE TEMPORARY TABLE existing_tag_stemtag_collision_failures',
      'DROP TEMPORARY TABLE IF EXISTS existing_tag_stemtag_collision_failures'
    );

    expect(collisionSql).toContain("'DUPLICATE_TAG_CONFLICT_EXISTING'");
    // STRAIGHT_JOIN (not INNER JOIN) is load-bearing: it pins the batch-driven join order
    // so the optimizer can never flip to the trees x coremeasurements pair explosion that
    // stalled the 2026-07-28 Harvard census upload (8s -> 1,500s+ per sub-batch).
    expect(collisionSql).toMatch(
      /FROM resolved_batch_rows rbr STRAIGHT_JOIN trees t_existing[\s\S]*STRAIGHT_JOIN stems s_existing[\s\S]*STRAIGHT_JOIN coremeasurements cm_existing_stem/
    );
    expect(collisionSql).not.toContain('INNER JOIN trees t_existing');
    expect(collisionSql).not.toContain('INNER JOIN stems s_existing');
    expect(collisionSql).not.toContain('INNER JOIN coremeasurements cm_existing_stem');
    expect(canonicalSql).toContain('CREATE TEMPORARY TABLE prior_core_insert_failure_rows');
    expect(collisionSql).toContain('LEFT JOIN prior_core_insert_failure_rows prior_failure');
    expect(collisionSql).toContain('incoming row preserved for review');
    expect(canonicalSql).toContain('SELECT COUNT(*) FROM existing_tag_stemtag_collision_failures');

    // Pin the permanent indexes that make the forced batch-driven order one lookup per stage.
    expect(tableStructuresSql).toContain('create index idx_trees_tag_census_active on trees (TreeTag, CensusID, IsActive)');
    expect(tableStructuresSql).toContain('constraint ux_stems_treeid_stemtag_census unique (TreeID, StemTag, CensusID)');
    expect(tableStructuresSql).toContain('constraint ux_measure_unique unique (StemGUID, CensusID, MeasurementDate, MeasuredDBH, MeasuredHOM)');
  });

  it('cleans up stale failed sub-batches before retrying the same batch id', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');

    expect(canonicalSql).toContain("AND status IN ('processing', 'failed')");
    expect(canonicalSql).toContain("WHERE batchID = vBatchID AND censusID = vCurrentCensusID AND status IN ('processing', 'failed');");
  });

  it('uses duplicate-tolerant stem inserts for within-batch stem collisions', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');

    expect(canonicalSql).toContain(
      'INSERT IGNORE INTO stems (TreeID, QuadratID, CensusID, StemCrossID, PublishedStemID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)'
    );
    expect(canonicalSql).not.toContain(
      'INSERT INTO stems (TreeID, QuadratID, CensusID, StemCrossID, PublishedStemID, StemTag, LocalX, LocalY, Moved, StemDescription, IsActive)'
    );
  });

  it('degrades duplicate coremeasurement candidates to row-level failures', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');

    expect(canonicalSql).toContain('CREATE TEMPORARY TABLE source_row_insert_conflicts AS');
    expect(canonicalSql).toContain("'Measurement insert skipped: source row resolved to multiple candidate measurements'");
    expect(canonicalSql).toContain(
      'INSERT IGNORE INTO coremeasurements (CensusID, StemGUID, IsValidated, MeasurementDate, MeasuredDBH, MeasuredHOM, Description, UserDefinedFields, UploadFileID, UploadBatchID, RawTreeTag, RawStemTag, RawSpCode, RawQuadrat, RawX, RawY, RawCodes, RawPublishedStemID, RawComments, SourceRowIndex, IsActive)'
    );
    expect(canonicalSql).toContain('FROM core_insert_candidates cic ORDER BY cic.id;');
    expect(canonicalSql).toContain('core_insert_candidates, source_row_insert_conflicts, core_insert_failures, resolved_coremeasurements');
  });

  it('does not mislabel classified core insert failures as orphaned measurements', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');

    expect(canonicalSql).toContain('IF EXISTS(SELECT 1 FROM orphaned_rows) THEN');
    expect(canonicalSql).not.toContain('IF EXISTS(SELECT 1 FROM core_insert_failures) OR EXISTS(SELECT 1 FROM orphaned_rows) THEN');
    expect(canonicalSql).toContain('SET @orphaned_filtered = (SELECT COUNT(*) FROM orphaned_rows)');
  });

  it('backfills uploaded PublishedStemID through stem resolution with conflict guards', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');
    const tableStructuresSql = readSql('db/sql/tablestructures.sql');

    expect(canonicalSql).toContain('srr.UploadedPublishedStemID AS PublishedStemID');
    expect(canonicalSql).toContain("'PUBLISHED_STEMID_CONFLICT'");
    expect(canonicalSql).toContain('SET s_target.PublishedStemID = rbr.PublishedStemID');
    expect(canonicalSql).toContain('RawCodes, RawPublishedStemID, RawComments');
    expect(tableStructuresSql).toContain("('ingestion', 'PUBLISHED_STEMID_CONFLICT'");
  });

  it('builds a deduped previous-census lookup before cross-census location validation aggregation', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');

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
    const canonicalSql = readSql('db/sql/storedprocedures.sql');

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
    const canonicalSql = readSql('db/sql/storedprocedures.sql');
    const tableStructuresSql = readSql('db/sql/tablestructures.sql');

    expect(canonicalSql).not.toContain("SELECT id, 'INVALID_ATTRIBUTE_CODE', FailureReason");
    expect(canonicalSql).toContain("ON me.ErrorSource = 'validation' AND me.ErrorCode = '14'");
    expect(canonicalSql).toContain('LEFT JOIN attributes a ON a.Code = tc.Code AND a.IsActive = 1');
    expect(tableStructuresSql).toContain("('validation', '14', 'Invalid attribute code')");
    expect(tableStructuresSql).not.toContain('INVALID_ATTRIBUTE_CODE');
  });

  it('rebuilds validation 14 from RawCodes during validation reruns', () => {
    const coreQueriesSql = readSql('db/sql/corequeries.sql');
    const procedureSql = readSql('db/sql/storedprocedures.sql');
    const migrationSql = readSql('db/migrations/unified-measurements-migrations/53_reapply_validation14_rawcodes_replay.sql');

    const coreValidation14 = extractSqlSegment(
      coreQueriesSql,
      "VALUES (14, 'ValidateFindInvalidAttributeCodes'",
      "VALUES (15, 'ValidateFindAbnormallyHighDBH'"
    );
    const procedureValidation14 = extractSqlSegment(
      procedureSql,
      "VALUES (14, 'ValidateFindInvalidAttributeCodes'",
      "VALUES (15, 'ValidateFindAbnormallyHighDBH'"
    );

    for (const sql of [coreValidation14, procedureValidation14, migrationSql]) {
      expect(sql).toContain('cm.RawCodes');
      expect(sql).toContain('cross join json_table(');
      expect(sql).toContain("and TRIM(jt.code) != ''");
      expect(sql).not.toContain('join cmattributes cma on cm.CoreMeasurementID = cma.CoreMeasurementID');
    }
  });

  it('ignores empty code tokens created by doubled or trailing semicolons', () => {
    const canonicalSql = readSql('db/sql/storedprocedures.sql');
    const ctfsMigrationSql = readSql('db/migrations/ctfs-migrations/15_deploy_bulkingestionprocess.sql');

    expect(canonicalSql).toContain("WHERE rcm.Codes IS NOT NULL AND TRIM(rcm.Codes) != '' AND TRIM(jt.code) != '';");
    expect(ctfsMigrationSql).toContain("WHERE f.Codes is not null AND trim(f.Codes) != '' AND trim(jt.code) != '';");
  });
});
