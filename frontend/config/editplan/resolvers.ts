import ConnectionManager from '@/lib/db/connectionmanager';
import { safeFormatQuery } from '@/lib/db/sqlsecurity';

export interface ResolveSpeciesResult {
  speciesID: number | null;
}

export interface PlanTreeInput {
  TreeTag: string;
  SpeciesID: number;
  CensusID: number;
  currentTreeID: number | null;
}

export interface PlanTreeResult {
  existingTreeID: number | null;
  wouldCreate: boolean;
  sourceTreeID: number | null;
  sourceTreeRemainingStems: number;
  conflictReason?: string;
  conflictingTreeID?: number;
  conflictingSpeciesCode?: string;
}

export interface PlanStemInput {
  TreeID: number;
  CensusID: number;
  StemTag: string;
  QuadratID: number;
  currentStemGUID: number | null;
}

export interface PlanStemResult {
  existingStemGUID: number | null;
  wouldCreate: boolean;
  sourceStemGUID: number | null;
  sourceStemRemainingMeasurements: number;
  conflictReason?: string;
}

export interface PlanQuadratInput {
  QuadratName: string;
  PlotID: number;
}

export interface PlanQuadratResult {
  quadratID: number | null;
}

export const CONFLICT_REASON_INACTIVE_STEM = 'matching stem is inactive';
export const CONFLICT_REASON_DIFFERENT_QUADRAT = 'stem exists in a different quadrat';
export const CONFLICT_REASON_INACTIVE_TREE = 'matching tree is inactive';
export const CONFLICT_REASON_SPECIES_CONFLICT = 'tree tag is already recorded under a different species in this census';

export async function resolveSpeciesByCode(
  connectionManager: ConnectionManager,
  schema: string,
  code: string,
  transactionID?: string
): Promise<ResolveSpeciesResult> {
  const rows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT SpeciesID
       FROM ??.species
       WHERE LOWER(SpeciesCode) = LOWER(?) AND IsActive = 1
       ORDER BY SpeciesID
       LIMIT 1`
    ),
    [code],
    transactionID
  );
  return { speciesID: rows.length ? Number(rows[0].SpeciesID) : null };
}

export async function planTreeResolution(
  connectionManager: ConnectionManager,
  schema: string,
  input: PlanTreeInput,
  transactionID?: string
): Promise<PlanTreeResult> {
  const existingRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT TreeID, IsActive
       FROM ??.trees
       WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?
       ORDER BY TreeID
       LIMIT 1`
    ),
    [input.TreeTag, input.SpeciesID, input.CensusID],
    transactionID
  );

  const hasInactiveMatch = existingRows.length > 0 && !existingRows[0].IsActive;
  const existingTreeID = existingRows.length && existingRows[0].IsActive ? Number(existingRows[0].TreeID) : null;
  // An inactive tree row with the same TreeTag+SpeciesID+CensusID would
  // collide with the unique constraint ux_trees_treetag_speciesid_censusid,
  // so the planner cannot promise a new insert in that case.
  const otherSpeciesTree = existingRows.length === 0 ? await findActiveTreeWithOtherSpecies(connectionManager, schema, input, transactionID) : null;
  const wouldCreate = !hasInactiveMatch && existingTreeID === null && otherSpeciesTree === null;

  let sourceTreeRemainingStems = 0;
  if (input.currentTreeID !== null && input.currentTreeID !== existingTreeID) {
    const remaining = await connectionManager.executeQuery(
      safeFormatQuery(
        schema,
        `SELECT COUNT(*) AS cnt
         FROM ??.stems
         WHERE TreeID = ? AND IsActive = 1`
      ),
      [input.currentTreeID],
      transactionID
    );
    sourceTreeRemainingStems = Math.max(0, Number(remaining[0]?.cnt ?? 0) - 1);
  }

  return {
    existingTreeID,
    wouldCreate,
    sourceTreeID: input.currentTreeID,
    sourceTreeRemainingStems,
    ...(hasInactiveMatch ? { conflictReason: CONFLICT_REASON_INACTIVE_TREE } : {}),
    ...(otherSpeciesTree
      ? {
          conflictReason: CONFLICT_REASON_SPECIES_CONFLICT,
          conflictingTreeID: otherSpeciesTree.treeID,
          conflictingSpeciesCode: otherSpeciesTree.speciesCode
        }
      : {})
  };
}

