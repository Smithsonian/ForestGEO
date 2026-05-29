import { Effect, PreviewError, TreeStemResolutionPreviewError } from '../types';
import { RuleContext } from './context';
import {
  planTreeResolution,
  planStemResolution,
  planQuadratResolution,
  resolveSpeciesByCode,
  CONFLICT_REASON_INACTIVE_TREE,
  CONFLICT_REASON_INACTIVE_STEM,
  CONFLICT_REASON_DIFFERENT_QUADRAT
} from '../resolvers';

type TreeStemError = TreeStemResolutionPreviewError;

function buildError(subject: TreeStemError['subject'], reason: TreeStemError['reason'], field: TreeStemError['field'], message: string): TreeStemError {
  return { kind: 'TreeStemResolution', subject, reason, field, message, severity: 'destructive', blocking: true };
}

export async function applyTreeStemRules(ctx: RuleContext): Promise<{ effects: Effect[]; errors: PreviewError[] }> {
  const effects: Effect[] = [];
  const errors: PreviewError[] = [];

  const treeIdentityChanged = ctx.changedFields.has('TreeTag') || ctx.changedFields.has('SpeciesCode');
  const stemIdentityChanged = ctx.changedFields.has('StemTag') || ctx.changedFields.has('QuadratName');

  let destinationTreeID: number | null = Number(ctx.oldRow.TreeID) || null;

  if (treeIdentityChanged) {
    const newCode = String(ctx.newRow.SpeciesCode ?? ctx.oldRow.SpeciesCode ?? '').trim();
    const { speciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);

    if (speciesID === null) {
      if (ctx.changedFields.has('SpeciesCode')) {
        errors.push(buildError('species', 'missing', 'SpeciesCode', `Species code "${newCode}" not found in this schema`));
      }
      // When speciesID is null but SpeciesCode was not edited, skip tree resolution silently —
      // the broken code is not a consequence of this edit.
    } else {
      const planned = await planTreeResolution(
        ctx.cm,
        ctx.schema,
        {
          TreeTag: String(ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag),
          SpeciesID: speciesID,
          CensusID: ctx.censusID,
          currentTreeID: Number(ctx.oldRow.TreeID) || null
        },
        ctx.transactionID
      );

      if (planned.conflictReason === CONFLICT_REASON_INACTIVE_TREE) {
        errors.push(
          buildError('tree', 'inactive', 'TreeTag', `Matching tree for TreeTag "${ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag}" exists but is inactive`)
        );
      } else if (!planned.existingTreeID && !planned.wouldCreate) {
        errors.push(buildError('tree', 'cannot_create', 'TreeTag', `Cannot resolve or create tree for TreeTag "${ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag}"`));
      } else {
        destinationTreeID = planned.existingTreeID;
        const currentTreeID = Number(ctx.oldRow.TreeID);
        const movedAway = planned.sourceTreeID !== null && planned.sourceTreeID !== planned.existingTreeID;
        if (movedAway) {
          const destLabel = planned.existingTreeID ? `tree T#${planned.existingTreeID}` : planned.wouldCreate ? 'a new tree' : 'unresolved tree';
          const severity = planned.sourceTreeRemainingStems === 0 ? 'destructive' : 'warn';
          effects.push({
            id: 'R2',
            severity,
            category: 'identity',
            title: 'Measurement will be reassigned to a different tree',
            detail: `Moving from tree T#${currentTreeID} to ${destLabel}. Source tree will have ${planned.sourceTreeRemainingStems} active stem(s) after the move.`,
            affectedTable: 'trees',
            affectedRowCount: 1,
            references: { treeIDs: planned.existingTreeID ? [planned.existingTreeID, currentTreeID] : [currentTreeID] }
          });
        }
      }
    }
  }

  if (stemIdentityChanged && destinationTreeID !== null) {
    const { quadratID } = await planQuadratResolution(
      ctx.cm,
      ctx.schema,
      {
        QuadratName: String(ctx.newRow.QuadratName ?? ctx.oldRow.QuadratName),
        PlotID: ctx.plotID
      },
      ctx.transactionID
    );

    if (quadratID === null) {
      errors.push(buildError('quadrat', 'missing', 'QuadratName', `Quadrat "${ctx.newRow.QuadratName ?? ctx.oldRow.QuadratName}" not found in this plot`));
    } else {
      const planned = await planStemResolution(
        ctx.cm,
        ctx.schema,
        {
          TreeID: destinationTreeID,
          CensusID: ctx.censusID,
          StemTag: String(ctx.newRow.StemTag ?? ctx.oldRow.StemTag),
          QuadratID: quadratID,
          currentStemGUID: Number(ctx.oldRow.StemGUID) || null
        },
        ctx.transactionID
      );

      if (planned.conflictReason === CONFLICT_REASON_INACTIVE_STEM) {
        errors.push(
          buildError(
            'stem',
            'inactive',
            'StemTag',
            `Matching stem for StemTag "${ctx.newRow.StemTag ?? ctx.oldRow.StemTag}" exists but is inactive for this census`
          )
        );
      } else if (planned.conflictReason === CONFLICT_REASON_DIFFERENT_QUADRAT) {
        errors.push(buildError('stem', 'different_quadrat', 'QuadratName', `Matching stem exists in a different quadrat`));
      } else if (!planned.existingStemGUID && !planned.wouldCreate) {
        errors.push(buildError('stem', 'cannot_create', 'StemTag', `Cannot resolve or create stem for StemTag "${ctx.newRow.StemTag ?? ctx.oldRow.StemTag}"`));
      } else {
        const movedAway = planned.sourceStemGUID !== null && planned.sourceStemGUID !== planned.existingStemGUID;
        if (movedAway) {
          const severity = planned.sourceStemRemainingMeasurements === 0 ? 'destructive' : 'warn';
          const destinationStemLabel = planned.existingStemGUID ? `stem S#${planned.existingStemGUID}` : planned.wouldCreate ? 'a new stem' : 'unresolved stem';
          effects.push({
            id: 'R3',
            severity,
            category: 'identity',
            title: 'Measurement will be reassigned to a different stem',
            detail: `Moving from stem S#${planned.sourceStemGUID} to ${destinationStemLabel}. Source stem will have ${planned.sourceStemRemainingMeasurements} measurement(s) after the move.`,
            affectedTable: 'stems',
            affectedRowCount: 1,
            references: {
              stemGUIDs: planned.existingStemGUID ? [Number(planned.sourceStemGUID), Number(planned.existingStemGUID)] : [Number(planned.sourceStemGUID)]
            }
          });
        }
      }
    }
  }

  return { effects, errors };
}
