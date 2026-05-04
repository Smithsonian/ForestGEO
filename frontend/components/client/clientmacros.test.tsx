import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSelectableOptions } from './clientmacros';

const { getMapperSpy } = vi.hoisted(() => ({
  getMapperSpy: vi.fn(() => ({
    mapData: (rows: any[]) => rows
  }))
}));

vi.mock('@/config/datamapper', () => ({
  default: { getMapper: getMapperSpy }
}));

describe('loadSelectableOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dedupes selectable option strings before storing autocomplete options', async () => {
    const fetchMock = vi.fn(async (endpoint: string) => {
      let rows: any[] = [];
      if (endpoint.includes('/api/fetchall/attributes/')) {
        rows = [{ code: 'A1' }, { code: 'A1' }];
      } else if (endpoint.includes('/api/fetchall/trees/')) {
        rows = [{ treeTag: 'T1' }, { treeTag: 'T1' }];
      } else if (endpoint.includes('/api/fetchall/stems/')) {
        rows = [{ stemTag: 'S1' }, { stemTag: 'S1' }];
      } else if (endpoint.includes('/api/fetchall/quadrats/')) {
        rows = [{ quadratName: 'Q1' }, { quadratName: 'Q1' }];
      } else if (endpoint.includes('/api/fetchall/species/')) {
        rows = [{ speciesCode: 'CRATSN' }, { speciesCode: 'CRATSN' }, { speciesCode: 'RUBI04' }];
      }
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const previousOptions = { treeTag: [], stemTag: [], quadratName: [], speciesCode: [], codes: [] };
    let nextOptions = previousOptions;
    const setSelectableOpts = vi.fn((updater: (prev: typeof previousOptions) => typeof previousOptions) => {
      nextOptions = updater(previousOptions);
    });

    await loadSelectableOptions({ schemaName: 'myschema' } as any, { plotID: 42 } as any, { plotCensusNumber: 3 } as any, setSelectableOpts as any);

    expect(nextOptions).toMatchObject({
      treeTag: ['T1'],
      stemTag: ['S1'],
      quadratName: ['Q1'],
      speciesCode: ['CRATSN', 'RUBI04'],
      codes: ['A1']
    });
  });
});
