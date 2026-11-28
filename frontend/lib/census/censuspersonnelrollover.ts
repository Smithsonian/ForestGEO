import type { TxExecutor } from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';
import type { CensusIdentity } from '@/lib/census/censusdateedit';

interface CensusActivePersonnelRow {
  CAPID: number;
}

/**
 * A new census starts with the previous census's active field team (#522). "Previous" is the highest active
 * census number below the new one in the same plot; personnel marked inactive (personnel.IsActive = FALSE) are
 * not carried forward. Species DBH limits are also kept per census but are deliberately not copied.
 * Returns the CAPIDs written for the new census.
 */
export async function copyActivePersonnelFromPreviousCensus(tx: TxExecutor, schema: string, newCensus: CensusIdentity): Promise<number[]> {
  await tx.query(
    safeFormatQuery(
      schema,
      `INSERT IGNORE INTO ??.censusactivepersonnel (CensusID, PersonnelID)
       SELECT ?, cap.PersonnelID
         FROM ??.censusactivepersonnel cap
         JOIN ??.personnel p ON p.PersonnelID = cap.PersonnelID AND p.IsActive = TRUE
        WHERE cap.CensusID = (
                SELECT previous.CensusID
                  FROM ??.census previous
                 WHERE previous.PlotID = ?
                   AND previous.CensusID <> ?
                   AND previous.PlotCensusNumber < ?
                   AND previous.IsActive = TRUE
                 ORDER BY previous.PlotCensusNumber DESC
                 LIMIT 1
              )`
    ),
    [newCensus.censusID, newCensus.plotID, newCensus.censusID, newCensus.plotCensusNumber]
  );
  const copied = await tx.query<CensusActivePersonnelRow[]>(
    safeFormatQuery(schema, 'SELECT CAPID FROM ??.censusactivepersonnel WHERE CensusID = ? ORDER BY CAPID'),
    [newCensus.censusID]
  );
  return copied.map(row => row.CAPID);
}
