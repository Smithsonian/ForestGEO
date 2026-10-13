// Shared read-only tree species correction planner (#427).
//
// A species edit on a linked `measurementssummary` row is not "re-link this
// one measurement to a different species" — it is "the researcher recorded
// the wrong species for this entire tree; correct the tree's SpeciesID in
// this census". This module inspects the database to describe exactly what
// that correction would touch (every attached stem and measurement on the
// tree, active or inactive) without writing anything. `rules/species.ts`
// calls it during preview/analysis; `tree-species-correction-writer.ts`
// calls it again (with `forUpdate: true`) immediately before mutating,
// under the caller's transaction and named scope lock.
//
// This module never begins a transaction, never acquires the measurement
// scope lock, and never mutates a row. Locking mode only changes which SELECT
// statements carry `FOR UPDATE` — acquiring the actual named lock and owning
// the transaction boundary remain the caller's responsibility.
//
// Membership is enumerated by TreeID (stems) and by StemGUID (measurements)
// with no CensusID scope filter on either query: nothing in the schema
// enforces that stems.CensusID / coremeasurements.CensusID agree with the
// owning tree's CensusID, so filtering on it would silently hide a
// genuinely mis-scoped attachment instead of surfacing it. Every attached
// row's own CensusID/quadrat link is read back and validated explicitly —
// a mismatch is reported as `scope_inconsistent`, never filtered out.
import ConnectionManager from '@/lib/db/connectionmanager';
import { buildInPlaceholders, safeFormatQuery } from '@/lib/db/sqlsecurity';
import {
  SPECIES_CORRECTION_SUMMARY_VERSION,
  SpeciesCorrectionMeasurementPrecondition,
  SpeciesCorrectionStemPrecondition,
  SpeciesCorrectionSummary
} from './types';

export interface PlanSpeciesCorrectionInput {
  /** The TreeID currently linked to the edited measurement (ctx.oldRow.TreeID). */
  treeID: number;
  plotID: number;
  censusID: number;
  /** Already resolved via resolveSpeciesByCode — this module re-reads it by ID to get the canonical code and current active status. */
  newSpeciesID: number;
  /** ctx.oldRow.StemGUID — the stem actually being edited; must be an active member of treeID's membership. */
  editedStemGUID: number;
  /** ctx.oldRow.CoreMeasurementID — the measurement actually being edited; must be an active member of treeID's membership. */
  editedCoreMeasurementID: number;
}

export interface PlanSpeciesCorrectionOptions {
  /**
   * When true, every row this planner reads (the source tree, the
   * destination species, the candidate destination tree, every attached
   * stem, every attached measurement) is locked with `SELECT ... FOR
   * UPDATE`, read in a fixed deterministic order (TreeID, then StemGUID
   * ascending, then CoreMeasurementID ascending). A writer that already
   * took snapshot reads earlier in the transaction must re-read current
   * state this way before mutating — a plain re-read would still observe
   * the transaction's original REPEATABLE READ snapshot and could race a
   * concurrent uniqueness change undetected.
   *
   * Preview/analyze callers must leave this false (the default): analysis
   * runs outside any transaction that is about to write, and taking row
   * locks there would hold them for the lifetime of an unrelated read.
   *
   * Locks are only meaningful inside an open transaction — `forUpdate: true`
   * without a `transactionID` is rejected before any query is issued.
   */
  forUpdate?: boolean;
}

