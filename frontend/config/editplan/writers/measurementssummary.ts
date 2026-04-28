// measurementssummary writer — applies a single-row edit that the analyzer
// has already validated.
//
// Ported from `frontend/config/macros/coreapifunctions.ts::PATCH` (the
// `dataType === 'measurementssummary'` branch). The legacy PATCH handler is
// still in place for other dataTypes but will be removed by Task 18.
//
// The writer runs INSIDE an outer transaction (owned by `applyEditInTransaction`
// or a batch caller such as revision apply). It MUST NOT begin, commit, or
// rollback transactions, and it MUST NOT close the connection.
import ConnectionManager from '@/config/connectionmanager';
import { format } from 'mysql2/promise';
import { EditPlan } from '../types';
import type { ApplyInTransactionInput } from '../apply';
import type { EditOperationStateRow } from '@/config/editoperations';
import { computeTreeStemState, resolveMeasurementSummaryQuadratID, resolveMeasurementSummaryStem, resolveMeasurementSummaryTree } from './resolvers-mutating';
import { refreshIngestionErrorsForMeasurement } from '@/config/measurementerrors';
import { refreshMeasurementViewsForCoreMeasurements, refreshMeasurementViewsForScope } from '@/lib/measurementviewrefresh';
import { handleUpsert } from '@/config/utils';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';
import { CMAttributesResult } from '@/config/sqlrdsdefinitions/core';

export interface WriterResult {
  updatedIDs: Record<string, number>;
  beforeState: EditOperationStateRow[];
  afterState: EditOperationStateRow[];
  postValidation?: { newErrors: number; clearedErrors: number };
  validationPending: boolean;
}

const RAW_SYNC_TRIGGER_FIELDS: ReadonlySet<string> = new Set([
  'SpeciesCode',
  'TreeTag',
  'StemTag',
  'QuadratName',
  'StemLocalX',
  'StemLocalY',
  'MeasuredDBH',
  'MeasuredHOM',
  'MeasurementDate',
  'Description',
  'Attributes'
]);

const STEM_NEIGHBOR_REFRESH_FIELDS: ReadonlySet<string> = new Set(['SpeciesCode', 'TreeTag', 'StemTag', 'QuadratName', 'StemLocalX', 'StemLocalY']);

export type MeasurementViewRefreshTargetDecision =
  | { mode: 'targeted'; coreMeasurementIDs: number[] }
  | { mode: 'scope'; reason: 'invalid-target-id' | 'invalid-scope' | 'unsupported-field' };

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = toPositiveNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function changedFieldsIncludeAny(changedFields: ReadonlySet<string>, fields: ReadonlySet<string>): boolean {
  for (const field of changedFields) {
    if (fields.has(field)) return true;
  }
  return false;
}

function addPositiveInteger(values: Set<number>, value: unknown): void {
  const parsed = toPositiveInteger(value);
  if (parsed !== null) values.add(parsed);
}

