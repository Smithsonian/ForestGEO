import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadRevisionMatch from './uploadrevisionmatch';
import { EMPTY_REVISION_MATCH_COUNTS, RevisionMatchedRow, RevisionNewRowCandidate } from '@/config/revisionuploadtypes';
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

  it('surfaces a warning in the New Rows tab when a supplied stemid did not match any measurement in the census', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const newRows: RevisionNewRowCandidate[] = [
      {
        csvRow: { stemid: '9999999', tag: 'TREE-X', stemtag: '1', spcode: 'quas', quadrat: '01', lx: '1', ly: '1', dbh: '12.3', date: '2026-04-14' },
        csvIndex: 0,
        reason: 'stemid-not-found'
      },
      {
        csvRow: { tag: 'TREE-Y', stemtag: '1', spcode: 'quas', quadrat: '01', lx: '2', ly: '2', dbh: '8.1', date: '2026-04-14' },
        csvIndex: 1,
        reason: 'no-match-key-in-db'
      }
    ];

    render(
      <UploadRevisionMatch
        matchedRows={[]}
        newRows={newRows}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, new: 2, total: 2 }}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'New Rows (2)' }));

    expect(screen.getByText(/1 row supplied a stemid that was not found in this census/)).toBeInTheDocument();
    expect(screen.getByText(/stemid 9999999 not found/)).toBeInTheDocument();
    expect(screen.getByText(/no match in census/)).toBeInTheDocument();
  });

  it('surfaces ignored edits with a summary chip, alert, and dedicated tab so non-updatable column edits are not silently dropped', async () => {
    const onApply = vi.fn();
    const handleReturnToStart = vi.fn(async () => undefined);
    const setReviewState = vi.fn<(state: ReviewStates) => void>();
    const matchedRows: RevisionMatchedRow[] = [
      {
        coreMeasurementID: 700,
        csvRow: { stemid: '5283365', spcode: 'AAAAAA', ly: '1111' },
        existingValues: {
          measuredDBH: 44.0,
          measuredHOM: 1.3,
          measurementDate: '2026-03-14',
          rawCodes: 'Q;L',
          description: 'Broken and leaning'
        },
        changes: {},
        ignoredEdits: {
          spcode: { from: 'SLOATE', to: 'AAAAAA' },
          ly: { from: 2.4, to: '1111' }
        }
      }
    ];

    render(
      <UploadRevisionMatch
        matchedRows={matchedRows}
        newRows={[]}
        invalidRows={[]}
        counts={{ ...EMPTY_REVISION_MATCH_COUNTS, matched: 1, total: 1 }}
        schema="forestgeo_testing"
        plotID={1}
        censusID={2}
        setReviewState={setReviewState}
        onApply={onApply}
        handleReturnToStart={handleReturnToStart}
      />
    );

    expect(screen.getByText('1 row with ignored edits')).toBeInTheDocument();
    expect(screen.getByText(/edits on columns that revision upload cannot update/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Ignored Edits (1)' }));

    const ignoredTab = screen.getByRole('tabpanel', { name: 'Ignored Edits (1)' });
    expect(within(ignoredTab).getByText('spcode')).toBeInTheDocument();
    expect(within(ignoredTab).getByText('SLOATE')).toBeInTheDocument();
    expect(within(ignoredTab).getByText('AAAAAA')).toBeInTheDocument();
    expect(within(ignoredTab).getByText('ly')).toBeInTheDocument();
    expect(within(ignoredTab).getByText('1111')).toBeInTheDocument();
  });
});
