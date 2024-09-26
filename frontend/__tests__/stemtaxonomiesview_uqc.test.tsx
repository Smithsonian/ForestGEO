import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConn } from '@/components/processors/processormacros';
import { PoolConnection } from 'mysql2/promise';
import { handleUpsertForSlices, StemTaxonomiesViewQueryConfig } from '@/components/processors/processorhelperfunctions';
import * as utils from '@/config/utils'; // Import utils module

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

describe('handleUpsertForSlices', () => {
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

  it('should correctly propagate foreign keys across slices', async () => {
    const newRow = {
      TreeTag: 'T001',
      StemTag: 'S001',
      SpeciesCode: 'SP001',
      SpeciesName: 'Test Species'
    };

    const insertedIds = await handleUpsertForSlices(connection, 'schema_name', newRow, StemTaxonomiesViewQueryConfig);

    // Verify that handleUpsert was called 5 times (family, genus, species, trees, stems)
    expect(utils.handleUpsert).toHaveBeenCalledTimes(5);

    // Verify that the FamilyID, GenusID, and SpeciesID are propagated correctly
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(1, connection, 'schema_name', 'family', { SpeciesCode: 'SP001' }, 'FamilyID');
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(2, connection, 'schema_name', 'genus', { FamilyID: 1, Family: undefined, Genus: undefined }, 'GenusID');
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(3, connection, 'schema_name', 'species', { GenusID: 1, SpeciesName: 'Test Species' }, 'SpeciesID');
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(4, connection, 'schema_name', 'trees', { SpeciesID: 1, StemTag: 'S001' }, 'TreeID');
    expect(utils.handleUpsert).toHaveBeenNthCalledWith(5, connection, 'schema_name', 'stems', { TreeTag: 'T001', TreeID: 1 }, 'StemID');

    expect(insertedIds).toEqual({
      family: 1,
      genus: 1,
      species: 1,
      trees: 1,
      stems: 1
    });
  });
});
