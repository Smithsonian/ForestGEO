import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UploadArcgisPreflight, { ArcgisPreflightSummary } from './uploadarcgispreflight';
import type { TransformSummary, TransformWarning } from '@/lib/arcgis/types';
import { seedMapping } from '@/lib/column-mapping/mapping';
import { SourceFormat } from '@/config/macros/formdetails';

const summary: TransformSummary = {
  treesTransformed: 9958,
  stemsJoined: 1223,
  blankQuadratCount: 199,
  tagMismatchCount: 8,
  orphanStemsEmitted: 8,
  duplicateTreeTags: 4,
  duplicateGlobalIds: 2,
  missingRequired: 5,
  totalRows: 11181
};
const warnings: TransformWarning[] = [
  {
    type: 'TAG_MISMATCH',
    message: 'Stem S1 tag 999 differs from parent tree tag 100; parent tag used.',
    globalId: 'S1',
    sheet: 'stems',
    rowIndex: 0,
    value: '999'
  }
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ArcgisPreflightSummary', () => {
  it('renders the summary counts and warnings', () => {
    render(<ArcgisPreflightSummary summary={summary} warnings={warnings} onProceed={() => {}} />);
    expect(screen.getByText(/11181/)).toBeInTheDocument();
    expect(screen.getByText(/9958/)).toBeInTheDocument();
    expect(screen.getByText(/parent tag used/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate tree tags/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicate GlobalIDs/)).toBeInTheDocument();
    expect(screen.getByText(/Rows missing a required field/)).toBeInTheDocument();
    expect(screen.getByText(/Stems with no matching parent \(emitted\)/)).toBeInTheDocument();
  });

  it('fires onProceed when the confirm button is clicked', () => {
    const onProceed = vi.fn();
    render(<ArcgisPreflightSummary summary={summary} warnings={warnings} onProceed={onProceed} />);
    fireEvent.click(screen.getByRole('button', { name: /proceed/i }));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });

  it('lists the expected workbook columns from the schema help headers', () => {
    render(<ArcgisPreflightSummary summary={summary} warnings={warnings} onProceed={() => {}} />);
    expect(screen.getByText(/Expected columns/)).toBeInTheDocument();
    expect(screen.getByText('GlobalID')).toBeInTheDocument();
    expect(screen.getByText('lx')).toBeInTheDocument();
  });

  it('offers a CSV download control only when there are warnings', () => {
    const createObjectURL = vi.fn(() => 'blob:diagnostics');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    const { rerender } = render(<ArcgisPreflightSummary summary={summary} warnings={warnings} onProceed={() => {}} />);
    const download = screen.getByRole('button', { name: /download diagnostics/i });
    expect(download).toBeInTheDocument();
    fireEvent.click(download);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);

    rerender(<ArcgisPreflightSummary summary={summary} warnings={[]} onProceed={() => {}} />);
    expect(screen.queryByRole('button', { name: /download diagnostics/i })).not.toBeInTheDocument();
  });
});

