import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireSession: vi.fn(() => null),
  getSessionUserId: vi.fn(() => 'user-1'),
  assertCanEditMeasurementScope: vi.fn(async () => undefined),
  isValidSchema: vi.fn(() => true),
  readArcgisWorkbookDetailed: vi.fn(),
  readArcgisSheetMetadata: vi.fn(),
  transformArcgisWorkbook: vi.fn(),
  createArcgisImportSession: vi.fn(),
  loggerError: vi.fn()
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/auth-helpers', () => ({
  requireSession: mocks.requireSession,
  getSessionUserId: mocks.getSessionUserId
}));
vi.mock('@/config/editplan/scopeguard', () => ({
  assertCanEditMeasurementScope: mocks.assertCanEditMeasurementScope,
  ScopeAccessError: class ScopeAccessError extends Error {}
}));
vi.mock('@/config/utils/sqlsecurity', () => ({ isValidSchema: mocks.isValidSchema }));
vi.mock('@/lib/arcgis/workbook-reader', () => ({
  readArcgisWorkbookDetailed: mocks.readArcgisWorkbookDetailed,
  readArcgisSheetMetadata: mocks.readArcgisSheetMetadata
}));
vi.mock('@/lib/arcgis/transform', () => ({ transformArcgisWorkbook: mocks.transformArcgisWorkbook }));
vi.mock('@/lib/arcgis/import-session', () => ({ createArcgisImportSession: mocks.createArcgisImportSession }));
vi.mock('@/config/connectionmanager', () => ({
  default: { getInstance: () => ({}) }
}));
vi.mock('@/ailogger', () => ({ default: { error: mocks.loggerError } }));

import { POST } from './route';
import { MissingColumnError, UnparseableDateError } from '@/lib/arcgis/errors';
import { PREFLIGHT_STATUS_MAPPING_REQUIRED } from '@/lib/arcgis/types';
import { canonicalFieldsFor } from '@/lib/column-mapping/fields';
import { SourceFormat } from '@/config/macros/formdetails';