export type SpeciesCorrectionPlanResult =
  | { status: 'ok'; correction: SpeciesCorrectionSummary }
  /** The resolved destination SpeciesID is the tree's own current SpeciesID (e.g. re-checked under a lock after the initial snapshot). Nothing to correct — never treated as a destination collision against the source itself. */
  | { status: 'no_correction'; message: string }
  | { status: 'source_missing'; message: string }
  | { status: 'source_inactive'; message: string; treeID: number }
  /** newSpeciesID no longer names any species row (hard-deleted between the caller's resolve and this read). */
  | { status: 'destination_species_missing'; message: string }
  /** newSpeciesID exists but has been deactivated since the caller resolved it. */
  | { status: 'destination_species_inactive'; message: string; speciesID: number }
  | { status: 'destination_exists'; message: string; destinationTreeID: number; destinationIsActive: boolean }
  /** An attached stem/measurement's own CensusID/quadrat link does not agree with the tree being corrected. A data integrity problem — reported, never filtered out of membership. */
  | { status: 'scope_inconsistent'; message: string; treeID: number }
  /** TreeTag, SpeciesID, or the tree's own current species code is NULL/blank. These columns are genuinely nullable; inventing "null"/0/'' would fabricate a non-restorable correction contract, so this is held as a structured outcome instead. */
  | { status: 'source_identity_invalid'; message: string; treeID: number }
  /** The destination species' own SpeciesCode is NULL/blank. Correcting *to* an identity with no restorable canonical spelling is refused rather than fabricated. */
  | { status: 'destination_species_code_missing'; message: string; speciesID: number }
  | { status: 'edited_stem_missing'; message: string }
  | { status: 'edited_stem_inactive'; message: string; stemGUID: number }
  | { status: 'edited_measurement_missing'; message: string }
  | { status: 'edited_measurement_inactive'; message: string; coreMeasurementID: number }
  /** The edited CoreMeasurementID exists on this tree, but is attached to a different stem than input.editedStemGUID (the previewed/checked active stem) — its link moved since the plan was read. A structured integrity conflict, not a normal missing/inactive outcome. */
  | { status: 'edited_measurement_moved'; message: string; coreMeasurementID: number; expectedStemGUID: number; actualStemGUID: number };

/**
 * Thrown when `forUpdate: true` is requested without a `transactionID`.
 * `SELECT ... FOR UPDATE` outside an open transaction is auto-committed and
 * releases its lock immediately — it cannot do what a writer needs it for
 * (retaining the lock across the replan). This is a caller contract
 * violation, not a data outcome, so it is thrown before any query runs.
 */
export class SpeciesCorrectionLockingRequiresTransactionError extends Error {
  constructor() {
    super(
      'planSpeciesCorrection: forUpdate requires an active transactionID — a lock outside a transaction is released immediately and cannot be retained across a replan.'
    );
    this.name = 'SpeciesCorrectionLockingRequiresTransactionError';
  }
}

interface SourceTreeRow {
  TreeID: number;
  // TreeTag, SpeciesID, and the LEFT JOIN's SpeciesCode are all genuinely
  // nullable columns (frontend/db/sql/tablestructures.sql:524,724-726).
  // Typed honestly here so a blank/NULL value must pass through an explicit
  // check below rather than being silently coerced (String(null) === 'null',
  // Number(null) === 0).
  TreeTag: string | null;
  SpeciesID: number | null;
  CensusID: number;
  TreeIsActive: number;
  PlotID: number;
  OldSpeciesCode: string | null;
}

interface DestinationSpeciesRow {
  SpeciesCode: string | null;
  IsActive: number;
}

interface DestinationTreeRow {
  TreeID: number;
  IsActive: number;
}

interface StemMembershipRow {
  StemGUID: number;
  StemCensusID: number;
  QuadratID: number | null;
  QuadratPlotID: number | null;
  StemIsActive: number;
}

interface MeasurementMembershipRow {
  CoreMeasurementID: number;
  StemGUID: number;
  MeasurementCensusID: number;
  CoreIsActive: number;
  RawSpCode: string | null;
}

