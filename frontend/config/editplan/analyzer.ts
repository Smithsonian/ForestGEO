import ConnectionManager from '@/config/connectionmanager';
import type { UserAuthRoles } from '@/config/macros';
import { EditPlan, EditPlanDataType, Effect, FieldChange, PreviewError, RoleForbiddenFieldPreviewError, SEVERITY_RANK, Severity } from './types';
import { applySpeciesRules } from './rules/species';
import { applyTreeStemRules } from './rules/treestem';
import { applyCoordinateRules } from './rules/coordinates';
import { applyAttributeRules } from './rules/attributes';
import { canonicalizeEditPayload, rejectDisallowedFields, EditSurface, isFieldEditableByRole, PER_COLUMN_DECIMAL_PRECISION, isDateField } from './fieldpolicy';
import { hashPlan } from './planhash';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

// MySQL2 returns DECIMAL columns as strings (e.g. '3.500000') and DATE/DATETIME
// columns as Date objects. The client sends numbers and 'YYYY-MM-DD' strings.
// Comparing those raw with Object.is produces spurious fieldChanges that fire
// cross-row rules (R4) on every revert and edit. Normalize both sides to the
// same JS shape before diffing. isDateField is sourced from fieldpolicy so the
// planhash uses the same classification.
function normalizeForDiff(field: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (isDateField(field)) {
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return value;
  }
  const precision = PER_COLUMN_DECIMAL_PRECISION[field];
  if (precision !== undefined) {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isFinite(num)) return Number(num.toFixed(precision));
  }
  return value;
}

function fieldChanged(field: string, from: unknown, to: unknown): boolean {
  return !Object.is(normalizeForDiff(field, from), normalizeForDiff(field, to));
}

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

export class RoleForbiddenFieldError extends Error {
  constructor(
    public fields: string[],
    public role: UserAuthRoles | 'unknown'
  ) {
    super(`role ${role} cannot edit fields: ${fields.join(',')}`);
    this.name = 'RoleForbiddenFieldError';
  }
}

export class EditPlanUnapplicableError extends Error {
  constructor(public readonly blockingErrors: PreviewError[]) {
    super(`Edit plan has ${blockingErrors.length} blocking error(s)`);
    this.name = 'EditPlanUnapplicableError';
  }
}

export interface AnalyzeEditOptions {
  role?: UserAuthRoles | null;
}

function roleLabel(role: UserAuthRoles | null | undefined): UserAuthRoles | 'unknown' {
  return role ?? 'unknown';
}

function buildRoleForbiddenError(field: string, role: UserAuthRoles | null | undefined): PreviewError {
  const label = roleLabel(role);
  return {
    kind: 'RoleForbiddenField',
    field,
    role: label,
    message: `${field} can only be edited by global or db admin users.`,
    severity: 'destructive',
    blocking: true
  };
}

function buildRoleForbiddenEffect(error: PreviewError): Effect {
  return {
    id: `AUTH_ROLE_FORBIDDEN_FIELD_${error.field}`,
    severity: 'destructive',
    category: 'validation',
    title: 'Field restricted by role',
    detail: error.message,
    affectedTable: 'authorization',
    affectedRowCount: 1
  };
}

export function isRoleForbiddenPreviewError(error: PreviewError): error is RoleForbiddenFieldPreviewError {
  return error.kind === 'RoleForbiddenField';
}

export function assertEditPlanCanApply(plan: EditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(isRoleForbiddenPreviewError).filter(error => error.blocking);
  if (roleErrors.length > 0 || plan.canApply === false) {
    throw new RoleForbiddenFieldError(
      roleErrors.map(error => error.field),
      roleErrors[0]?.role ?? 'unknown'
    );
  }
}

export async function analyzeEdit(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  targetID: number,
  rawNewRow: Record<string, unknown>,
  transactionID?: string,
  options: AnalyzeEditOptions = {}
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
    if (fieldChanged(field, from, to)) {
      changedFields.add(field);
      fieldChanges.push({ field, from, to });
    }
  }

  const roleErrors = fieldChanges
    .filter(change => !isFieldEditableByRole(change.field, options.role))
    .map(change => buildRoleForbiddenError(change.field, options.role));
  const roleForbiddenEffects = roleErrors.map(buildRoleForbiddenEffect);
  const errors: PreviewError[] = [...roleErrors];

  const ctx = { cm, schema, transactionID, dataType, plotID, censusID, oldRow, newRow, changedFields };
  const effects: Effect[] = [...roleForbiddenEffects];

  // Measurement rules (R1a, R2, R3, R4, R5) surface cross-row and identity
  // ramifications on fully-resolved coremeasurements rows. Failed measurements
  // (StemGUID IS NULL) carry no species/tree/stem/cmattributes linkage, so the
  // rule triggers (SpeciesCode / TreeTag / StemTag / QuadratName / StemLocalX /
  // StemLocalY / Attributes) do not appear on the failed-row surface at all.
  // Their edits are genuinely row-local: a failed-row change writes only to
  // coremeasurements raw columns via writeFailedMeasurements. Skip the rule
  // dispatch entirely so the contract is explicit, rather than relying on every
  // rule to silently return [] for a data shape it was never designed to see.
  if (dataType === 'measurementssummary' && roleErrors.length === 0) {
    effects.push(...(await applySpeciesRules(ctx)));
    const treeStem = await applyTreeStemRules(ctx);
    effects.push(...treeStem.effects);
    errors.push(...treeStem.errors);
    effects.push(...(await applyCoordinateRules(ctx)));
    effects.push(...(await applyAttributeRules(ctx)));
  }

  const effectSeverity = effects.reduce<Severity>((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info');
  const errorSeverity = errors.reduce<Severity>((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info');
  const maxSeverity: Severity = SEVERITY_RANK[errorSeverity] > SEVERITY_RANK[effectSeverity] ? errorSeverity : effectSeverity;

  const plan: EditPlan = {
    dataType,
    targetID,
    fieldChanges,
    effects,
    errors,
    canApply: errors.length === 0,
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