describe('UploadArcgisPreflight', () => {
  it('creates a server pre-flight session and passes only the import reference forward', async () => {
    const onProceed = vi.fn();
    const onError = vi.fn();
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          importSessionId: 'arcgis-session-1',
          fileName: 'arcgis-export.xlsx',
          rowCount: 11181,
          summary,
          warnings
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['workbook'], 'arcgis-export.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    render(
      <UploadArcgisPreflight
        acceptedFiles={[file]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={onProceed}
        onBack={() => {}}
        onError={onError}
      />
    );

    expect(await screen.findByText(/11181/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/arcgis/preflight', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));

    fireEvent.click(screen.getByRole('button', { name: /proceed/i }));

    expect(onProceed).toHaveBeenCalledWith({
      importSessionId: 'arcgis-session-1',
      fileName: 'arcgis-export.xlsx',
      rowCount: 11181
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('opens the mapping dialog when preflight returns mapping_required and resubmits with the mapping', async () => {
    const onProceed = vi.fn();
    const onError = vi.fn();
    const mappingRequiredSheets = [
      { name: 'TreesCustom', columns: ['GlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'MyX', 'MyY', 'Date_measured'] },
      { name: 'StemsCustom', columns: ['GlobalID', 'ParentGlobalID', 'tag', 'StemTag', 'spcode', 'quadrat', 'Date_measured'] }
    ];
    const mappingRequiredMeta = { format: SourceFormat.arcgis_xlsx, sheets: mappingRequiredSheets };
    const mappingRequiredBody = {
      status: 'mapping_required',
      error: 'Trees sheet missing lx, ly.',
      format: 'arcgis_xlsx',
      sheets: mappingRequiredSheets,
      mapping: seedMapping(mappingRequiredMeta),
      validation: {
        valid: false,
        missingRequired: ['lx', 'ly'],
        missingSourceColumns: [],
        duplicateSourceColumns: [],
        ignoredSourceColumns: [],
        missingSheetRoles: ['trees', 'stems']
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mappingRequiredBody), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ importSessionId: 'arcgis-session-2', fileName: 'arcgis-export.xlsx', rowCount: 1, summary, warnings: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['workbook'], 'arcgis-export.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });

    render(
      <UploadArcgisPreflight
        acceptedFiles={[file]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={onProceed}
        onBack={() => {}}
        onError={onError}
      />
    );

    expect(await screen.findByRole('heading', { name: /map your columns/i })).toBeInTheDocument();
    expect(onProceed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('repopulates the mapping dialog from the SERVER recovery mapping when a resubmission comes back mapping_required, so the next submit carries the corrected signature instead of looping on the stale one', async () => {
    const initialSheets = [
      { name: 'Trees', columns: ['GlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'lx', 'ly', 'Date_measured'] },
      { name: 'Stems', columns: ['GlobalID', 'ParentGlobalID', 'quadrat', 'tag', 'StemTag', 'spcode', 'Date_measured'] }
    ];
    const clientMapping = seedMapping({
      format: SourceFormat.arcgis_xlsx,
      sheets: initialSheets,
      detectedTreesSheet: 'Trees',
      detectedStemsSheet: 'Stems'
    });

    // Stale path: the server rejects the resubmitted mapping and answers with a FRESH seed built
    // from the workbook it actually sees (quadrat column renamed -> different header signature).
    const recoverySheets = [
      { name: 'Trees', columns: ['GlobalID', 'QuadratServer', 'tag', 'StemTag', 'spcode', 'lx', 'ly', 'Date_measured'] },
      { name: 'Stems', columns: ['GlobalID', 'ParentGlobalID', 'QuadratServer', 'tag', 'StemTag', 'spcode', 'Date_measured'] }
    ];
    const recoverySeed = seedMapping({
      format: SourceFormat.arcgis_xlsx,
      sheets: recoverySheets,
      detectedTreesSheet: 'Trees',
      detectedStemsSheet: 'Stems'
    });
    const serverRecoveryMapping = {
      ...recoverySeed,
      fields: recoverySeed.fields.map(f => (f.canonicalField === 'quadrat' ? { ...f, sourceColumns: ['QuadratServer'] } : f))
    };
    expect(serverRecoveryMapping.headerSignature).not.toBe(clientMapping.headerSignature);

    const noFindingsValidation = {
      valid: false,
      missingRequired: [],
      missingSourceColumns: [],
      duplicateSourceColumns: [],
      unknownFields: [],
      ignoredSourceColumns: [],
      missingSheetRoles: []
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'mapping_required',
            error: 'No trees sheet found.',
            format: 'arcgis_xlsx',
            sheets: initialSheets,
            mapping: clientMapping,
            validation: noFindingsValidation
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'mapping_required',
            error: 'The saved column mapping does not match this workbook.',
            format: 'arcgis_xlsx',
            sheets: recoverySheets,
            mapping: serverRecoveryMapping,
            validation: noFindingsValidation
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockReturnValueOnce(new Promise(() => {})); // third preflight stays in flight; only its payload matters
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UploadArcgisPreflight
        acceptedFiles={[new File(['a'], 'a.xlsx')]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );

    expect(await screen.findByRole('heading', { name: /map your columns/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /apply mapping/i })); // resubmit the (now stale) client mapping

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('heading', { name: /map your columns/i })).toBeInTheDocument();

    // The reopened dialog must be seeded from the SERVER's recovery mapping. With the old
    // client-mapping precedence the draft would be invalid against the renamed column (quadrat
    // mapped to a column that no longer exists), Apply would stay disabled, and the user would be
    // stuck in the stale loop forever.
    const apply = screen.getByRole('button', { name: /apply mapping/i });
    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const resubmitBody = fetchMock.mock.calls[2][1].body as FormData;
    const resubmitted = JSON.parse(resubmitBody.get('mapping') as string);
    expect(resubmitted.headerSignature).toBe(serverRecoveryMapping.headerSignature);
    expect(resubmitted.fields.find((f: { canonicalField: string }) => f.canonicalField === 'quadrat')?.sourceColumns).toEqual(['QuadratServer']);
  });

  it('does not re-run preflight when the parent re-renders with new callback identities', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ importSessionId: 's1', fileName: 'arcgis-export.xlsx', rowCount: 11181, summary, warnings: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const files = [new File(['workbook'], 'arcgis-export.xlsx')];

    const { rerender } = render(
      <UploadArcgisPreflight
        acceptedFiles={files}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );
    expect(await screen.findByText(/11181/)).toBeInTheDocument();

    // Parent re-render with fresh inline arrows (uploadparent passes them inline every render).
    rerender(
      <UploadArcgisPreflight
        acceptedFiles={files}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );

    expect(screen.getByText(/11181/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears stale mapping UI when the file selection changes', async () => {
    const clearStaleSheets = [{ name: 'TreesCustom', columns: ['GlobalID'] }];
    const clearStaleMeta = { format: SourceFormat.arcgis_xlsx, sheets: clearStaleSheets };
    const mappingRequiredBody = {
      status: 'mapping_required',
      error: 'Trees sheet missing lx, ly.',
      format: 'arcgis_xlsx',
      sheets: clearStaleSheets,
      mapping: seedMapping(clearStaleMeta),
      validation: {
        valid: false,
        missingRequired: ['lx'],
        missingSourceColumns: [],
        duplicateSourceColumns: [],
        ignoredSourceColumns: [],
        missingSheetRoles: ['trees', 'stems']
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mappingRequiredBody), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockReturnValueOnce(new Promise(() => {})); // second preflight stays in flight
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <UploadArcgisPreflight
        acceptedFiles={[new File(['a'], 'a.xlsx')]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );
    expect(await screen.findByText(/do not match the expected ArcGIS schema/i)).toBeInTheDocument();

    rerender(
      <UploadArcgisPreflight
        acceptedFiles={[new File(['b'], 'b.xlsx')]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );

    // File A's mapping UI must not survive into file B's in-flight preflight.
    expect(screen.queryByText(/do not match the expected ArcGIS schema/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /map your columns/i })).not.toBeInTheDocument();
    expect(screen.getByText(/preparing the arcgis workbook pre-flight/i)).toBeInTheDocument();
  });

  it('surfaces the server rejection message in the mapping flow instead of discarding it', async () => {
    const surfaceSheets = [{ name: 'TreesCustom', columns: ['GlobalID'] }];
    const surfaceMeta = { format: SourceFormat.arcgis_xlsx, sheets: surfaceSheets };
    const mappingRequiredBody = {
      status: 'mapping_required',
      error: 'Trees sheet "TreesCustom" is missing required column(s): lx.',
      format: 'arcgis_xlsx',
      sheets: surfaceSheets,
      mapping: seedMapping(surfaceMeta),
      validation: {
        valid: false,
        missingRequired: ['lx'],
        missingSourceColumns: [],
        duplicateSourceColumns: [],
        ignoredSourceColumns: [],
        missingSheetRoles: ['trees', 'stems']
      }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(mappingRequiredBody), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <UploadArcgisPreflight
        acceptedFiles={[new File(['a'], 'a.xlsx')]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );

    expect(await screen.findAllByText(/Trees sheet "TreesCustom" is missing required column\(s\): lx\./)).not.toHaveLength(0);
  });

  it('ignores a superseded preflight response that resolves after the file changed', async () => {
    let resolveFirst: (response: Response) => void = () => {};
    const firstResponse = new Promise<Response>(resolve => {
      resolveFirst = resolve;
    });
    const secondSummary = { ...summary, totalRows: 222 };
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ importSessionId: 'session-b', fileName: 'b.xlsx', rowCount: 222, summary: secondSummary, warnings: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <UploadArcgisPreflight
        acceptedFiles={[new File(['a'], 'a.xlsx')]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );

    rerender(
      <UploadArcgisPreflight
        acceptedFiles={[new File(['b'], 'b.xlsx')]}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        onProceed={() => {}}
        onBack={() => {}}
        onError={() => {}}
      />
    );
    expect(await screen.findByText(/222/)).toBeInTheDocument();

    // File A's stale response lands last; it must not clobber file B's staged session.
    resolveFirst(
      new Response(JSON.stringify({ importSessionId: 'session-a', fileName: 'a.xlsx', rowCount: 111, summary: { ...summary, totalRows: 111 }, warnings: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    await waitFor(() => expect(screen.queryByText(/111/)).not.toBeInTheDocument());
    expect(screen.getByText(/222/)).toBeInTheDocument();
  });

  it('shows a recoverable file-selection error for multiple workbooks', async () => {
    const onBack = vi.fn();
    const onError = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const files = [
      new File(['one'], 'one.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      new File(['two'], 'two.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    ];

    render(
      <UploadArcgisPreflight acceptedFiles={files} schema="forestgeo_testing" plotID={1} censusID={2} onProceed={() => {}} onBack={onBack} onError={onError} />
    );

    expect(await screen.findByText(/accepts exactly one workbook/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back to file selection/i }));

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
