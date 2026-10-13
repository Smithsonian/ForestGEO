import { Effect, PreviewError, SpeciesCorrectionSummary, TreeStemResolutionPreviewError } from '../types';
import { RuleContext, SpeciesNotFoundError } from './context';
import { resolveSpeciesByCode } from '../resolvers';
import { planSpeciesCorrection } from '../tree-species-correction';

type SpeciesError = TreeStemResolutionPreviewError;

function buildError(subject: SpeciesError['subject'], reason: SpeciesError['reason'], field: SpeciesError['field'], message: string): SpeciesError {
  return { kind: 'TreeStemResolution', subject, reason, field, message, severity: 'destructive', blocking: true };
}

export interface SpeciesRuleResult {
  effects: Effect[];
  errors: PreviewError[];
  speciesCorrection?: SpeciesCorrectionSummary;
}

// Identity fields that, when changed in the same edit as SpeciesCode, make
// the edit ambiguous: is the row being re-pointed at a different
// tree/stem/quadrat, or is the tree's recorded species being corrected in
// place? #427 keeps these mutually exclusive — submit the species correction
// alone, then any identity move as a separate edit.
const MIXED_IDENTITY_FIELDS = ['TreeTag', 'StemTag', 'QuadratName'] as const;

export async function applySpeciesRules(ctx: RuleContext): Promise<SpeciesRuleResult> {
  if (!ctx.changedFields.has('SpeciesCode')) return { effects: [], errors: [] };

  const newCode = String(ctx.newRow.SpeciesCode ?? '').trim();
  if (!newCode) throw new SpeciesNotFoundError('');

  const { speciesID: newSpeciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);
  if (newSpeciesID === null) throw new SpeciesNotFoundError(newCode);

  const oldSpeciesID = Number(ctx.oldRow.SpeciesID);
  // Same resolved species (including a case-only spelling difference, since
  // resolveSpeciesByCode matches case-insensitively) is not a correction.
  if (newSpeciesID === oldSpeciesID) return { effects: [], errors: [] };

  const errors: PreviewError[] = [];

  const mixedIdentityFields = MIXED_IDENTITY_FIELDS.filter(field => ctx.changedFields.has(field));
  if (mixedIdentityFields.length > 0) {
    errors.push(
      buildError(
        'species',
        'mixed_identity',
        'SpeciesCode',
        `Species correction cannot be combined with a ${mixedIdentityFields.join('/')} change in the same edit; submit the species correction on its own.`
      )
    );
    return { effects: [], errors };
  }

  const treeID = Number(ctx.oldRow.TreeID);
  if (!Number.isFinite(treeID) || treeID <= 0) {
    errors.push(buildError('tree', 'missing', 'TreeTag', 'Measurement is not linked to an active tree; species cannot be corrected for an unlinked row.'));
    return { effects: [], errors };
  }

  const result = await planSpeciesCorrection(
    ctx.cm,
    ctx.schema,
    {
      treeID,
      plotID: ctx.plotID,
      censusID: ctx.censusID,
      newSpeciesID,
      editedStemGUID: Number(ctx.oldRow.StemGUID),
      editedCoreMeasurementID: Number(ctx.oldRow.CoreMeasurementID)
    },
    ctx.transactionID
  );

  switch (result.status) {
    case 'no_correction':
      // Planner-level re-check (e.g. a future writer re-reading under lock)
      // found the destination is already the tree's own current species.
      // Same no-op contract as the case-only spelling check above.
      return { effects: [], errors: [] };
    case 'source_missing':
      errors.push(buildError('tree', 'missing', 'TreeTag', result.message));
      return { effects: [], errors };
    case 'source_inactive':
      errors.push(buildError('tree', 'inactive', 'TreeTag', result.message));
      return { effects: [], errors };
    case 'destination_species_missing':
      errors.push(buildError('species', 'missing', 'SpeciesCode', result.message));
      return { effects: [], errors };
    case 'destination_species_inactive':
      errors.push(buildError('species', 'inactive', 'SpeciesCode', result.message));
      return { effects: [], errors };
    case 'destination_exists':
      errors.push(buildError('species', 'destination_exists', 'SpeciesCode', result.message));
      return { effects: [], errors };
    case 'scope_inconsistent':
      errors.push(buildError('tree', 'inconsistent_scope', 'TreeTag', result.message));
      return { effects: [], errors };
    case 'source_identity_invalid':
      // TreeTag/SpeciesID/current species code is NULL or blank on the
      // source tree itself — a pre-existing data integrity problem, not
      // something this edit can repair by inventing a value.
      errors.push(buildError('tree', 'inconsistent_scope', 'TreeTag', result.message));
      return { effects: [], errors };
    case 'destination_species_code_missing':
      // The destination species exists and is active, but has no
      // restorable canonical SpeciesCode to correct to.
      errors.push(buildError('species', 'inconsistent_scope', 'SpeciesCode', result.message));
      return { effects: [], errors };
    case 'edited_stem_missing':
      errors.push(buildError('stem', 'missing', 'StemTag', result.message));
      return { effects: [], errors };
    case 'edited_stem_inactive':
      errors.push(buildError('stem', 'inactive', 'StemTag', result.message));
      return { effects: [], errors };
    case 'edited_measurement_missing':
      errors.push(buildError('stem', 'missing', 'StemTag', result.message));
      return { effects: [], errors };
    case 'edited_measurement_inactive':
      errors.push(buildError('stem', 'inactive', 'StemTag', result.message));
      return { effects: [], errors };
    case 'edited_measurement_moved':
      // The edited CM exists on this tree but is no longer attached to the
      // stem that was actually checked/previewed — a data integrity
      // conflict (F8), not a normal missing/inactive outcome.
      errors.push(buildError('stem', 'inconsistent_scope', 'StemTag', result.message));
      return { effects: [], errors };
  }

  const correction = result.correction;
  const totalStems = correction.activeStemCount + correction.inactiveStemCount;
  const totalMeasurements = correction.activeMeasurementCount + correction.inactiveMeasurementCount;

  const effect: Effect = {
    id: 'R1a',
    severity: 'warn',
    category: 'identity',
    title: 'Tree species will be corrected',
    detail:
      `Tree T#${correction.targetTreeID} (TreeTag "${correction.treeTag}") species "${correction.oldSpeciesCode}" -> "${correction.newSpeciesCode}". ` +
      `${totalStems} stem(s) (${correction.activeStemCount} active, ${correction.inactiveStemCount} inactive) and ` +
      `${totalMeasurements} measurement(s) (${correction.activeMeasurementCount} active, ${correction.inactiveMeasurementCount} inactive) will show the corrected species.`,
    affectedTable: 'trees',
    affectedRowCount: 1,
    references: {
      treeIDs: [correction.targetTreeID],
      speciesID: correction.newSpeciesID,
      coreMeasurementIDs: correction.measurements.map(measurement => measurement.coreMeasurementID),
      stemGUIDs: correction.stems.map(stem => stem.stemGUID)
    }
  };

  return { effects: [effect], errors: [], speciesCorrection: correction };
}
