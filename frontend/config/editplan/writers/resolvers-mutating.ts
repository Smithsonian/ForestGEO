// Mutating tree / stem / quadrat resolvers.
//
// These helpers are the "apply-side" counterparts to the read-only planners in
// `config/editplan/resolvers.ts`. The planners inspect the database without
// writing so the analyzer can preview what an edit would do; the helpers here
// actually mutate rows when an edit is applied.
//
// Extracted from `config/macros/coreapifunctions.ts` so the new editplan writer
// and the legacy PATCH handler can share the same implementation while Task 18
// cuts the legacy handler over.
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export type TreeStemStateLabel = 'old tree' | 'multi stem' | 'new recruit';

export interface MeasurementSummaryStructure {
  TreeTag?: string | null;
  CensusID?: number | null;
  SpeciesID?: number | null;
  TreeID?: number | null;
  StemTag?: string | null;
  StemGUID?: number | null;
  QuadratID?: number | null;
  StemLocalX?: number | null;
  StemLocalY?: number | null;
  PlotID?: number | null;
  QuadratName?: string | null;
}

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function computeTreeStemState(
  connectionManager: ConnectionManager,
  schema: string,
  treeTag: string,
  stemTag: string,
  currentCensusID: number,
  plotID: number,
  transactionID?: string
): Promise<TreeStemStateLabel> {
  const prevCensusRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT c_prev.CensusID
       FROM ??.census c_curr
       INNER JOIN ??.census c_prev
         ON c_prev.PlotID = c_curr.PlotID
         AND c_prev.PlotCensusNumber = c_curr.PlotCensusNumber - 1
         AND c_prev.IsActive = 1
       WHERE c_curr.CensusID = ?
         AND c_curr.PlotID = ?
         AND c_curr.IsActive = 1
       ORDER BY c_prev.CensusID DESC
       LIMIT 1`
    ),
    [currentCensusID, plotID],
    transactionID
  );

  if (prevCensusRows.length === 0) {
    return 'new recruit';
  }

  const previousCensusID = prevCensusRows[0].CensusID;

  const prevStemMatch = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT COUNT(*) AS MatchCount
       FROM ??.stems s
       INNER JOIN ??.trees t
         ON s.TreeID = t.TreeID AND s.CensusID = t.CensusID
       WHERE t.TreeTag = ?
         AND s.StemTag = ?
         AND t.CensusID = ?
         AND t.IsActive = 1
         AND s.IsActive = 1`
    ),
    [treeTag, stemTag, previousCensusID],
    transactionID
  );

  if (prevStemMatch[0]?.MatchCount > 0) {
    return 'old tree';
  }

  const prevTreeMatch = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT COUNT(*) AS MatchCount
       FROM ??.trees t
       WHERE t.TreeTag = ?
         AND t.CensusID = ?
         AND t.IsActive = 1`
    ),
    [treeTag, previousCensusID],
    transactionID
  );

  if (prevTreeMatch[0]?.MatchCount > 0) {
    return 'multi stem';
  }

  return 'new recruit';
}

export async function resolveMeasurementSummaryQuadratID(
  connectionManager: ConnectionManager,
  schema: string,
  quadratData: Pick<MeasurementSummaryStructure, 'QuadratID' | 'QuadratName' | 'PlotID'>,
  transactionID?: string
): Promise<number> {
  const quadratID = toPositiveNumber(quadratData.QuadratID);
  if (quadratID !== null) return quadratID;

  const plotID = toPositiveNumber(quadratData.PlotID);
  const quadratName = quadratData.QuadratName?.trim();
  if (!plotID) throw new Error('Plot not found for quadrat lookup');
  if (!quadratName) throw new Error('Quadrat not found for stem resolution');

  const quadratSearchResults = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT QuadratID
       FROM ??.quadrats
       WHERE LOWER(QuadratName) = LOWER(?)
         AND PlotID = ?
         AND IsActive = 1
       ORDER BY QuadratID
       LIMIT 1`
    ),
    [quadratName, plotID],
    transactionID
  );
  if (quadratSearchResults.length === 0) throw new Error('Quadrat not found');
  return quadratSearchResults[0].QuadratID;
}

