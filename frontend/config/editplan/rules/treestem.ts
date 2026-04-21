import { Effect } from '../types';
import { RuleContext } from './context';
import { planTreeResolution, planStemResolution, planQuadratResolution, resolveSpeciesByCode } from '../resolvers';

export async function applyTreeStemRules(ctx: RuleContext): Promise<Effect[]> {
  const effects: Effect[] = [];
  const treeIdentityChanged = ctx.changedFields.has('TreeTag') || ctx.changedFields.has('SpeciesCode');
  const stemIdentityChanged = ctx.changedFields.has('StemTag') || ctx.changedFields.has('QuadratName');

  let destinationTreeID: number | null = Number(ctx.oldRow.TreeID) || null;
  if (treeIdentityChanged) {
    const newCode = String(ctx.newRow.SpeciesCode ?? ctx.oldRow.SpeciesCode ?? '').trim();
    const { speciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);
    if (speciesID !== null) {
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
      destinationTreeID = planned.existingTreeID;

      const currentTreeID = Number(ctx.oldRow.TreeID);
      const movedAway = planned.sourceTreeID !== null && planned.sourceTreeID !== planned.existingTreeID;
      if (movedAway) {
        const destLabel = planned.existingTreeID
          ? `tree T#${planned.existingTreeID}`
          : planned.wouldCreate
            ? 'a new tree'
            : 'unresolved tree';
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
    if (quadratID !== null) {
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
      const movedAway = planned.sourceStemGUID !== null && planned.sourceStemGUID !== planned.existingStemGUID;
      if (movedAway) {
        const severity = planned.sourceStemRemainingMeasurements === 0 ? 'destructive' : 'warn';
        const destinationStemLabel = planned.existingStemGUID
          ? `stem S#${planned.existingStemGUID}`
          : planned.wouldCreate
            ? 'a new stem'
            : 'unresolved stem';
        effects.push({
          id: 'R3',
          severity,
          category: 'identity',
          title: 'Measurement will be reassigned to a different stem',
          detail: `Moving from stem S#${planned.sourceStemGUID} to ${destinationStemLabel}. Source stem will have ${planned.sourceStemRemainingMeasurements} measurement(s) after the move.`,
          affectedTable: 'stems',
          affectedRowCount: 1,
          references: {
            stemGUIDs: planned.existingStemGUID
              ? [Number(planned.sourceStemGUID), Number(planned.existingStemGUID)]
              : [Number(planned.sourceStemGUID)]
          }
        });
      }
    }
  }

  return effects;
}
