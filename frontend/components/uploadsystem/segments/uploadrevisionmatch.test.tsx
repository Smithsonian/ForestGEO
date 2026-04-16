import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadRevisionMatch from './uploadrevisionmatch';
import { EMPTY_REVISION_MATCH_COUNTS, RevisionMatchedRow } from '@/config/revisionuploadtypes';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';

describe('UploadRevisionMatch', () => {
  it('treats duplicate-only survivor rows as actionable revisions', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const matchedRows: RevisionMatchedRow[] = [
      {
        coreMeasurementID: 101,
        csvRow: {},
        duplicateMeasurementIDsToDelete: [55, 56],
        existingValues: {
          measuredDBH: 10.2,
          measuredHOM: 1.3,
          measurementDate: '2025-01-01',
          rawCodes: null,
          description: null
        },
        changes: {}
      }
    ];

    render(
      <UploadRevisionMatch
        matchedRows={matchedRows}
        newRows={[]}
        invalidRows={[]}
        counts={EMPTY_REVISION_MATCH_COUNTS}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    expect(screen.getByText('1 rows to deduplicate')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Duplicate Cleanup (1)' })).toBeInTheDocument();

    const applyButton = screen.getByRole('button', { name: 'Apply 1 Revisions' });
    expect(applyButton).toBeEnabled();

    const user = userEvent.setup();
    await user.click(applyButton);

    expect(onApply).toHaveBeenCalledWith(false);
  });
});
