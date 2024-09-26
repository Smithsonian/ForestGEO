import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConn } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';
import { AllTaxonomiesViewQueryConfig, handleUpsertForSlices } from '@/components/processors/processorhelperfunctions';
import * as utils from '@/config/utils';
import { AllTaxonomiesViewResult } from '@/config/sqlrdsdefinitions/views'; // Import utils module

// Mock getConn and handleUpsert using vi.mock
vi.mock('@/components/processors/processormacros', () => ({
  getConn: vi.fn(),
  runQuery: vi.fn()
}));

vi.mock('@/config/utils', async () => {
  // Import the actual utils module to access the original functions
  const actualUtils = await vi.importActual<typeof utils>('@/config/utils');

  return {
    ...actualUtils, // Keep all original utilities
    handleUpsert: vi.fn() // Mock only handleUpsert
  };
});

describe('handleUpsertForSlices with AllTaxonomiesViewQueryConfig', () => {
  let connection: PoolConnection;

  beforeEach(() => {
    connection = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      query: vi.fn(),
      execute: vi.fn()
    } as unknown as PoolConnection;

    vi.mocked(getConn).mockResolvedValue(connection);
    vi.mocked(utils.handleUpsert).mockResolvedValue(1); // Mock handleUpsert to return a consistent ID

    vi.clearAllMocks();
  });

  it('should correctly propagate foreign keys across slices for AllTaxonomiesViewQueryConfig', async () => {
    const newRow = {
      Family: 'Fabaceae',
      Genus: 'Acacia',
      GenusAuthority: 'Willd.',
      SpeciesCode: 'AC001',
      SpeciesName: 'Acacia nilotica',
      ValidCode: 'Y',
      SubspeciesName: 'nilotica',
      SpeciesAuthority: 'L.',
      IDLevel: 2,
      SubspeciesAuthority: 'DC.',
      FieldFamily: 'Leguminosae',
      Description: 'Thorny shrub'
    };

    const insertedIds = await handleUpsertForSlices<AllTaxonomiesViewResult>(connection, 'schema_name', newRow, AllTaxonomiesViewQueryConfig);

    // Verify that handleUpsert was called 3 times (family, genus, species)
    expect(utils.handleUpsert).toHaveBeenCalledTimes(3);

    // Verify that FamilyID, GenusID, and SpeciesID are propagated correctly
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(1, connection, 'schema_name', 'family', { Family: 'Fabaceae' }, 'FamilyID');
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(
      2,
      connection,
      'schema_name',
      'genus',
      expect.objectContaining({
        FamilyID: 1,
        Genus: 'Acacia',
        GenusAuthority: 'Willd.'
      }),
      'GenusID'
    );
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(
      3,
      connection,
      'schema_name',
      'species',
      expect.objectContaining({
        GenusID: 1,
        SpeciesCode: 'AC001',
        SpeciesName: 'Acacia nilotica',
        ValidCode: 'Y',
        SubspeciesName: 'nilotica',
        SpeciesAuthority: 'L.',
        IDLevel: 2,
        SubspeciesAuthority: 'DC.',
        FieldFamily: 'Leguminosae',
        Description: 'Thorny shrub'
      }),
      'SpeciesID'
    );

    expect(insertedIds).toEqual({
      family: 1,
      genus: 1,
      species: 1
    });
  });
});