export async function resolveMeasurementSummaryTree(
  connectionManager: ConnectionManager,
  schema: string,
  treeData: Pick<MeasurementSummaryStructure, 'TreeTag' | 'SpeciesID' | 'CensusID'>,
  transactionID?: string
): Promise<number> {
  const { TreeTag, SpeciesID, CensusID } = treeData;
  if (!TreeTag) throw new Error('TreeTag not found for tree resolution');
  const normalizedSpeciesID = toPositiveNumber(SpeciesID);
  const normalizedCensusID = toPositiveNumber(CensusID);
  if (normalizedSpeciesID === null) throw new Error('Species not found for tree resolution');
  if (normalizedCensusID === null) throw new Error('Census not found for tree resolution');

  const matchingTreeRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT TreeID, IsActive
       FROM ??.trees
       WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?
       ORDER BY TreeID
       LIMIT 1`
    ),
    [TreeTag, normalizedSpeciesID, normalizedCensusID],
    transactionID
  );
  if (matchingTreeRows.length > 0) {
    const matchingTree = matchingTreeRows[0];
    if (!matchingTree.IsActive) throw new Error(`Tree resolution failed: matching tree exists but is inactive for TreeTag "${TreeTag}"`);
    return matchingTree.TreeID;
  }

  const insertResult = await connectionManager.executeQuery(
    format(`INSERT INTO ?? SET ?`, [`${schema}.trees`, { TreeTag, SpeciesID: normalizedSpeciesID, CensusID: normalizedCensusID, IsActive: 1 }]),
    [],
    transactionID
  );
  return insertResult.insertId;
}

export async function resolveMeasurementSummaryStem(
  connectionManager: ConnectionManager,
  schema: string,
  stemData: Pick<MeasurementSummaryStructure, 'TreeID' | 'TreeTag' | 'CensusID' | 'StemTag' | 'QuadratID' | 'StemLocalX' | 'StemLocalY'>,
  transactionID?: string
): Promise<number> {
  const { TreeID, TreeTag, CensusID, StemTag, QuadratID, StemLocalX, StemLocalY } = stemData;
  const normalizedTreeID = toPositiveNumber(TreeID);
  const normalizedCensusID = toPositiveNumber(CensusID);
  const normalizedQuadratID = toPositiveNumber(QuadratID);
  if (normalizedTreeID === null) throw new Error('Tree not found for stem resolution');
  if (normalizedCensusID === null) throw new Error('Census not found for stem resolution');
  if (!StemTag) throw new Error('StemTag not found for stem resolution');
  if (normalizedQuadratID === null) throw new Error('Quadrat not found for stem resolution');

  const exactActiveStemRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT StemGUID
       FROM ??.stems
       WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? AND QuadratID <=> ? AND IsActive = 1
       LIMIT 1`
    ),
    [normalizedTreeID, normalizedCensusID, StemTag, normalizedQuadratID],
    transactionID
  );
  if (exactActiveStemRows.length > 0) return exactActiveStemRows[0].StemGUID;

  const blockingStemRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT StemGUID, QuadratID, IsActive
       FROM ??.stems
       WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ?
       ORDER BY StemGUID
       LIMIT 1`
    ),
    [normalizedTreeID, normalizedCensusID, StemTag],
    transactionID
  );
  if (blockingStemRows.length > 0) {
    const blockingStem = blockingStemRows[0];
    if (!blockingStem.IsActive) {
      throw new Error(`Stem resolution failed: matching TreeID ${normalizedTreeID} / StemTag "${StemTag}" exists but is inactive for this census`);
    }
    if (blockingStem.QuadratID !== normalizedQuadratID) {
      throw new Error(
        `Stem resolution failed: TreeTag "${TreeTag ?? normalizedTreeID}" / StemTag "${StemTag}" already exists in a different quadrat for this census`
      );
    }
    return blockingStem.StemGUID;
  }

  const insertResult = await connectionManager.executeQuery(
    format(`INSERT INTO ?? SET ?`, [
      `${schema}.stems`,
      {
        TreeID: normalizedTreeID,
        QuadratID: normalizedQuadratID,
        CensusID: normalizedCensusID,
        StemTag,
        LocalX: StemLocalX ?? null,
        LocalY: StemLocalY ?? null,
        IsActive: 1
      }
    ]),
    [],
    transactionID
  );
  return insertResult.insertId;
}
