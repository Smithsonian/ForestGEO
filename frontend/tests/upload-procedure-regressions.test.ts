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
    expect(canonicalSql).not.toContain(
      'INSERT INTO uploadintegrityalerts (plotID, censusID, type, message, severity, failedRecords)'
    );
    expect(canonicalSql).toContain("DECLARE vAlertFileID VARCHAR(50) DEFAULT '__collapser__';");
    expect(canonicalSql).toContain("SET vAlertBatchID = CONCAT('census-', vCensusID);");
  });
});
