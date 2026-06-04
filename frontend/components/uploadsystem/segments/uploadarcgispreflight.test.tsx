import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArcgisPreflightSummary } from './uploadarcgispreflight';
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
