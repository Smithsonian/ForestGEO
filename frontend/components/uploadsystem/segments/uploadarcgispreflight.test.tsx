import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ArcgisPreflightSummary } from './uploadarcgispreflight';
import type { TransformSummary, TransformWarning } from '@/lib/arcgis/types';

const summary: TransformSummary = {
  treesTransformed: 9958,
  stemsJoined: 1223,
  blankQuadratCount: 199,
  tagMismatchCount: 8,
  orphanStemsDropped: 8,
  totalRows: 11181
};
const warnings: TransformWarning[] = [{ type: 'TAG_MISMATCH', message: 'Stem S1 tag 999 differs from parent tree tag 100; parent tag used.', globalId: 'S1' }];

describe('ArcgisPreflightSummary', () => {
  it('renders the summary counts and warnings', () => {
    render(<ArcgisPreflightSummary summary={summary} warnings={warnings} onProceed={() => {}} />);
    expect(screen.getByText(/11181/)).toBeInTheDocument();
    expect(screen.getByText(/9958/)).toBeInTheDocument();
    expect(screen.getByText(/parent tag used/)).toBeInTheDocument();
  });

  it('fires onProceed when the confirm button is clicked', () => {
    const onProceed = vi.fn();
    render(<ArcgisPreflightSummary summary={summary} warnings={warnings} onProceed={onProceed} />);
    fireEvent.click(screen.getByRole('button', { name: /proceed/i }));
    expect(onProceed).toHaveBeenCalledTimes(1);
  });
});
