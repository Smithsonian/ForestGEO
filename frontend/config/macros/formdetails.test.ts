import { describe, it, expect, vi } from 'vitest';

// The global test setup mocks @/config/sqlrdsdefinitions/core as an empty module,
// which strips AttributeStatusOptions that formdetails imports at module load.
// Restore the real export so formdetails can be imported under test.
vi.mock('@/config/sqlrdsdefinitions/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@/config/sqlrdsdefinitions/core')>();
  return actual;
});

import { FormType, TableHeadersByFormType, RequiredTableHeadersByFormType } from './formdetails';

describe('arcgis_xlsx headers', () => {
  it('exposes the real workbook columns including lx/ly and ParentGlobalID', () => {
    const labels = TableHeadersByFormType[FormType.arcgis_xlsx].map(h => h.label);
    expect(labels).toEqual(expect.arrayContaining(['GlobalID', 'ParentGlobalID', 'quadrat', 'tag', 'spcode', 'lx', 'ly', 'Date_measured']));
  });

  it('derives required headers by category filter', () => {
    const required = RequiredTableHeadersByFormType[FormType.arcgis_xlsx].map(h => h.label);
    expect(required).toEqual(expect.arrayContaining(['tag', 'spcode', 'lx', 'ly']));
  });
});
