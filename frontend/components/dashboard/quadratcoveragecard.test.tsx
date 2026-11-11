import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import QuadratCoverageCard from './quadratcoveragecard';

// The card lists pending quadrat names only up to this many (censusstatsview.tsx:231 at f1f970a6).
const PENDING_NAME_LIST_LIMIT = 12;
const PENDING_LIST_HEADING = 'Quadrats needing measurements:';

function pendingQuadrats(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Q${String(index + 1).padStart(4, '0')}`);
}

describe('QuadratCoverageCard', () => {
  it('shows the coverage percent and the with-data / pending / total chips', () => {
    render(<QuadratCoverageCard total={500} populated={492} percent={98} unpopulated={pendingQuadrats(8)} />);

    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(screen.getByText('492 with data')).toBeInTheDocument();
    expect(screen.getByText('8 pending')).toBeInTheDocument();
    expect(screen.getByText('500 total')).toBeInTheDocument();
  });

  it('lists pending quadrat names when there are at most the list limit', () => {
    const pending = pendingQuadrats(PENDING_NAME_LIST_LIMIT);
    render(<QuadratCoverageCard total={500} populated={488} percent={97} unpopulated={pending} />);

    expect(screen.getByText(PENDING_LIST_HEADING)).toBeInTheDocument();
    for (const quadrat of pending) expect(screen.getByText(quadrat)).toBeInTheDocument();
  });

  it('omits the names once there are more than the list limit', () => {
    render(<QuadratCoverageCard total={500} populated={487} percent={97} unpopulated={pendingQuadrats(PENDING_NAME_LIST_LIMIT + 1)} />);

    expect(screen.queryByText(PENDING_LIST_HEADING)).toBeNull();
  });
});
