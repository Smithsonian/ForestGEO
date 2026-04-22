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

  function renderComponent(overrides?: Partial<ComponentProps<typeof UploadRevisionApply>>) {
    return render(
      <UploadRevisionApply
        matchedRows={[]}
        newRows={[]}
        invalidRows={[]}
        confirmNewRows={false}
        schema="forestgeo_testing"
        bulkPlanHash="plan-hash-test"
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

  it('returns to review with the fresh plan on a 409 drift response', async () => {
    const freshPlan: BulkEditPlan = {
      dataType: 'measurementssummary',
      rowCount: 1,
      rowPlans: [],
      aggregateEffects: [],
      maxSeverity: 'warn',
      planHash: 'fresh-hash',
      generatedAt: '2026-04-21T00:00:00Z'
    };
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'plan hash mismatch', freshPlan })
    });

    renderComponent();

    await waitFor(() => {
      expect(onPlanConflict).toHaveBeenCalledWith(freshPlan);
      expect(setReviewState).toHaveBeenCalledWith(ReviewStates.REVISION_MATCH);
    });
    expect(screen.queryByText('Failed to Apply Revisions')).not.toBeInTheDocument();
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
});
