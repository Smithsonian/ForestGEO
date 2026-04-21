import ConnectionManager from '@/config/connectionmanager';
import { EditPlan, EditPlanDataType, Effect, FieldChange, SEVERITY_RANK, Severity } from './types';
import { applySpeciesRules } from './rules/species';
import { applyTreeStemRules } from './rules/treestem';
import { applyCoordinateRules } from './rules/coordinates';
import { applyAttributeRules } from './rules/attributes';
import { canonicalizeEditPayload, rejectDisallowedFields, EditSurface } from './fieldpolicy';
import { hashPlan } from './planhash';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export class DisallowedFieldError extends Error {
  constructor(public fields: string[]) {
    super(`Disallowed fields: ${fields.join(',')}`);
    this.name = 'DisallowedFieldError';
  }
}

export class TargetNotFoundError extends Error {
  constructor(public targetID: number) {
    super(`target not found in requested plot/census: ${targetID}`);
    this.name = 'TargetNotFoundError';
  }
}

export { TargetNotFoundError as TargetScopeError };

const SURFACE_BY_DATATYPE: Record<EditPlanDataType, EditSurface> = {
  measurementssummary: 'measurementssummary',
  failedmeasurements: 'failedmeasurements'
};

export async function analyzeEdit(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  targetID: number,
  rawNewRow: Record<string, unknown>,
  transactionID?: string
): Promise<EditPlan> {
  const surface = SURFACE_BY_DATATYPE[dataType];
  const newRow = canonicalizeEditPayload(surface, rawNewRow);
  const disallowed = rejectDisallowedFields(surface, newRow);
  if (disallowed) throw new DisallowedFieldError(disallowed);

  const oldRow = await loadCurrentRow(cm, schema, dataType, plotID, censusID, targetID, transactionID);

  const changedFields = new Set<string>();
  const fieldChanges: FieldChange[] = [];
  for (const [field, to] of Object.entries(newRow)) {
    const from = (oldRow as Record<string, unknown>)[field];
    if (!Object.is(from, to)) {
      changedFields.add(field);
      fieldChanges.push({ field, from, to });
    }
  }

  const ctx = { cm, schema, transactionID, dataType, plotID, censusID, oldRow, newRow, changedFields };
  const effects: Effect[] = [];
  effects.push(...(await applySpeciesRules(ctx)));
  effects.push(...(await applyTreeStemRules(ctx)));
  effects.push(...(await applyCoordinateRules(ctx)));
  effects.push(...(await applyAttributeRules(ctx)));

  const maxSeverity = effects.reduce<Severity>(
    (max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max),
    'info'
  );

  const plan: EditPlan = {
    dataType,
    targetID,
    fieldChanges,
    effects,
    maxSeverity,
    planHash: '',
    generatedAt: new Date().toISOString()
  };
  plan.planHash = hashPlan(plan);
  return plan;
}

async function loadCurrentRow(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  targetID: number,
  transactionID?: string
): Promise<Record<string, unknown>> {
  if (dataType === 'failedmeasurements') {
    const rows = await cm.executeQuery(
      safeFormatQuery(
        schema,
        `SELECT
           cm.CoreMeasurementID,
           cm.CensusID,
           c.PlotID,
           cm.RawTreeTag AS Tag,
           cm.RawStemTag AS StemTag,
           cm.RawSpCode AS SpCode,
           cm.RawQuadrat AS Quadrat,
           cm.RawX AS X,
           cm.RawY AS Y,
           cm.MeasuredDBH AS DBH,
           cm.MeasuredHOM AS HOM,
           cm.MeasurementDate AS Date,
           cm.RawCodes AS Codes,
           cm.RawComments AS Comments
         FROM ??.coremeasurements cm
         JOIN ??.census c ON c.CensusID = cm.CensusID
         WHERE cm.CoreMeasurementID = ? AND cm.CensusID = ? AND c.PlotID = ? AND cm.StemGUID IS NULL AND cm.IsActive = 1
         LIMIT 1`
      ),
      [targetID, censusID, plotID],
      transactionID
    );
    if (!rows.length) throw new TargetNotFoundError(targetID);
    return rows[0];
  }

  const rows = await cm.executeQuery(
    safeFormatQuery(
      schema,
      `SELECT
         cm.CoreMeasurementID,
         cm.CensusID,
         c.PlotID,
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
         s.StemGUID,
         s.LocalX AS StemLocalX,
         s.LocalY AS StemLocalY,
         q.QuadratName
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       LEFT JOIN ??.stems s ON s.StemGUID = cm.StemGUID
       LEFT JOIN ??.trees t ON t.TreeID = s.TreeID
       LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
       LEFT JOIN ??.quadrats q ON q.QuadratID = s.QuadratID
       WHERE cm.CoreMeasurementID = ? AND cm.CensusID = ? AND c.PlotID = ? AND cm.StemGUID IS NOT NULL AND cm.IsActive = 1
       LIMIT 1`
    ),
    [targetID, censusID, plotID],
    transactionID
  );
  if (!rows.length) throw new TargetNotFoundError(targetID);
  return rows[0];
}