async function findActiveTreeWithOtherSpecies(
  connectionManager: ConnectionManager,
  schema: string,
  input: PlanTreeInput,
  transactionID?: string
): Promise<{ treeID: number; speciesCode: string } | null> {
  const rows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT t.TreeID, sp.SpeciesCode
       FROM ??.trees t
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
       WHERE t.TreeTag = ? AND t.CensusID = ? AND t.SpeciesID <> ? AND t.IsActive = 1
       ORDER BY t.TreeID
       LIMIT 1`
    ),
    [input.TreeTag, input.CensusID, input.SpeciesID],
    transactionID
  );
  if (rows.length === 0) return null;
  return { treeID: Number(rows[0].TreeID), speciesCode: String(rows[0].SpeciesCode ?? '') };
}

export async function planStemResolution(
  connectionManager: ConnectionManager,
  schema: string,
  input: PlanStemInput,
  transactionID?: string
): Promise<PlanStemResult> {
  const exactActiveRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT StemGUID
       FROM ??.stems
       WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? AND QuadratID <=> ? AND IsActive = 1
       LIMIT 1`
    ),
    [input.TreeID, input.CensusID, input.StemTag, input.QuadratID],
    transactionID
  );

  if (exactActiveRows.length) {
    const existingStemGUID = Number(exactActiveRows[0].StemGUID);
    return {
      existingStemGUID,
      wouldCreate: false,
      sourceStemGUID: input.currentStemGUID,
      sourceStemRemainingMeasurements: await countSourceStemRemaining(connectionManager, schema, input.currentStemGUID, existingStemGUID, transactionID)
    };
  }

  const blockingRows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT StemGUID, QuadratID, IsActive
       FROM ??.stems
       WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ?
       ORDER BY StemGUID
       LIMIT 1`
    ),
    [input.TreeID, input.CensusID, input.StemTag],
    transactionID
  );

  if (blockingRows.length) {
    const blocking = blockingRows[0];
    if (!blocking.IsActive) {
      return {
        existingStemGUID: null,
        wouldCreate: false,
        sourceStemGUID: input.currentStemGUID,
        sourceStemRemainingMeasurements: 0,
        conflictReason: CONFLICT_REASON_INACTIVE_STEM
      };
    }
    if (Number(blocking.QuadratID) !== input.QuadratID) {
      return {
        existingStemGUID: null,
        wouldCreate: false,
        sourceStemGUID: input.currentStemGUID,
        sourceStemRemainingMeasurements: 0,
        conflictReason: CONFLICT_REASON_DIFFERENT_QUADRAT
      };
    }
    const existingStemGUID = Number(blocking.StemGUID);
    return {
      existingStemGUID,
      wouldCreate: false,
      sourceStemGUID: input.currentStemGUID,
      sourceStemRemainingMeasurements: await countSourceStemRemaining(connectionManager, schema, input.currentStemGUID, existingStemGUID, transactionID)
    };
  }

  return {
    existingStemGUID: null,
    wouldCreate: true,
    sourceStemGUID: input.currentStemGUID,
    sourceStemRemainingMeasurements: await countSourceStemRemaining(connectionManager, schema, input.currentStemGUID, null, transactionID)
  };
}

export async function planQuadratResolution(
  connectionManager: ConnectionManager,
  schema: string,
  { QuadratName, PlotID }: PlanQuadratInput,
  transactionID?: string
): Promise<PlanQuadratResult> {
  const rows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT QuadratID
       FROM ??.quadrats
       WHERE LOWER(QuadratName) = LOWER(?) AND PlotID = ? AND IsActive = 1
       ORDER BY QuadratID
       LIMIT 1`
    ),
    [QuadratName.trim(), PlotID],
    transactionID
  );
  return { quadratID: rows.length ? Number(rows[0].QuadratID) : null };
}

async function countSourceStemRemaining(
  connectionManager: ConnectionManager,
  schema: string,
  sourceStemGUID: number | null,
  destinationStemGUID: number | null,
  transactionID?: string
): Promise<number> {
  if (sourceStemGUID === null || sourceStemGUID === destinationStemGUID) return 0;
  const rows = await connectionManager.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT COUNT(*) AS cnt
       FROM ??.coremeasurements
       WHERE StemGUID = ?`
    ),
    [sourceStemGUID],
    transactionID
  );
  return Math.max(0, Number(rows[0]?.cnt ?? 0) - 1);
}
