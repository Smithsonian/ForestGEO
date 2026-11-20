import { describe, expect, it, vi } from 'vitest';
import type ConnectionManager from '@/lib/db/connectionmanager';
import { CONFLICT_REASON_SPECIES_CONFLICT, planTreeResolution } from './resolvers';

const TEST_SCHEMA = 'forestgeo_testing';
const DESTINATION_TAG = 'T124';
const EDITED_SPECIES_ID = 1;
const OTHER_SPECIES_CODE = 'BB';
const CENSUS_ID = 7;
const SOURCE_TREE_ID = 10;
const OTHER_SPECIES_TREE_ID = 55;

function makeConnectionManager(rowSequence: unknown[][]) {
  let callIndex = 0;
  const executeQuery = vi.fn(async () => rowSequence[callIndex++] ?? []);
  return { cm: { executeQuery } as unknown as ConnectionManager, executeQuery };
}

const treeInput = { TreeTag: DESTINATION_TAG, SpeciesID: EDITED_SPECIES_ID, CensusID: CENSUS_ID, currentTreeID: SOURCE_TREE_ID };

describe('planTreeResolution — species conflict (#427)', () => {
  it('reports a species conflict instead of promising an insert when an active tree holds the tag under another species', async () => {
    const { cm } = makeConnectionManager([
      [], // no exact (tag, species, census) match
      [{ TreeID: OTHER_SPECIES_TREE_ID, SpeciesCode: OTHER_SPECIES_CODE }], // active tree with same tag, other species
      [{ cnt: 2 }] // source tree stems
    ]);

    const result = await planTreeResolution(cm, TEST_SCHEMA, treeInput);

    expect(result.conflictReason, JSON.stringify(result)).toBe(CONFLICT_REASON_SPECIES_CONFLICT);
    expect(result.wouldCreate, JSON.stringify(result)).toBe(false);
    expect(result.existingTreeID).toBeNull();
    expect(result.conflictingTreeID).toBe(OTHER_SPECIES_TREE_ID);
    expect(result.conflictingSpeciesCode).toBe(OTHER_SPECIES_CODE);
  });

  it('still plans an insert when no tree holds the tag under any species', async () => {
    const { cm } = makeConnectionManager([[], [], [{ cnt: 2 }]]);
    const result = await planTreeResolution(cm, TEST_SCHEMA, treeInput);
    expect(result.wouldCreate, JSON.stringify(result)).toBe(true);
    expect(result.conflictReason).toBeUndefined();
  });

  it('does not look for another species when the exact (tag, species, census) tree exists', async () => {
    const { cm, executeQuery } = makeConnectionManager([[{ TreeID: 77, IsActive: 1 }], [{ cnt: 2 }]]);
    const result = await planTreeResolution(cm, TEST_SCHEMA, treeInput);
    expect(result.existingTreeID).toBe(77);
    expect(result.conflictReason).toBeUndefined();
    const issuedSql = executeQuery.mock.calls.map(callArgs => String((callArgs as unknown[])[0]));
    expect(
      issuedSql.some(sql => sql.includes('<>')),
      issuedSql.join('\n')
    ).toBe(false);
  });
});