const DESCRIBED_SHEETS = [
  { name: 'TreesCustom', columns: ['GlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'MyX', 'MyY', 'When'] },
  { name: 'StemsCustom', columns: ['GlobalID', 'ParentGlobalID', 'TreeTag', 'StemTag', 'Sp', 'Q', 'When'] }
];

// Source column on the DESCRIBED_SHEETS for every required ArcGIS canonical field; the columns
// must exist on the sheet(s) the field's scope demands (lx/ly trees-only, ParentGlobalID stems-only).
const SOURCE_COLUMN_BY_CANONICAL_FIELD: Record<string, string[]> = {
  GlobalID: ['GlobalID'],
  ParentGlobalID: ['ParentGlobalID'],
  quadrat: ['Q'],
  tag: ['TreeTag'],
  StemTag: ['StemTag'],
  spcode: ['Sp'],
  lx: ['MyX'],
  ly: ['MyY'],
  Date_measured: ['When']
};

// A mapping the route's REAL validateMapping accepts against DESCRIBED_SHEETS: built from the
// actual schema registry so a new required field breaks this fixture loudly instead of silently.
function buildValidArcgisMapping() {
  return {
    version: 1 as const,
    format: SourceFormat.arcgis_xlsx,
    fields: canonicalFieldsFor(SourceFormat.arcgis_xlsx).map(def => ({
      canonicalField: def.canonicalField,
      sourceColumns: SOURCE_COLUMN_BY_CANONICAL_FIELD[def.canonicalField] ?? [],
      scope: def.scope
    })),
    sheetRoles: { treesSheetName: 'TreesCustom', stemsSheetName: 'StemsCustom' }
  };
}

// jsdom's File lacks Blob.arrayBuffer(); the route calls it before reading the workbook.
if (typeof File.prototype.arrayBuffer !== 'function') {
  File.prototype.arrayBuffer = async function arrayBuffer(this: File): Promise<ArrayBuffer> {
    return new ArrayBuffer(this.size);
  };
}

function formRequest(fields: Record<string, string>, withFile = true) {
  const fd = new FormData();
  if (withFile) fd.append('file', new File([new Uint8Array([1, 2, 3])], 'x.xlsx'));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const request = new Request('http://t/api/arcgis/preflight', { method: 'POST' });
  // jsdom's Request does not round-trip multipart bodies; stub formData() like the other route tests.
  (request as unknown as { formData: () => Promise<FormData> }).formData = async () => fd;
  return request;
}

describe('POST /api/arcgis/preflight mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSession.mockReturnValue(null);
    mocks.getSessionUserId.mockReturnValue('user-1');
    mocks.isValidSchema.mockReturnValue(true);
    mocks.auth.mockResolvedValue({ user: { email: 'user@example.com' } });
    mocks.readArcgisSheetMetadata.mockResolvedValue(DESCRIBED_SHEETS);
  });

  it('returns mapping_required status when detection fails and no mapping was provided', async () => {
    mocks.readArcgisWorkbookDetailed.mockResolvedValue({ ok: false, error: new MissingColumnError('Trees sheet missing lx, ly.'), sheets: DESCRIBED_SHEETS });

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1' }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('mapping_required');
    expect(body.error).toMatch(/missing/i);
    expect(body.format).toBe('arcgis_xlsx');
    expect(body.sheets).toHaveLength(2);
    expect(body.mapping.fields.length).toBeGreaterThan(0);
    expect(body.validation.missingRequired).toContain('lx');
    expect(mocks.createArcgisImportSession).not.toHaveBeenCalled();
  });

  it('echoes an unsatisfiable client mapping back as mapping_required WITHOUT reading the workbook', async () => {
    // lx alone leaves tag/spcode/quadrat/Date_measured unmappable on these sheets, so the
    // pre-staging validation must intercept before readArcgisWorkbookDetailed ever runs.
    const clientMapping = {
      version: 1,
      format: 'arcgis_xlsx',
      fields: [{ canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'trees' }],
      sheetRoles: { treesSheetName: 'TreesCustom', stemsSheetName: 'StemsCustom' }
    };

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping: JSON.stringify(clientMapping) }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe(PREFLIGHT_STATUS_MAPPING_REQUIRED);
    expect(body.mapping.fields[0].sourceColumns).toEqual(['MyX']);
    expect(body.validation.valid).toBe(false);
    expect(mocks.readArcgisWorkbookDetailed).not.toHaveBeenCalled();
    expect(mocks.createArcgisImportSession).not.toHaveBeenCalled();
  });

  it('passes a provided VALID mapping through real validation into readArcgisWorkbook and stages the session', async () => {
    const mapping = buildValidArcgisMapping();
    mocks.readArcgisWorkbookDetailed.mockResolvedValue({ ok: true, workbook: { trees: [{}], stems: [] } });
    mocks.transformArcgisWorkbook.mockReturnValue({ rows: [{ tag: '100' }], summary: { totalRows: 1 }, warnings: [] });
    mocks.createArcgisImportSession.mockResolvedValue({ importSessionId: 'sess-1' });

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping: JSON.stringify(mapping) }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.importSessionId).toBe('sess-1');
    expect(mocks.createArcgisImportSession).toHaveBeenCalledOnce();
    expect(mocks.readArcgisWorkbookDetailed).toHaveBeenCalledWith(expect.anything(), mapping);
  });

  it('rejects a shape-valid mapping whose format is not arcgis_xlsx with 400', async () => {
    const csvMapping = { version: 1, format: 'csv', fields: [{ canonicalField: 'lx', sourceColumns: ['MyX'], scope: 'file' }] };

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping: JSON.stringify(csvMapping) }) as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/mapping/i);
    expect(mocks.readArcgisWorkbookDetailed).not.toHaveBeenCalled();
    expect(mocks.createArcgisImportSession).not.toHaveBeenCalled();
  });

  it('rejects a mapping naming a canonical field outside the ArcGIS schema with 400', async () => {
    const mapping = { version: 1, format: 'arcgis_xlsx', fields: [{ canonicalField: 'not_a_real_field', sourceColumns: ['X'], scope: 'trees' }] };

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping: JSON.stringify(mapping) }) as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/mapping/i);
    expect(mocks.readArcgisWorkbookDetailed).not.toHaveBeenCalled();
    expect(mocks.createArcgisImportSession).not.toHaveBeenCalled();
  });

  it('returns mapping_required for an otherwise-valid mapping whose header signature no longer matches the workbook', async () => {
    const mapping = { ...buildValidArcgisMapping(), headerSignature: 'v2:something-that-wont-match' };

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping: JSON.stringify(mapping) }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe(PREFLIGHT_STATUS_MAPPING_REQUIRED);
    expect(body.error).toMatch(/does not match/i);
    expect(body.sheets).toHaveLength(2);
    expect(mocks.readArcgisWorkbookDetailed).not.toHaveBeenCalled();
    expect(mocks.createArcgisImportSession).not.toHaveBeenCalled();
  });

  it('rejects an unparseable mapping payload without reading the workbook', async () => {
    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping: '{not json' }) as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/mapping/i);
    expect(mocks.readArcgisWorkbookDetailed).not.toHaveBeenCalled();
  });

  it('rejects well-formed JSON with the wrong mapping shape without reading the workbook', async () => {
    const wrongShapes = ['{"fields":{}}', '[1,2]', '"just a string"', '{"version":1,"format":"arcgis_xlsx","fields":[{"canonicalField":"lx"}]}'];
    for (const mapping of wrongShapes) {
      const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1', mapping }) as any);
      const body = await res.json();
      expect(res.status, `shape ${mapping} must 400`).toBe(400);
      expect(body.error).toMatch(/mapping/i);
    }
    expect(mocks.readArcgisWorkbookDetailed).not.toHaveBeenCalled();
    expect(mocks.loggerError).not.toHaveBeenCalled();
  });

  it('keeps returning a plain error for date parse failures (not a mapping problem)', async () => {
    mocks.readArcgisWorkbookDetailed.mockResolvedValue({ ok: true, workbook: { trees: [{}], stems: [] } });
    mocks.transformArcgisWorkbook.mockImplementation(() => {
      throw new UnparseableDateError('bad date');
    });

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1' }) as any);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.status).toBeUndefined();
    expect(body.error).toBe('bad date');
  });

  it('succeeds without mapping when the workbook matches the default schema (unchanged payload)', async () => {
    mocks.readArcgisWorkbookDetailed.mockResolvedValue({ ok: true, workbook: { trees: [{}], stems: [{}] } });
    mocks.transformArcgisWorkbook.mockReturnValue({ rows: [{ tag: '100' }], summary: { totalRows: 1 }, warnings: [] });
    mocks.createArcgisImportSession.mockResolvedValue({ importSessionId: 'sess-2' });

    const res = await POST(formRequest({ schema: 'forestgeo_testing', plotID: '1', censusID: '1' }) as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.importSessionId).toBe('sess-2');
    expect(body.summary).toEqual({ totalRows: 1 });
    expect(body.status).toBeUndefined();
    expect(mocks.readArcgisWorkbookDetailed).toHaveBeenCalledWith(expect.anything(), undefined);
  });
});
