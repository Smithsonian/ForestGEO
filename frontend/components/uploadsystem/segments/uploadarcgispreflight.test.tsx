import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UploadArcgisPreflight, { ArcgisPreflightSummary } from './uploadarcgispreflight';
import type { TransformSummary, TransformWarning } from '@/lib/arcgis/types';

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
