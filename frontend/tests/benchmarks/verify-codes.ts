/**
 * Verify that the tempcodes optimization correctly assigns attribute codes.
 * Tests single codes, multi-codes (A;D), and confirms cmattributes entries.
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const DB_CONFIG = { host: 'localhost', port: 3306, user: 'root', password: 'testpassword', multipleStatements: true };

async function main() {
  const dbName = `verify_codes_${Date.now()}`;
  const conn = await mysql.createConnection(DB_CONFIG);
  await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await conn.query(`USE \`${dbName}\``);

  // Load schema
  const schema = fs.readFileSync(path.join(process.cwd(), 'sqlscripting/tablestructures.sql'), 'utf-8');
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const s of schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))) {
    try {
      await conn.query(s);
    } catch {
      /* ignore expected */
    }
  }
  await conn.query('SET FOREIGN_KEY_CHECKS = 1');

  // Load procs
  const procContent = fs
    .readFileSync(path.join(process.cwd(), 'sqlscripting/storedprocedures.sql'), 'utf-8')
    .replace(/DELIMITER\s+\$\$/gi, '')
    .replace(/DELIMITER\s+;/gi, '');
  for (const s of procContent
    .split('$$')
    .map(s => s.trim())
    .filter(s => s.length >= 10)) {
    try {
      await conn.query(s.replace(/definer\s*=\s*`?[^`\s]+`?@`?[^`\s]+`?\s*/gi, ''));
    } catch {
      /* ignore */
    }
  }

  // Seed error definitions
  await conn.query(`INSERT IGNORE INTO measurement_errors (ErrorSource, ErrorCode, ErrorMessage)
    VALUES ('ingestion', 'SQL_EXCEPTION', 'err'),
           ('ingestion', 'INVALID_ATTRIBUTE_CODE', 'Row contains invalid attribute code(s)'),
           ('validation', '14', 'Invalid attribute code')`);

  // Base data
  await conn.query(`INSERT INTO species (SpeciesCode,SpeciesName,IDLevel,IsActive) VALUES ('ACERRU','Acer','species',1)`);
  await conn.query(`INSERT INTO attributes (Code,Description,Status,IsActive) VALUES ('A','Alive','alive',1),('D','Dead','dead',1)`);
  await conn.query(`INSERT INTO plots (PlotName,LocationName,CountryName,DimensionX,DimensionY,Area,GlobalX,GlobalY,GlobalZ,PlotShape,PlotDescription)
    VALUES ('P','L','C',100,100,10000,0,0,0,'square','d')`);
  const [[{ PlotID: plotID }]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS PlotID');
  await conn.query(
    `INSERT INTO quadrats (PlotID,QuadratName,StartX,StartY,DimensionX,DimensionY,Area,QuadratShape)
    VALUES (?,'Q01',0,0,10,10,100,'square')`,
    [plotID]
  );
  await conn.query(`INSERT INTO census (PlotID,PlotCensusNumber,StartDate,EndDate,IsActive) VALUES (?,1,'2024-01-01','2024-12-31',1)`, [plotID]);
  const [[{ CensusID: c1 }]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');
  await conn.query(`INSERT INTO census (PlotID,PlotCensusNumber,StartDate,EndDate,IsActive) VALUES (?,2,'2025-01-01','2025-12-31',1)`, [plotID]);
  const [[{ CensusID: c2 }]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS CensusID');
  const [[{ SpeciesID: spID }]] = await conn.query<mysql.RowDataPacket[]>(`SELECT SpeciesID FROM species WHERE SpeciesCode='ACERRU'`);

  // Seed census 1 (3 trees)
  for (let i = 1; i <= 5; i++) {
    await conn.query(`INSERT INTO trees (TreeTag,SpeciesID,CensusID,IsActive) VALUES (?,?,?,1)`, [`T${i}`, spID, c1]);
    const [[{ TreeID: tid }]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS TreeID');
    await conn.query(`INSERT INTO stems (TreeID,QuadratID,CensusID,StemTag,LocalX,LocalY,IsActive) VALUES (?,?,?,?,?,?,1)`, [tid, plotID, c1, '1', i, i]);
    const [[{ StemGUID: sguid }]] = await conn.query<mysql.RowDataPacket[]>('SELECT LAST_INSERT_ID() AS StemGUID');
    await conn.query(
      `INSERT INTO coremeasurements (StemGUID,CensusID,MeasuredDBH,MeasuredHOM,MeasurementDate,IsValidated,IsActive)
      VALUES (?,?,?,1.3,'2024-06-15',1,1)`,
      [sguid, c1, 10 + i]
    );
  }

  // Stage census 2: T1->A, T2->D, T3->A;D (multi-code)
  const fileID = 'verify.csv';
  const batchID = 'batch_001';
  await conn.query(
    `INSERT INTO temporarymeasurements
     (FileID,BatchID,PlotID,CensusID,TreeTag,StemTag,SpeciesCode,QuadratName,LocalX,LocalY,DBH,HOM,MeasurementDate,Codes,Comments)
     VALUES
     (?,?,?,?,'T1','1','ACERRU','Q01',1,1,11,1.3,'2025-06-15','A',NULL),
     (?,?,?,?,'T2','1','ACERRU','Q01',2,2,12,1.3,'2025-06-15','D',NULL),
     (?,?,?,?,'T3','1','ACERRU','Q01',3,3,13,1.3,'2025-06-15','A;D',NULL),
     (?,?,?,?,'T4','1','ACERRU','Q01',4,4,14,1.3,'2025-06-15','MX',NULL),
     (?,?,?,?,'T5','1','ACERRU','Q01',5,5,15,1.3,'2025-06-15','D;MX',NULL)`,
    [fileID, batchID, plotID, c2, fileID, batchID, plotID, c2, fileID, batchID, plotID, c2, fileID, batchID, plotID, c2, fileID, batchID, plotID, c2]
  );

  // Run ingest
  await conn.query('CALL bulkingestionprocess(?,?)', [fileID, batchID]);

  // Check results
  const [cmRows] = await conn.query<mysql.RowDataPacket[]>(
    'SELECT CoreMeasurementID, RawTreeTag, RawCodes FROM coremeasurements WHERE CensusID=? AND StemGUID IS NOT NULL ORDER BY RawTreeTag',
    [c2]
  );
  const [attrRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ca.CoreMeasurementID, ca.Code FROM cmattributes ca
     JOIN coremeasurements cm ON cm.CoreMeasurementID=ca.CoreMeasurementID
     WHERE cm.CensusID=? ORDER BY ca.CoreMeasurementID, ca.Code`,
    [c2]
  );

  console.log('Measurements:', JSON.stringify(cmRows));
  console.log('Attributes:', JSON.stringify(attrRows));

  // Verify
  const getCodes = (tag: string) => {
    const cm = cmRows.find((r: any) => r.RawTreeTag === tag);
    if (!cm) return [];
    return attrRows
      .filter((r: any) => r.CoreMeasurementID === cm.CoreMeasurementID)
      .map((r: any) => r.Code)
      .sort();
  };

  const t1Codes = getCodes('T1');
  const t2Codes = getCodes('T2');
  const t3Codes = getCodes('T3');

  console.log(`T1 codes: [${t1Codes}] (expected: [A])`);
  console.log(`T2 codes: [${t2Codes}] (expected: [D])`);
  console.log(`T3 codes: [${t3Codes}] (expected: [A,D])`);

  // T4: all invalid code "MX" → should hard-fail (StemGUID IS NULL)
  const [t4Failed] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT CoreMeasurementID, RawCodes, Description FROM coremeasurements
     WHERE CensusID=? AND RawTreeTag='T4' AND StemGUID IS NULL`,
    [c2]
  );
  const t4Pass = t4Failed.length === 1 && (t4Failed[0].Description as string).includes('MX');
  console.log(`T4 failed: ${t4Failed.length === 1} reason includes MX: ${t4Pass} (expected: true)`);

  // T5: mixed code "D;MX" → should hard-fail entirely (not partial success)
  const [t5Failed] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT CoreMeasurementID, RawCodes, Description FROM coremeasurements
     WHERE CensusID=? AND RawTreeTag='T5' AND StemGUID IS NULL`,
    [c2]
  );
  const t5Pass = t5Failed.length === 1 && (t5Failed[0].Description as string).includes('MX');
  console.log(`T5 failed: ${t5Failed.length === 1} reason includes MX: ${t5Pass} (expected: true)`);

  // Verify no cmattributes for T4 or T5
  const [t4t5Attrs] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT ca.Code FROM cmattributes ca
     JOIN coremeasurements cm ON cm.CoreMeasurementID=ca.CoreMeasurementID
     WHERE cm.CensusID=? AND cm.RawTreeTag IN ('T4','T5')`,
    [c2]
  );
  const noAttrsPass = t4t5Attrs.length === 0;
  console.log(`T4/T5 no attrs: ${noAttrsPass} (expected: true)`);

  // Verify measurement_error_log has INVALID_ATTRIBUTE_CODE for T4 and T5
  const [errorLogRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT cm.RawTreeTag, me.ErrorCode FROM measurement_error_log mel
     JOIN coremeasurements cm ON cm.CoreMeasurementID=mel.MeasurementID
     JOIN measurement_errors me ON me.ErrorID=mel.ErrorID
     WHERE cm.CensusID=? AND me.ErrorCode='INVALID_ATTRIBUTE_CODE'
     ORDER BY cm.RawTreeTag`,
    [c2]
  );
  const errorLogPass =
    errorLogRows.length === 2 && errorLogRows.some((r: any) => r.RawTreeTag === 'T4') && errorLogRows.some((r: any) => r.RawTreeTag === 'T5');
  console.log(`Error log entries: ${errorLogRows.length} (expected: 2), pass: ${errorLogPass}`);

  const pass =
    t1Codes.length === 1 &&
    t1Codes[0] === 'A' &&
    t2Codes.length === 1 &&
    t2Codes[0] === 'D' &&
    t3Codes.length === 2 &&
    t3Codes[0] === 'A' &&
    t3Codes[1] === 'D' &&
    t4Pass &&
    t5Pass &&
    noAttrsPass &&
    errorLogPass;

  console.log(pass ? '\nPASS: Codes correctly assigned and invalid codes hard-fail' : '\nFAIL: Code handling broken');

  await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  await conn.end();
  process.exit(pass ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