export async function planSpeciesCorrection(
  cm: ConnectionManager,
  schema: string,
  input: PlanSpeciesCorrectionInput,
  transactionID?: string,
  options: PlanSpeciesCorrectionOptions = {}
): Promise<SpeciesCorrectionPlanResult> {
  if (options.forUpdate && !transactionID) {
    throw new SpeciesCorrectionLockingRequiresTransactionError();
  }
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';

  // --- Source tree -----------------------------------------------------
  const treeRows = (await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT t.TreeID, t.TreeTag, t.SpeciesID, t.CensusID, t.IsActive AS TreeIsActive, c.PlotID, sp.SpeciesCode AS OldSpeciesCode
       FROM ??.trees t
       JOIN ??.census c ON c.CensusID = t.CensusID
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
       WHERE t.TreeID = ? AND t.CensusID = ?
       LIMIT 1${lockClause}`
    ),
    [input.treeID, input.censusID],
    transactionID
  )) as SourceTreeRow[];

  if (treeRows.length === 0) {
    return { status: 'source_missing', message: `Tree ${input.treeID} not found in census ${input.censusID}` };
  }

  const source = treeRows[0];
  if (Number(source.PlotID) !== input.plotID) {
    // The tree's census does not belong to the requested plot. Treat
    // identically to "not found" rather than confirming which plot actually
    // owns it to a caller scoped to a different one.
    return { status: 'source_missing', message: `Tree ${input.treeID} not found in plot ${input.plotID}, census ${input.censusID}` };
  }
  if (!source.TreeIsActive) {
    return {
      status: 'source_inactive',
      message: `Tree ${input.treeID} (TreeTag "${source.TreeTag}") is inactive`,
      treeID: Number(source.TreeID)
    };
  }

  // --- Honest nullable identity handling -------------------------------
  // TreeTag, SpeciesID, and the tree's own current species code are read
  // back and validated before anything derives a correction contract from
  // them. A blank/NULL value here is a pre-existing data integrity problem
  // on the source tree, not something this planner may paper over by
  // inventing "null"/0/'' — that would bypass the destination collision
  // check below and produce a correction/undo contract that can never be
  // honestly restored.
  const treeTagRaw = source.TreeTag;
  if (treeTagRaw === null || String(treeTagRaw).trim() === '') {
    return {
      status: 'source_identity_invalid',
      message: `Tree ${input.treeID} has a missing/blank TreeTag; refusing to correct species for a tree whose identity cannot be restored`,
      treeID: Number(source.TreeID)
    };
  }
  const treeTag = treeTagRaw;

  const sourceSpeciesIDRaw = source.SpeciesID;
  if (sourceSpeciesIDRaw === null || !Number.isFinite(Number(sourceSpeciesIDRaw))) {
    return {
      status: 'source_identity_invalid',
      message: `Tree ${input.treeID} (TreeTag "${treeTag}") has a missing/invalid SpeciesID; refusing to correct species for a tree whose current species cannot be established`,
      treeID: Number(source.TreeID)
    };
  }
  const oldSpeciesID = Number(sourceSpeciesIDRaw);

  const oldSpeciesCodeRaw = source.OldSpeciesCode;
  if (oldSpeciesCodeRaw === null || String(oldSpeciesCodeRaw).trim() === '') {
    return {
      status: 'source_identity_invalid',
      message: `Tree ${input.treeID} (TreeTag "${treeTag}") has a missing/blank current species code; refusing to correct species for a tree whose prior identity cannot be restored`,
      treeID: Number(source.TreeID)
    };
  }
  const oldSpeciesCode = oldSpeciesCodeRaw;

  // --- Destination species (canonical code + current active status) ---
  // Same resolved SpeciesID as the tree's own current species: nothing to
  // correct. Checked by ID alone, before any further query, so this case
  // can never fall into the destination-tree collision check below (which
  // would otherwise find the source tree itself and misreport it as another
  // tree already owning the destination).
  if (input.newSpeciesID === oldSpeciesID) {
    return { status: 'no_correction', message: `Tree ${input.treeID} already has species ${input.newSpeciesID}; nothing to correct` };
  }

  const destinationSpeciesRows = (await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT SpeciesCode, IsActive
       FROM ??.species
       WHERE SpeciesID = ?
       LIMIT 1${lockClause}`
    ),
    [input.newSpeciesID],
    transactionID
  )) as DestinationSpeciesRow[];

  if (destinationSpeciesRows.length === 0) {
    return { status: 'destination_species_missing', message: `Destination species ${input.newSpeciesID} no longer exists` };
  }
  const destinationSpecies = destinationSpeciesRows[0];
  if (!destinationSpecies.IsActive) {
    return {
      status: 'destination_species_inactive',
      message: `Destination species ${input.newSpeciesID} (code "${destinationSpecies.SpeciesCode}") is inactive`,
      speciesID: input.newSpeciesID
    };
  }
  // The destination species' own SpeciesCode is likewise nullable — refuse
  // to correct *to* an identity with no restorable canonical spelling
  // rather than fabricating one with String(null) === 'null'.
  const newSpeciesCodeRaw = destinationSpecies.SpeciesCode;
  if (newSpeciesCodeRaw === null || String(newSpeciesCodeRaw).trim() === '') {
    return {
      status: 'destination_species_code_missing',
      message: `Destination species ${input.newSpeciesID} has a missing/blank canonical species code; refusing to correct species to an identity that cannot be restored`,
      speciesID: input.newSpeciesID
    };
  }
  const newSpeciesCode = newSpeciesCodeRaw;

  // --- Destination tree collision ---------------------------------------
  const destinationRows = (await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT TreeID, IsActive
       FROM ??.trees
       WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?
       ORDER BY TreeID
       LIMIT 1${lockClause}`
    ),
    [treeTag, input.newSpeciesID, input.censusID],
    transactionID
  )) as DestinationTreeRow[];

  if (destinationRows.length > 0) {
    const destination = destinationRows[0];
    return {
      status: 'destination_exists',
      message: `A tree with TreeTag "${treeTag}" already exists under the target species in census ${input.censusID} (TreeID ${destination.TreeID}); refusing to merge`,
      destinationTreeID: Number(destination.TreeID),
      destinationIsActive: Boolean(destination.IsActive)
    };
  }

  // --- Stem membership: every stem attached to this TreeID, no CensusID
  // scope filter — a mismatch is validated explicitly below, not filtered. --
  const stemRows = (await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT s.StemGUID, s.CensusID AS StemCensusID, s.QuadratID, q.PlotID AS QuadratPlotID, s.IsActive AS StemIsActive
       FROM ??.stems s
       LEFT JOIN ??.quadrats q ON q.QuadratID = s.QuadratID
       WHERE s.TreeID = ?
       ORDER BY s.StemGUID${lockClause}`
    ),
    [input.treeID],
    transactionID
  )) as StemMembershipRow[];

  for (const stem of stemRows) {
    if (Number(stem.StemCensusID) !== Number(source.CensusID)) {
      return {
        status: 'scope_inconsistent',
        treeID: input.treeID,
        message: `Stem ${stem.StemGUID} attached to tree ${input.treeID} belongs to a different census than the tree; refusing to correct species while membership is inconsistent`
      };
    }
    if (stem.QuadratID === null || stem.QuadratPlotID === null) {
      return {
        status: 'scope_inconsistent',
        treeID: input.treeID,
        message: `Stem ${stem.StemGUID} attached to tree ${input.treeID} has no quadrat link; refusing to correct species while membership is inconsistent`
      };
    }
    if (Number(stem.QuadratPlotID) !== input.plotID) {
      return {
        status: 'scope_inconsistent',
        treeID: input.treeID,
        message: `Stem ${stem.StemGUID} attached to tree ${input.treeID} belongs to a quadrat outside the requested plot; refusing to correct species while membership is inconsistent`
      };
    }
  }

  const stems: SpeciesCorrectionStemPrecondition[] = stemRows
    .map(row => ({
      stemGUID: Number(row.StemGUID),
      censusID: Number(row.StemCensusID),
      quadratID: Number(row.QuadratID),
      isActive: Boolean(row.StemIsActive)
    }))
    .sort((a, b) => a.stemGUID - b.stemGUID);

  const editedStem = stems.find(stem => stem.stemGUID === input.editedStemGUID);
  if (!editedStem) {
    return {
      status: 'edited_stem_missing',
      message: `Edited stem ${input.editedStemGUID} is not attached to tree ${input.treeID}; refusing to correct species for a stem outside the tree being corrected`
    };
  }
  if (!editedStem.isActive) {
    return {
      status: 'edited_stem_inactive',
      message: `Edited stem ${input.editedStemGUID} on tree ${input.treeID} is inactive; species cannot be corrected through an inactive stem`,
      stemGUID: input.editedStemGUID
    };
  }

  const activeStemCount = stems.filter(stem => stem.isActive).length;
  const inactiveStemCount = stems.length - activeStemCount;

  // --- Measurement membership: every measurement on those stems, no
  // CensusID scope filter — validated explicitly below, not filtered. The
  // edited-stem check above guarantees stems.length >= 1, so this IN clause
  // is never empty. --------------------------------------------------------
  const stemGUIDs = stems.map(stem => stem.stemGUID);
  const placeholders = buildInPlaceholders(stemGUIDs.length);
  const measurementRows = (await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT CoreMeasurementID, StemGUID, CensusID AS MeasurementCensusID, IsActive AS CoreIsActive, RawSpCode
       FROM ??.coremeasurements
       WHERE StemGUID IN (${placeholders})
       ORDER BY CoreMeasurementID${lockClause}`
    ),
    [...stemGUIDs],
    transactionID
  )) as MeasurementMembershipRow[];

  for (const measurement of measurementRows) {
    if (Number(measurement.MeasurementCensusID) !== Number(source.CensusID)) {
      return {
        status: 'scope_inconsistent',
        treeID: input.treeID,
        message: `Measurement ${measurement.CoreMeasurementID} on stem ${measurement.StemGUID} belongs to a different census than tree ${input.treeID}; refusing to correct species while membership is inconsistent`
      };
    }
  }

  const measurements: SpeciesCorrectionMeasurementPrecondition[] = measurementRows
    .map(row => ({
      coreMeasurementID: Number(row.CoreMeasurementID),
      stemGUID: Number(row.StemGUID),
      censusID: Number(row.MeasurementCensusID),
      isActive: Boolean(row.CoreIsActive),
      priorRawSpCode: row.RawSpCode === null || row.RawSpCode === undefined ? null : String(row.RawSpCode)
    }))
    .sort((a, b) => a.coreMeasurementID - b.coreMeasurementID);

  const editedMeasurement = measurements.find(measurement => measurement.coreMeasurementID === input.editedCoreMeasurementID);
  if (!editedMeasurement) {
    return {
      status: 'edited_measurement_missing',
      message: `Edited measurement ${input.editedCoreMeasurementID} is not attached to tree ${input.treeID}; refusing to correct species for a measurement outside the tree being corrected`
    };
  }
  // The CM exists somewhere on this tree, but must be attached to the exact
  // previewed/checked active stem (input.editedStemGUID) — not merely some
  // stem belonging to the tree. Without this, a CM that moved to a sibling
  // stem (active or inactive) between preview and this read would silently
  // succeed against a link that no longer reflects what was reviewed.
  if (editedMeasurement.stemGUID !== input.editedStemGUID) {
    return {
      status: 'edited_measurement_moved',
      message: `Edited measurement ${input.editedCoreMeasurementID} is attached to stem ${editedMeasurement.stemGUID}, not the previewed stem ${input.editedStemGUID}; refusing to correct species against a measurement whose attachment moved since the plan was read`,
      coreMeasurementID: input.editedCoreMeasurementID,
      expectedStemGUID: input.editedStemGUID,
      actualStemGUID: editedMeasurement.stemGUID
    };
  }
  if (!editedMeasurement.isActive) {
    return {
      status: 'edited_measurement_inactive',
      message: `Edited measurement ${input.editedCoreMeasurementID} on tree ${input.treeID} is inactive; species cannot be corrected for an inactive measurement`,
      coreMeasurementID: input.editedCoreMeasurementID
    };
  }

  const activeMeasurementCount = measurements.filter(measurement => measurement.isActive).length;
  const inactiveMeasurementCount = measurements.length - activeMeasurementCount;

  const correction: SpeciesCorrectionSummary = {
    version: SPECIES_CORRECTION_SUMMARY_VERSION,
    targetTreeID: Number(source.TreeID),
    treeTag,
    plotID: input.plotID,
    censusID: input.censusID,
    oldSpeciesID,
    oldSpeciesCode,
    newSpeciesID: input.newSpeciesID,
    newSpeciesCode,
    activeStemCount,
    inactiveStemCount,
    activeMeasurementCount,
    inactiveMeasurementCount,
    stems,
    measurements
  };

  return { status: 'ok', correction };
}
