import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import UploadRevisionApply from './uploadrevisionapply';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { RevisionApplyMatchedRow } from '@/config/revisionuploadtypes';
import { BulkEditPlan } from '@/config/editplan/types';

const startValidation = vi.fn();

vi.mock('@/app/contexts/compat-hooks', () => ({
  usePlotContext: () => ({ plotID: 1 }),
  useOrgCensusContext: () => ({ dateRanges: [{ censusID: 2 }] })
}));

vi.mock('@/app/hooks/usebackgroundvalidation', () => ({
  useBackgroundValidation: () => ({ startValidation })
}));

describe('UploadRevisionApply', () => {
  const fetchMock = vi.fn();
  const setReviewState = vi.fn();
  const setIsDataUnsaved = vi.fn();
  const onPlanConflict = vi.fn();

  const DEFAULT_UPLOAD_ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
  const DEFAULT_INVALID_ROWS_INTEGRITY_HASH = 'a'.repeat(64);

  function renderComponent(overrides?: Partial<ComponentProps<typeof UploadRevisionApply>>) {
    return render(
      <UploadRevisionApply
        matchedRows={[]}
        newRows={[]}
        invalidRows={[]}
        confirmNewRows={false}
        schema="forestgeo_testing"
        bulkPlanHash="plan-hash-test"
        uploadAttemptID={DEFAULT_UPLOAD_ATTEMPT_ID}
        invalidRowsIntegrityHash={DEFAULT_INVALID_ROWS_INTEGRITY_HASH}
        setReviewState={setReviewState}
        setIsDataUnsaved={setIsDataUnsaved}
        onPlanConflict={onPlanConflict}
        {...overrides}
      />
    );
  }

  beforeEach(() => {
    fetchMock.mockReset();
    setReviewState.mockReset();
    setIsDataUnsaved.mockReset();
    onPlanConflict.mockReset();
    startValidation.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends duplicate deletion hints with the apply request', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(() => {
          // Keep the request in flight so no success timeout is scheduled.
        })
    );

    const matchedRows: RevisionApplyMatchedRow[] = [
      {
        coreMeasurementID: 101,
        csvRow: { dbh: '12.3' },
        duplicateMeasurementIDsToDelete: [55, 56]
      }
    ];

    const { unmount } = renderComponent({ matchedRows });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));
    expect(requestBody.duplicateMeasurementIDsToDelete).toEqual([
      { coreMeasurementID: 55, survivorCoreMeasurementID: 101 },
      { coreMeasurementID: 56, survivorCoreMeasurementID: 101 }
    ]);
    expect(requestBody.bulkPlanHash).toBe('plan-hash-test');

    unmount();
  });

  // #505: the apply request must echo back the exact uploadAttemptID/
  // invalidRowsIntegrityHash the match endpoint minted — the apply route
  // 400s on a missing/malformed uploadAttemptID and 409s on a hash mismatch
  // (see apply/route.ts and apply/route.test.ts), so a client that silently
  // dropped either field would turn every apply into an error.
  it('echoes uploadAttemptID and invalidRowsIntegrityHash from props unchanged in the apply request', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(() => {
          // Keep the request in flight so no success timeout is scheduled.
        })
    );

    const { unmount } = renderComponent({
      uploadAttemptID: '22222222-2222-4222-9222-222222222222',
      invalidRowsIntegrityHash: 'b'.repeat(64)
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const requestBody = JSON.parse(String(requestInit.body));
    expect(requestBody.uploadAttemptID).toBe('22222222-2222-4222-9222-222222222222');
    expect(requestBody.invalidRowsIntegrityHash).toBe('b'.repeat(64));

    unmount();
  });

  it('does not resubmit apply while the same attempt is already in flight', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(() => {
          // Leave the request in flight to keep the component in applying state.
        })
    );

    const initialMatchedRows: RevisionApplyMatchedRow[] = [{ coreMeasurementID: 101, csvRow: { dbh: '12.3' } }];
    const { rerender, unmount } = renderComponent({ matchedRows: initialMatchedRows, newRows: [] });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    rerender(
      <UploadRevisionApply
        matchedRows={[{ coreMeasurementID: 101, csvRow: { dbh: '12.3' } }]}
        newRows={[]}
        invalidRows={[]}
        confirmNewRows={false}
        schema="forestgeo_testing"
        bulkPlanHash="plan-hash-test"
        uploadAttemptID={DEFAULT_UPLOAD_ATTEMPT_ID}
        invalidRowsIntegrityHash={DEFAULT_INVALID_ROWS_INTEGRITY_HASH}
        setReviewState={setReviewState}
        setIsDataUnsaved={setIsDataUnsaved}
        onPlanConflict={onPlanConflict}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    unmount();
  });

  it('shows recovery actions on apply error and allows retrying', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Apply conflict' })
    });

    renderComponent();

    await screen.findByText('Failed to Apply Revisions');
    expect(screen.getByText('Apply conflict')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Back to Review' }));
    expect(setReviewState).toHaveBeenCalledWith(ReviewStates.REVISION_MATCH);

    await user.click(screen.getByRole('button', { name: 'Retry Apply' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it('returns to review with the fresh plan AND the authoritative freshInvalidRows/freshInvalidRowsIntegrityHash on a 409 drift response', async () => {
    const freshPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [],
      aggregateEffects: [],
      maxSeverity: 'warn',
      planHash: 'fresh-hash',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: []
    };
    const freshInvalidRows = [{ csvRow: { tag: 'T1' }, csvIndex: 3, reason: 'Quadrat 999 was not found in this plot/census' }];
    const freshInvalidRowsIntegrityHash = 'c'.repeat(64);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'plan hash mismatch', freshPlan, freshInvalidRows, freshInvalidRowsIntegrityHash })
    });

    renderComponent();

    await waitFor(() => {
      expect(onPlanConflict).toHaveBeenCalledWith(freshPlan, freshInvalidRows, freshInvalidRowsIntegrityHash);
      expect(setReviewState).toHaveBeenCalledWith(ReviewStates.REVISION_MATCH);
    });
    expect(screen.queryByText('Failed to Apply Revisions')).not.toBeInTheDocument();
  });

  // #505: a 409 body that is missing the authoritative freshInvalidRows/
  // freshInvalidRowsIntegrityHash pair must NOT be treated as a recoverable
  // plan conflict — silently falling back to freshPlan alone would leave the
  // UI holding a stale invalidRows set/hash that the next apply would 409 on
  // forever (see #505 review round 2, finding 2).
  it('falls back to the generic error path when a 409 response omits freshInvalidRows/freshInvalidRowsIntegrityHash', async () => {
    const freshPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [],
      aggregateEffects: [],
      maxSeverity: 'warn',
      planHash: 'fresh-hash',
      generatedAt: '2026-04-21T00:00:00Z',
      duplicateDeletions: []
    };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'plan hash mismatch', freshPlan })
    });

    renderComponent();

    await screen.findByText('Failed to Apply Revisions');
    expect(onPlanConflict).not.toHaveBeenCalled();
    expect(setReviewState).not.toHaveBeenCalledWith(ReviewStates.REVISION_MATCH);
  });

  it('reports duplicate cleanup separately from field updates on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updatedCount: 0,
        skippedCount: 1,
        insertedCount: 0,
        deletedDuplicateCount: 2,
        applyErrors: [],
        validationPending: true
      })
    });

    renderComponent({
      matchedRows: [
        {
          coreMeasurementID: 101,
          csvRow: {},
          duplicateMeasurementIDsToDelete: [55, 56]
        }
      ]
    });

    await screen.findByText('Revisions Applied');
    expect(screen.getByText('2 duplicate(s) deleted')).toBeInTheDocument();
    expect(screen.getByText('1 matched row(s) required no field updates')).toBeInTheDocument();
    expect(screen.getByText('Duplicate cleanup can still use a matched survivor row even when its field values were unchanged.')).toBeInTheDocument();
    expect(screen.queryByText('1 row(s) skipped (no changes)')).not.toBeInTheDocument();
  });

  // #505: rows the server rejected (exact duplicates, review-rejected rows) are now
  // persisted as StemGUID=NULL failed measurements rather than vanishing silently.
  // The success summary must surface that count so the uploader can find them.
  it('surfaces failedRowCount from the apply response as a rejected-row summary line', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updatedCount: 1,
        skippedCount: 0,
        insertedCount: 0,
        deletedDuplicateCount: 0,
        failedRowCount: 3,
        applyErrors: [],
        validationPending: true
      })
    });

    renderComponent({
      matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.3' } }],
      invalidRows: [
        { csvRow: { tag: 'T1', stemtag: 'S1' }, csvIndex: 5, reason: 'Duplicate of row 1 (same stem key)' },
        { csvRow: { tag: 'T2', stemtag: 'S1' }, csvIndex: 6, reason: 'Duplicate of row 1 (same stem key)' },
        { csvRow: {}, csvIndex: 7, reason: 'Missing required field: tag' }
      ]
    });

    await screen.findByText('Revisions Applied');
    expect(screen.getByTestId('revision-apply-failed-count')).toHaveTextContent('3 rejected row(s) recorded as failed measurements');
  });

  it('omits the rejected-row summary line when failedRowCount is zero', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        updatedCount: 1,
        skippedCount: 0,
        insertedCount: 0,
        deletedDuplicateCount: 0,
        failedRowCount: 0,
        applyErrors: [],
        validationPending: true
      })
    });

    renderComponent({ matchedRows: [{ coreMeasurementID: 101, csvRow: { dbh: '12.3' } }] });

    await screen.findByText('Revisions Applied');
    expect(screen.queryByTestId('revision-apply-failed-count')).not.toBeInTheDocument();
  });
});