export async function resolveMeasurementViewRefreshTargets(
  cm: ConnectionManager,
  schema: string,
  input: {
    coreMeasurementID: number;
    plotID: number;
    censusID: number;
    changedFields: ReadonlySet<string>;
    beforeStemGUID: number | null;
    afterStemGUID: number | null;
    transactionID: string;
  }
): Promise<MeasurementViewRefreshTargetDecision> {
  const coreMeasurementID = toPositiveInteger(input.coreMeasurementID);
  if (coreMeasurementID === null) return { mode: 'scope', reason: 'invalid-target-id' };

  for (const field of input.changedFields) {
    if (!RAW_SYNC_TRIGGER_FIELDS.has(field)) return { mode: 'scope', reason: 'unsupported-field' };
  }

  const affectedIDs = new Set<number>([coreMeasurementID]);
  if (!changedFieldsIncludeAny(input.changedFields, STEM_NEIGHBOR_REFRESH_FIELDS)) {
    return { mode: 'targeted', coreMeasurementIDs: Array.from(affectedIDs) };
  }

  const plotID = toPositiveInteger(input.plotID);
  const censusID = toPositiveInteger(input.censusID);
  if (plotID === null || censusID === null) return { mode: 'scope', reason: 'invalid-scope' };

  const stemGUIDs = new Set<number>();
  addPositiveInteger(stemGUIDs, input.beforeStemGUID);
  addPositiveInteger(stemGUIDs, input.afterStemGUID);
  if (stemGUIDs.size === 0) return { mode: 'targeted', coreMeasurementIDs: Array.from(affectedIDs) };

  const stemGUIDList = Array.from(stemGUIDs).sort((a, b) => a - b);
  const placeholders = stemGUIDList.map(() => '?').join(', ');
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT cm.CoreMeasurementID
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       WHERE cm.StemGUID IN (${placeholders})
         AND c.PlotID = ?
         AND cm.CensusID = ?
       ORDER BY cm.CoreMeasurementID`
    ),
    [...stemGUIDList, plotID, censusID],
    input.transactionID
  );
  for (const row of rows as Array<{ CoreMeasurementID?: unknown }>) {
    addPositiveInteger(affectedIDs, row.CoreMeasurementID);
  }

  return { mode: 'targeted', coreMeasurementIDs: Array.from(affectedIDs).sort((a, b) => a - b) };
}

function normalizeMeasurementSummaryDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  if (typeof value === 'string') {
    if (!value.includes('T')) return value;
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  return null;
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface LoadedCoreMeasurementRow {
  CoreMeasurementID: number;
  CensusID: number | null;
  PlotID: number | null;
  StemGUID: number | null;
  MeasurementDate: string | Date | null;
  MeasuredDBH: number | string | null;
  MeasuredHOM: number | string | null;
  Description: string | null;
  Attributes: string | null;
  TreeTag: string | null;
  TreeID: number | null;
  SpeciesCode: string | null;
  SpeciesID: number | null;
  StemTag: string | null;
  StemLocalX: number | string | null;
  StemLocalY: number | string | null;
  QuadratName: string | null;
  QuadratID?: number | null;
}

async function loadCurrentJoinedRow(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string
): Promise<LoadedCoreMeasurementRow> {
  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT
       cm.CoreMeasurementID,
       cm.CensusID,
       c.PlotID,
       cm.StemGUID,
       cm.MeasurementDate,
       cm.MeasuredDBH,
       cm.MeasuredHOM,
       cm.Description,
       cm.RawCodes AS Attributes,
       t.TreeTag,
       t.TreeID,
       sp.SpeciesCode,
       sp.SpeciesID,
       s.StemTag,
       s.LocalX AS StemLocalX,
       s.LocalY AS StemLocalY,
       q.QuadratName
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     LEFT JOIN ??.stems s ON s.StemGUID = cm.StemGUID
     LEFT JOIN ??.trees t ON t.TreeID = s.TreeID
     LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
     LEFT JOIN ??.quadrats q ON q.QuadratID = s.QuadratID
     WHERE cm.CoreMeasurementID = ?
     LIMIT 1`
    ),
    [coreMeasurementID],
    transactionID
  );
  if (!rows.length) throw new Error(`measurementssummary writer: coremeasurements row ${coreMeasurementID} not found`);
  return rows[0] as LoadedCoreMeasurementRow;
}

async function loadCoreMeasurementRow(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string
): Promise<Record<string, unknown> | null> {
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.coremeasurements WHERE CoreMeasurementID = ? LIMIT 1`),
    [coreMeasurementID],
    transactionID
  );
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

async function loadStemRow(cm: ConnectionManager, schema: string, stemGUID: number | null, transactionID: string): Promise<Record<string, unknown> | null> {
  if (stemGUID === null) return null;
  const rows = await cm.executeQuery(safeFormatQuery(schema, `SELECT * FROM ??.stems WHERE StemGUID = ? LIMIT 1`), [stemGUID], transactionID);
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

async function loadTreeRow(cm: ConnectionManager, schema: string, treeID: number | null, transactionID: string): Promise<Record<string, unknown> | null> {
  if (treeID === null) return null;
  const rows = await cm.executeQuery(safeFormatQuery(schema, `SELECT * FROM ??.trees WHERE TreeID = ? LIMIT 1`), [treeID], transactionID);
  return rows.length ? (rows[0] as Record<string, unknown>) : null;
}

async function loadCmAttributeRows(
  cm: ConnectionManager,
  schema: string,
  coreMeasurementID: number,
  transactionID: string
): Promise<Array<Record<string, unknown>>> {
  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.cmattributes WHERE CoreMeasurementID = ? ORDER BY CMAID`),
    [coreMeasurementID],
    transactionID
  );
  return rows as Array<Record<string, unknown>>;
}

