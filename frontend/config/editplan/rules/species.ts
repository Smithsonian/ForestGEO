import { Effect } from '../types';
import { RuleContext, SpeciesNotFoundError } from './context';
import { resolveSpeciesByCode } from '../resolvers';

export async function applySpeciesRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('SpeciesCode')) return [];

  const newCode = String(ctx.newRow.SpeciesCode ?? '').trim();
  if (!newCode) throw new SpeciesNotFoundError('');

  const { speciesID: newSpeciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);
  if (newSpeciesID === null) throw new SpeciesNotFoundError(newCode);

  const oldSpeciesID = Number(ctx.oldRow.SpeciesID);
  if (newSpeciesID === oldSpeciesID) return [];

  return [
    {
      id: 'R1a',
      severity: 'warn',
      category: 'identity',
      title: 'Measurement will be re-linked to a different species',
      detail: `Species code "${ctx.oldRow.SpeciesCode}" → "${newCode}". No species row will be modified.`,
      affectedTable: 'coremeasurements',
      affectedRowCount: 1,
      references: { speciesID: newSpeciesID }
    }
  ];
}
