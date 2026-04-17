import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import UploadRevisionApply from './uploadrevisionapply';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';
import { RevisionApplyMatchedRow } from '@/config/revisionuploadtypes';

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

  function renderComponent(overrides?: Partial<ComponentProps<typeof UploadRevisionApply>>) {
    return render(
      <UploadRevisionApply
        matchedRows={[]}
        newRows={[]}
        confirmNewRows={false}
        schema="forestgeo_testing"
        setReviewState={setReviewState}
        setIsDataUnsaved={setIsDataUnsaved}
        {...overrides}
      />
    );
  }

  beforeEach(() => {
    fetchMock.mockReset();
    setReviewState.mockReset();
    setIsDataUnsaved.mockReset();
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
        confirmNewRows={false}
        schema="forestgeo_testing"
        setReviewState={setReviewState}
        setIsDataUnsaved={setIsDataUnsaved}
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