function buildStateRow(table: string, primaryKey: string, primaryKeyValue: string | number, row: Record<string, unknown> | null): EditOperationStateRow {
  return { table, primaryKey, primaryKeyValue, row };
}

function hasStateRow(state: EditOperationStateRow[], table: string, primaryKeyValue: string | number): boolean {
  return state.some(row => row.table === table && String(row.primaryKeyValue) === String(primaryKeyValue));
}

async function findExistingTreeID(
  cm: ConnectionManager,
  schema: string,
  treeTag: unknown,
  speciesID: unknown,
  censusID: unknown,
  transactionID: string
): Promise<number | null> {
  const normalizedSpeciesID = toPositiveNumber(speciesID);
  const normalizedCensusID = toPositiveNumber(censusID);
  if (!treeTag || normalizedSpeciesID === null || normalizedCensusID === null) return null;

  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT TreeID
     FROM ??.trees
     WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ?
     ORDER BY TreeID
     LIMIT 1`
    ),
    [treeTag, normalizedSpeciesID, normalizedCensusID],
    transactionID
  );
  return rows.length ? toPositiveNumber(rows[0].TreeID) : null;
}

async function findExactActiveStemGUID(
  cm: ConnectionManager,
  schema: string,
  treeID: unknown,
  censusID: unknown,
  stemTag: unknown,
  quadratID: unknown,
  transactionID: string
): Promise<number | null> {
  const normalizedTreeID = toPositiveNumber(treeID);
  const normalizedCensusID = toPositiveNumber(censusID);
  const normalizedQuadratID = toPositiveNumber(quadratID);
  if (normalizedTreeID === null || normalizedCensusID === null || !stemTag || normalizedQuadratID === null) return null;

  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT StemGUID
     FROM ??.stems
     WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? AND QuadratID <=> ? AND IsActive = 1
     LIMIT 1`
    ),
    [normalizedTreeID, normalizedCensusID, stemTag, normalizedQuadratID],
    transactionID
  );
  return rows.length ? toPositiveNumber(rows[0].StemGUID) : null;
}

export async function writeMeasurementsSummary(cm: ConnectionManager, input: ApplyInTransactionInput, plan: EditPlan, txID: string): Promise<WriterResult> {
  const { schema, plotID, censusID, targetID } = input;
  const coreMeasurementID = Number(targetID);

  const changedFields = new Set<string>(plan.fieldChanges.map(fc => fc.field));
  const newValues: Record<string, unknown> = {};
  for (const { field, to } of plan.fieldChanges) {
    newValues[field] = to;
  }

  // Capture before-state rows for exact-revert support.
  const beforeCoreRow = await loadCoreMeasurementRow(cm, schema, coreMeasurementID, txID);
  if (!beforeCoreRow) throw new Error(`measurementssummary writer: coremeasurements ${coreMeasurementID} not found at write time`);
  const beforeStemGUID = beforeCoreRow.StemGUID as number | null;
  const beforeStemRow = await loadStemRow(cm, schema, beforeStemGUID, txID);
  const beforeTreeID = beforeStemRow ? toPositiveNumber(beforeStemRow.TreeID) : null;
  const beforeTreeRow = await loadTreeRow(cm, schema, beforeTreeID, txID);
  const beforeCmAttrRows = await loadCmAttributeRows(cm, schema, coreMeasurementID, txID);

  const beforeState: EditOperationStateRow[] = [];
  beforeState.push(buildStateRow('coremeasurements', 'CoreMeasurementID', coreMeasurementID, beforeCoreRow));
  if (beforeStemRow && beforeStemGUID !== null) {
    beforeState.push(buildStateRow('stems', 'StemGUID', beforeStemGUID, beforeStemRow));
  }
  if (beforeTreeRow && beforeTreeID !== null) {
    beforeState.push(buildStateRow('trees', 'TreeID', beforeTreeID, beforeTreeRow));
  }
  if (changedFields.has('Attributes')) {
    for (const attrRow of beforeCmAttrRows) {
      beforeState.push(buildStateRow('cmattributes', 'CMAID', Number(attrRow.CMAID), attrRow));
    }
  }

  // Start from a freshly-joined current snapshot and overlay the plan's new
  // values so downstream resolvers see the merged shape (the old PATCH code
  // worked on a mapped new-row, we synthesize it here from the DB + plan).
  // `current` is reassigned after stem resolution so unchanged fields reflect
  // the new stem rather than the previous one.
  let current = await loadCurrentJoinedRow(cm, schema, coreMeasurementID, txID);
  const merged: LoadedCoreMeasurementRow = { ...current };
  for (const field of Object.keys(newValues)) {
    (merged as unknown as Record<string, unknown>)[field] = newValues[field];
  }

  const normalizedMeasurementDate = normalizeMeasurementSummaryDate(merged.MeasurementDate ?? current.MeasurementDate ?? null);

  const previousTreeID = toPositiveNumber(current.TreeID);
  const shouldResolveTree = changedFields.has('SpeciesCode') || changedFields.has('TreeTag');
  const needsFullStemResolution = changedFields.has('TreeTag') || changedFields.has('QuadratName') || changedFields.has('StemTag');

  let changesFound = false;

  // --- SpeciesCode change -> SpeciesID lookup (safety net; analyzer already
  // ensured the code is known). No mutation of species row — removing the
  // R1b SpeciesName side-effect that lived in the legacy PATCH handler.
  if (changedFields.has('SpeciesCode')) {
    changesFound = true;
    const speciesSearchResults = await cm.executeQuery(
      safeFormatQuery(
        schema,
        `SELECT SpeciesID
       FROM ??.species
       WHERE LOWER(SpeciesCode) = LOWER(?)
         AND IsActive = 1
       ORDER BY SpeciesID
       LIMIT 1`
      ),
      [merged.SpeciesCode],
      txID
    );
    if (speciesSearchResults.length === 0) {
      throw new Error('Species not found');
    }
    merged.SpeciesID = speciesSearchResults[0].SpeciesID;
  }

  if (changedFields.has('TreeTag')) {
    changesFound = true;
  }

  if (changedFields.has('QuadratName')) {
    changesFound = true;
    merged.QuadratID = await resolveMeasurementSummaryQuadratID(
      cm,
      schema,
      {
        QuadratID: null,
        QuadratName: merged.QuadratName,
        PlotID: merged.PlotID ?? plotID
      },
      txID
    );
  }

  if (shouldResolveTree) {
    const existingTreeID = await findExistingTreeID(
      cm,
      schema,
      merged.TreeTag ?? current.TreeTag,
      merged.SpeciesID ?? current.SpeciesID,
      merged.CensusID ?? current.CensusID,
      txID
    );
    merged.TreeID = await resolveMeasurementSummaryTree(
      cm,
      schema,
      {
        TreeTag: merged.TreeTag ?? current.TreeTag,
        SpeciesID: merged.SpeciesID ?? current.SpeciesID,
        CensusID: merged.CensusID ?? current.CensusID
      },
      txID
    );
    const resolvedTreeIDForState = toPositiveNumber(merged.TreeID);
    if (existingTreeID === null && resolvedTreeIDForState !== null && !hasStateRow(beforeState, 'trees', resolvedTreeIDForState)) {
      beforeState.push(buildStateRow('trees', 'TreeID', resolvedTreeIDForState, null));
    }
  }

  const resolvedTreeID = toPositiveNumber(merged.TreeID ?? current.TreeID);
  const needsStemResolution = needsFullStemResolution || (resolvedTreeID !== null && resolvedTreeID !== previousTreeID);

  if (needsStemResolution) {
    changesFound = true;
    const resolvedQuadratID = await resolveMeasurementSummaryQuadratID(
      cm,
      schema,
      {
        QuadratID: (merged as any).QuadratID ?? null,
        QuadratName: merged.QuadratName ?? current.QuadratName,
        PlotID: merged.PlotID ?? plotID
      },
      txID
    );
    (merged as any).QuadratID = resolvedQuadratID;

    const existingStemGUID = await findExactActiveStemGUID(
      cm,
      schema,
      merged.TreeID ?? current.TreeID,
      merged.CensusID ?? current.CensusID,
      merged.StemTag ?? current.StemTag,
      resolvedQuadratID,
      txID
    );

    const resolvedStemGUID = await resolveMeasurementSummaryStem(
      cm,
      schema,
      {
        TreeID: merged.TreeID ?? current.TreeID,
        TreeTag: merged.TreeTag ?? current.TreeTag,
        CensusID: merged.CensusID ?? current.CensusID,
        StemTag: merged.StemTag ?? current.StemTag,
        QuadratID: resolvedQuadratID,
        StemLocalX: changedFields.has('StemLocalX') ? toOptionalNumber(newValues.StemLocalX) : toOptionalNumber(merged.StemLocalX),
        StemLocalY: changedFields.has('StemLocalY') ? toOptionalNumber(newValues.StemLocalY) : toOptionalNumber(merged.StemLocalY)
      },
      txID
    );
    if (existingStemGUID === null && !hasStateRow(beforeState, 'stems', resolvedStemGUID)) {
      beforeState.push(buildStateRow('stems', 'StemGUID', resolvedStemGUID, null));
    }

    if (resolvedStemGUID !== merged.StemGUID) {
      await cm.executeQuery(
        format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.coremeasurements`, { StemGUID: resolvedStemGUID }, 'CoreMeasurementID', coreMeasurementID]),
        [],
        txID
      );
    }
    merged.StemGUID = resolvedStemGUID;

    // Recompute treestemstate — hard-failed rows never got this during
    // ingestion (they fail before Stage 4 classification), so corrected
    // rows would remain hidden in View Data without it.
    const resolvedTreeTag = String(merged.TreeTag ?? current.TreeTag ?? '');
    const resolvedStemTag = String(merged.StemTag ?? current.StemTag ?? '');
    const resolvedCensusID = toPositiveNumber(merged.CensusID ?? current.CensusID ?? censusID);
    const resolvedPlotID = toPositiveNumber(merged.PlotID ?? current.PlotID ?? plotID);

    if (resolvedTreeTag && resolvedStemTag && resolvedCensusID && resolvedPlotID) {
      const treeStemState = await computeTreeStemState(cm, schema, resolvedTreeTag, resolvedStemTag, resolvedCensusID, resolvedPlotID, txID);

      const existingUDFRows = await cm.executeQuery(
        safeFormatQuery(schema, `SELECT UserDefinedFields FROM ??.coremeasurements WHERE CoreMeasurementID = ?`),
        [coreMeasurementID],
        txID
      );
      const rawUDF = existingUDFRows?.[0]?.UserDefinedFields;
      const currentFields: Record<string, unknown> = rawUDF ? (typeof rawUDF === 'string' ? JSON.parse(rawUDF) : rawUDF) : {};
      currentFields.treestemstate = treeStemState;

      await cm.executeQuery(
        format(`UPDATE ?? SET ? WHERE ?? = ?`, [
          `${schema}.coremeasurements`,
          { UserDefinedFields: JSON.stringify(currentFields) },
          'CoreMeasurementID',
          coreMeasurementID
        ]),
        [],
        txID
      );
    }

    // Reload the joined snapshot so unchanged fields (StemLocalX/Y, QuadratName,
    // TreeTag, SpeciesCode, etc.) reflect the post-resolution stem rather than
    // the previous one. Overlay user-edited values back onto `merged` so the
    // downstream Raw* sync sees user input where the user changed something
    // and the new ground truth everywhere else.
    current = await loadCurrentJoinedRow(cm, schema, coreMeasurementID, txID);
    const mergedAsRecord = merged as unknown as Record<string, unknown>;
    const currentAsRecord = current as unknown as Record<string, unknown>;
    for (const field of Object.keys(currentAsRecord)) {
      if (!changedFields.has(field)) {
        mergedAsRecord[field] = currentAsRecord[field];
      }
    }
  }

  // --- StemLocalX / StemLocalY update: propagates to the shared stems row
  //     (affecting all measurements on that stem).
  if (changedFields.has('StemLocalX') || changedFields.has('StemLocalY')) {
    changesFound = true;
    const xValue = changedFields.has('StemLocalX') ? toOptionalNumber(newValues.StemLocalX) : toOptionalNumber(merged.StemLocalX);
    const yValue = changedFields.has('StemLocalY') ? toOptionalNumber(newValues.StemLocalY) : toOptionalNumber(merged.StemLocalY);
    if (merged.StemGUID !== null && merged.StemGUID !== undefined) {
      await cm.executeQuery(
        format(`UPDATE ?? SET ? WHERE ?? = ?`, [`${schema}.stems`, { LocalX: xValue, LocalY: yValue }, 'StemGUID', merged.StemGUID]),
        [],
        txID
      );
    }
  }

  // --- Numeric measurement fields on coremeasurements
  if (changedFields.has('MeasuredDBH') || changedFields.has('MeasuredHOM') || changedFields.has('MeasurementDate')) {
    changesFound = true;
    await cm.executeQuery(
      format(`UPDATE ?? SET ? WHERE ?? = ?`, [
        `${schema}.coremeasurements`,
        {
          MeasuredDBH: changedFields.has('MeasuredDBH') ? toOptionalNumber(newValues.MeasuredDBH) : toOptionalNumber(merged.MeasuredDBH),
          MeasuredHOM: changedFields.has('MeasuredHOM') ? toOptionalNumber(newValues.MeasuredHOM) : toOptionalNumber(merged.MeasuredHOM),
          MeasurementDate: normalizedMeasurementDate
        },
        'CoreMeasurementID',
        coreMeasurementID
      ]),
      [],
      txID
    );
  }

  // --- Attributes change — rebuild cmattributes rows (DELETE + re-INSERT)
  if (changedFields.has('Attributes')) {
    changesFound = true;
    const attrsValue = newValues.Attributes;
    const rawAttrsString = attrsValue === null || attrsValue === undefined ? '' : String(attrsValue);
    const parsedCodes = rawAttrsString
      .split(';')
      .map(code => code.trim())
      .filter(Boolean);
    await cm.executeQuery(safeFormatQuery(schema, `DELETE FROM ??.cmattributes WHERE CoreMeasurementID = ?`), [coreMeasurementID], txID);
    for (const code of parsedCodes) {
      await handleUpsert<CMAttributesResult>(
        cm,
        schema,
        'cmattributes',
        {
          CoreMeasurementID: coreMeasurementID,
          Code: code
        },
        'CMAID',
        txID
      );
    }
  }

  // --- Sync Raw* / measurement fields on coremeasurements whenever any
  //     user-visible editable field changed. Mirrors the legacy PATCH sync
  //     block so View Data and the failed-measurements explorer stay aligned.

  // For clearable fields we must distinguish "field was not changed — keep
  // current DB value" from "field was explicitly set to null — write NULL".
  // The ?? fallback used for identity fields (TreeTag etc.) conflates the two
  // cases, so clearable fields are routed through effective() instead.
  // Identity fields keep the ?? fallback because treestem rules reject identity
  // clears upstream — a null merged.TreeTag means the field was not changed.
  const effective = <K extends keyof LoadedCoreMeasurementRow>(field: K): LoadedCoreMeasurementRow[K] =>
    changedFields.has(field as string) ? (merged as LoadedCoreMeasurementRow)[field] : (current as LoadedCoreMeasurementRow)[field];

  const shouldSyncRaw = Array.from(changedFields).some(f => RAW_SYNC_TRIGGER_FIELDS.has(f));
  if (shouldSyncRaw) {
    changesFound = true;
    await cm.executeQuery(
      format(`UPDATE ?? SET ? WHERE ?? = ?`, [
        `${schema}.coremeasurements`,
        {
          RawTreeTag: merged.TreeTag ?? current.TreeTag ?? null,
          RawStemTag: merged.StemTag ?? current.StemTag ?? null,
          RawSpCode: merged.SpeciesCode ?? current.SpeciesCode ?? null,
          RawQuadrat: merged.QuadratName ?? current.QuadratName ?? null,
          RawX: toOptionalNumber(effective('StemLocalX')),
          RawY: toOptionalNumber(effective('StemLocalY')),
          RawCodes: effective('Attributes') ?? null,
          RawComments: effective('Description') ?? null,
          Description: effective('Description') ?? null,
          MeasurementDate: normalizedMeasurementDate,
          MeasuredDBH: toOptionalNumber(effective('MeasuredDBH')),
          MeasuredHOM: toOptionalNumber(effective('MeasuredHOM'))
        },
        'CoreMeasurementID',
        coreMeasurementID
      ]),
      [],
      txID
    );
  }

  if (changesFound) {
    const effectiveCensusID = Number(merged.CensusID ?? current.CensusID ?? censusID);

    if (coreMeasurementID > 0 && effectiveCensusID > 0) {
      await refreshIngestionErrorsForMeasurement(
        cm,
        schema,
        coreMeasurementID,
        effectiveCensusID,
        {
          Tag: merged.TreeTag ?? current.TreeTag ?? null,
          StemTag: merged.StemTag ?? current.StemTag ?? null,
          SpCode: merged.SpeciesCode ?? current.SpeciesCode ?? null,
          Quadrat: merged.QuadratName ?? current.QuadratName ?? null,
          X: toOptionalNumber(effective('StemLocalX')),
          Y: toOptionalNumber(effective('StemLocalY')),
          DBH: toOptionalNumber(effective('MeasuredDBH')),
          HOM: toOptionalNumber(effective('MeasuredHOM')),
          Date: normalizedMeasurementDate,
          Codes: effective('Attributes') ?? null,
          Comments: effective('Description') ?? null
        },
        txID
      );
    }

    const deleteErrorsQuery = format(
      `DELETE mel
       FROM ??.measurement_error_log mel
       JOIN ??.measurement_errors me ON me.ErrorID = mel.ErrorID
       WHERE mel.MeasurementID = ? AND me.ErrorSource = 'validation'`,
      [schema, schema]
    );
    await cm.executeQuery(deleteErrorsQuery, [coreMeasurementID], txID);

    const resetValidationQuery = format('/* skip_changelog */ UPDATE ?? SET ?? = ? WHERE ?? = ?', [
      `${schema}.coremeasurements`,
      'IsValidated',
      null,
      'CoreMeasurementID',
      coreMeasurementID
    ]);
    await cm.executeQuery(resetValidationQuery, [], txID);
  }

  // Capture after-state for exact-revert support.
  const afterCoreRow = await loadCoreMeasurementRow(cm, schema, coreMeasurementID, txID);
  const afterStemGUID = (afterCoreRow?.StemGUID ?? null) as number | null;
  const afterStemRow = await loadStemRow(cm, schema, afterStemGUID, txID);
  const afterTreeID = afterStemRow ? toPositiveNumber(afterStemRow.TreeID) : null;
  const afterTreeRow = await loadTreeRow(cm, schema, afterTreeID, txID);
  const afterCmAttrRows = await loadCmAttributeRows(cm, schema, coreMeasurementID, txID);

  const afterState: EditOperationStateRow[] = [];
  afterState.push(buildStateRow('coremeasurements', 'CoreMeasurementID', coreMeasurementID, afterCoreRow));
  if (afterStemRow && afterStemGUID !== null) {
    afterState.push(buildStateRow('stems', 'StemGUID', afterStemGUID, afterStemRow));
  }
  if (afterTreeRow && afterTreeID !== null) {
    afterState.push(buildStateRow('trees', 'TreeID', afterTreeID, afterTreeRow));
  }
  if (changedFields.has('Attributes')) {
    for (const attrRow of afterCmAttrRows) {
      afterState.push(buildStateRow('cmattributes', 'CMAID', Number(attrRow.CMAID), attrRow));
    }
  }

  // Refresh derived views so the UI sees the edit immediately. Batch callers
  // can suppress this and refresh the plot/census once after the outer batch.
  // This must run AFTER the post-validation block above: measurementssummary's
  // validation_errors LEFT JOIN reads measurementerrorlogs, so refreshing
  // earlier would project pre-validation error counts into the view.
  if (changesFound && input.refreshViews !== false) {
    const refreshCensusID = Number(merged.CensusID ?? current.CensusID ?? censusID);
    const refreshPlotID = Number(merged.PlotID ?? current.PlotID ?? plotID);
    if (refreshCensusID > 0 && refreshPlotID > 0) {
      const refreshTargets = await resolveMeasurementViewRefreshTargets(cm, schema, {
        coreMeasurementID,
        plotID: refreshPlotID,
        censusID: refreshCensusID,
        changedFields,
        beforeStemGUID: toPositiveNumber(beforeStemGUID),
        afterStemGUID: toPositiveNumber(afterStemGUID),
        transactionID: txID
      });

      if (refreshTargets.mode === 'targeted') {
        await refreshMeasurementViewsForCoreMeasurements(cm, schema, refreshTargets.coreMeasurementIDs, txID);
      } else {
        await refreshMeasurementViewsForScope(cm, schema, refreshPlotID, refreshCensusID, txID);
      }
    }
  }

  return {
    updatedIDs: { CoreMeasurementID: coreMeasurementID },
    beforeState,
    afterState,
    validationPending: true,
    postValidation: undefined
  };
}
