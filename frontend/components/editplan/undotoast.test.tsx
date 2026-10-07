import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UndoToast, { UndoRevertOutcome } from './undotoast';
import { EditPlan } from '@/config/editplan/types';
import { UNCONFIRMED_OUTCOME_MESSAGE } from '@/lib/editplan/requestrevert';
import ailogger from '@/ailogger';

vi.mock('@/ailogger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const EDIT_OPERATION_ID = 42;
const OTHER_EDIT_OPERATION_ID = 99;
const PLAN_HASH_A = 'a'.repeat(64);
const PLAN_HASH_B = 'b'.repeat(64);

function makePlan(overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    dataType: overrides.dataType ?? 'measurementssummary',
    targetID: overrides.targetID ?? 7,
    fieldChanges: overrides.fieldChanges ?? [{ field: 'MeasuredDBH', from: 10, to: 12 }],
    effects: overrides.effects ?? [],
    errors: overrides.errors,
    canApply: overrides.canApply,
    maxSeverity: overrides.maxSeverity ?? 'warn',
    planHash: overrides.planHash ?? PLAN_HASH_A,
    generatedAt: overrides.generatedAt ?? '2026-04-20T12:00:00Z'
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

// Used to simulate onUndo() itself throwing (real-work failure: HTTP, query
// invalidation, refetch) as opposed to resolving with a parsed
// UndoRevertOutcome like `{ status: 'failed' }`.
function createRejectingDeferred<T>() {
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((_resolve, rej) => {
    reject = rej;
  });
  return { promise, reject };
}

type OnUndoMock = ReturnType<typeof vi.fn<(confirmedPlanHash?: string) => Promise<UndoRevertOutcome>>>;

function makeOnUndoMock(): OnUndoMock {
  return vi.fn<(confirmedPlanHash?: string) => Promise<UndoRevertOutcome>>();
}

describe('UndoToast', () => {
  let onDismiss: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onDismiss = vi.fn();
    vi.mocked(ailogger.error).mockClear();
  });

  it('on the first confirmation-required outcome, opens the preview without a second request and without dismissing', async () => {
    const freshPlan = makePlan({ targetID: 7, maxSeverity: 'warn' });
    const onUndo = makeOnUndoMock().mockResolvedValue({ status: 'confirmation-required', freshPlan });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));

    expect(screen.getByText(/Review changes.*Measurement #7/)).toBeInTheDocument();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('confirming the preview re-requests onUndo with the fresh plan hash', async () => {
    const freshPlan = makePlan({ targetID: 7, maxSeverity: 'warn', planHash: PLAN_HASH_A });
    const onUndo = makeOnUndoMock().mockResolvedValueOnce({ status: 'confirmation-required', freshPlan }).mockResolvedValueOnce({ status: 'reverted' });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));
    await user.click(screen.getByTestId('edit-preview-apply'));

    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(onUndo).toHaveBeenNthCalledWith(1);
    expect(onUndo).toHaveBeenNthCalledWith(2, PLAN_HASH_A);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('on a second confirmation-required (drift), replaces the preview with the newer plan and requires reconfirmation rather than auto-applying', async () => {
    const firstFreshPlan = makePlan({ targetID: 7, maxSeverity: 'destructive', planHash: PLAN_HASH_A, effects: [] });
    const secondFreshPlan = makePlan({ targetID: 8, maxSeverity: 'destructive', planHash: PLAN_HASH_B, effects: [] });
    const onUndo = makeOnUndoMock()
      .mockResolvedValueOnce({ status: 'confirmation-required', freshPlan: firstFreshPlan })
      .mockResolvedValueOnce({ status: 'confirmation-required', freshPlan: secondFreshPlan });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));
    expect(screen.getByText(/Measurement #7/)).toBeInTheDocument();

    // firstFreshPlan is destructive: the typed-confirm gate must be satisfied
    // before Apply is even clickable (symmetric with previewdialog.test.tsx).
    await user.type(screen.getByTestId('edit-preview-typed-confirm-input'), 'APPLY');
    await user.click(screen.getByTestId('edit-preview-apply'));

    // The preview now reflects targetID 8 (the drifted plan), not the original 7.
    expect(screen.getByText(/Measurement #8/)).toBeInTheDocument();
    expect(screen.getByTestId('edit-preview-refreshed-banner')).toBeInTheDocument();
    // Destructive severity + drift replay resets the typed-confirm box, so Apply
    // is disabled again: the component must not have auto-confirmed a third time.
    expect(screen.getByTestId('edit-preview-apply')).toBeDisabled();
    // The user-visible invariant, not just the button state: the typed
    // "APPLY" from before the drift must actually be gone from the input,
    // not merely overridden by some other disabling condition.
    expect(screen.getByTestId('edit-preview-typed-confirm-input')).toHaveValue('');
    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('cannot apply a canApply:false plan: Apply is disabled and no second onUndo call is made', async () => {
    const blockedPlan = makePlan({
      targetID: 7,
      canApply: false,
      maxSeverity: 'destructive',
      errors: [
        {
          kind: 'RoleForbiddenField',
          field: 'SpeciesCode',
          role: 'field crew',
          message: 'SpeciesCode can only be edited by global or db admin users.',
          severity: 'destructive',
          blocking: true
        }
      ]
    });
    const onUndo = makeOnUndoMock().mockResolvedValue({ status: 'confirmation-required', freshPlan: blockedPlan });
    const user = userEvent.setup({ pointerEventsCheck: 0 });

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));

    const applyButton = screen.getByTestId('edit-preview-apply');
    expect(applyButton).toBeDisabled();
    await user.click(applyButton);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('on a hard failure outcome, dismisses exactly once and renders no success or raw server-error text', async () => {
    const onUndo = makeOnUndoMock().mockResolvedValue({ status: 'failed' });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));

    // Dismissal is verified via the onDismiss contract, not DOM removal: Joy's
    // Snackbar keeps the element mounted for its own exit animation after
    // open flips false, which is an implementation detail of that component.
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/revert failed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mismatch/i)).not.toBeInTheDocument();
  });

  it('cancelling the preview sends no further request and leaves the toast open', async () => {
    const freshPlan = makePlan({ targetID: 7, maxSeverity: 'warn' });
    const onUndo = makeOnUndoMock().mockResolvedValue({ status: 'confirmation-required', freshPlan });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));
    await user.click(screen.getByTestId('edit-preview-cancel'));

    expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId(`undo-toast-${EDIT_OPERATION_ID}`)).toBeInTheDocument();
  });

  it('on a direct success (no confirmation needed), dismisses exactly once', async () => {
    const onUndo = makeOnUndoMock().mockResolvedValue({ status: 'reverted' });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pauses auto-dismiss while a request is pending or the preview is open, then resumes and dismisses after cancel', async () => {
    vi.useFakeTimers();
    try {
      const timeoutMs = 1000;
      const deferred = createDeferred<UndoRevertOutcome>();
      const freshPlan = makePlan({ targetID: 7, maxSeverity: 'warn' });
      const onUndo = makeOnUndoMock().mockReturnValueOnce(deferred.promise);

      render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} timeoutMs={timeoutMs} />);

      fireEvent.click(screen.getByTestId('undo-toast-undo'));

      // Pending request: the auto-dismiss timer must not even be armed.
      await act(async () => {
        vi.advanceTimersByTime(timeoutMs * 5);
      });
      expect(screen.getByTestId(`undo-toast-${EDIT_OPERATION_ID}`)).toBeInTheDocument();
      expect(onDismiss).not.toHaveBeenCalled();

      await act(async () => {
        deferred.resolve({ status: 'confirmation-required', freshPlan });
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId('edit-preview-apply')).toBeInTheDocument();

      // Preview open: still must not auto-dismiss.
      await act(async () => {
        vi.advanceTimersByTime(timeoutMs * 5);
      });
      expect(screen.getByTestId(`undo-toast-${EDIT_OPERATION_ID}`)).toBeInTheDocument();
      expect(onDismiss).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId('edit-preview-cancel'));

      // Just under the full timeout after resuming: still open.
      await act(async () => {
        vi.advanceTimersByTime(timeoutMs - 1);
      });
      expect(screen.getByTestId(`undo-toast-${EDIT_OPERATION_ID}`)).toBeInTheDocument();
      expect(onDismiss).not.toHaveBeenCalled();

      // Past the full timeout: the resumed timer fires exactly once. (DOM
      // removal is not asserted here: Joy's Snackbar runs its own exit
      // animation timer after `open` flips false, which is independent of
      // this component's auto-dismiss timer under test.)
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      expect(onDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('double-clicking Undo before the first response resolves issues only one onUndo call', async () => {
    const deferred = createDeferred<UndoRevertOutcome>();
    const onUndo = makeOnUndoMock().mockReturnValue(deferred.promise);

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    const undoButton = screen.getByTestId('undo-toast-undo');

    fireEvent.click(undoButton);
    fireEvent.click(undoButton);

    expect(onUndo).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({ status: 'reverted' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores a late resolution after the component has unmounted: no dismiss, no thrown error', async () => {
    const deferred = createDeferred<UndoRevertOutcome>();
    const onUndo = makeOnUndoMock().mockReturnValue(deferred.promise);

    const { unmount } = render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('undo-toast-undo'));
    unmount();

    await act(async () => {
      deferred.resolve({ status: 'reverted' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores a late resolution bound to a prior editOperationID after the prop changes, and the new operation remains fully usable', async () => {
    const deferred = createDeferred<UndoRevertOutcome>();
    const freshPlanForStaleOp = makePlan({ targetID: 7 });
    const onUndo = makeOnUndoMock();
    onUndo.mockReturnValueOnce(deferred.promise);
    onUndo.mockResolvedValueOnce({ status: 'reverted' });

    const { rerender } = render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('undo-toast-undo'));

    // The parent swaps in a toast for a different edit operation before the
    // first revert request for EDIT_OPERATION_ID resolves.
    rerender(<UndoToast editOperationID={OTHER_EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    expect(screen.getByTestId(`undo-toast-${OTHER_EDIT_OPERATION_ID}`)).toBeInTheDocument();

    await act(async () => {
      deferred.resolve({ status: 'confirmation-required', freshPlan: freshPlanForStaleOp });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale confirmation-required must not open a preview nor dismiss the
    // toast now bound to the new operation.
    expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId(`undo-toast-${OTHER_EDIT_OPERATION_ID}`)).toBeInTheDocument();

    // The new operation's own Undo click must still work (not stuck pending).
    fireEvent.click(screen.getByTestId('undo-toast-undo'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('when the initial onUndo call rejects, logs the error, shows the unconfirmed-outcome message (the rejection may follow a server-side commit, so it must not claim the undo failed), does not dismiss, re-enables Undo, and a user-initiated retry still works', async () => {
    const rejectionError = new Error('network dropped mid-request');
    const onUndo = makeOnUndoMock();
    onUndo.mockRejectedValueOnce(rejectionError);
    onUndo.mockResolvedValueOnce({ status: 'reverted' });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    const undoButton = screen.getByTestId('undo-toast-undo');
    await user.click(undoButton);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('undo-toast-unexpected-error')).toHaveTextContent(UNCONFIRMED_OUTCOME_MESSAGE);
    expect(screen.queryByText(/could not be completed/i)).not.toBeInTheDocument();
    expect(undoButton).not.toBeDisabled();
    expect(ailogger.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ailogger.error).mock.calls[0][0]).toMatch(/onUndo rejected unexpectedly/);
    expect(vi.mocked(ailogger.error).mock.calls[0][1]).toBe(rejectionError);

    // The button must not be stuck busy/pending: a second, user-initiated
    // click issues a second real onUndo call.
    await user.click(undoButton);
    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('undo-toast-unexpected-error')).not.toBeInTheDocument();
  });

  it('when onUndo rejects with a non-Error value (a thrown string), still normalizes and logs it with the original content preserved, and the visible error / no-dismiss behaviour is unchanged', async () => {
    const thrownString = 'revert endpoint returned a non-JSON body';
    const onUndo = makeOnUndoMock();
    onUndo.mockRejectedValueOnce(thrownString);
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId('undo-toast-unexpected-error')).toHaveTextContent(UNCONFIRMED_OUTCOME_MESSAGE);
    expect(ailogger.error).toHaveBeenCalledTimes(1);
    const loggedError = vi.mocked(ailogger.error).mock.calls[0][1];
    // The second arg must be a real Error (ailogger.error's signature requires
    // one) with the thrown value's content preserved, not silently dropped.
    expect(loggedError).toBeInstanceOf(Error);
    expect((loggedError as Error).message).toContain(thrownString);
  });

  it('when onUndo rejects during preview confirmation, closes the preview, shows the unconfirmed-outcome message without claiming success or failure, does not dismiss, and a following Undo click still works', async () => {
    const freshPlan = makePlan({ targetID: 7, maxSeverity: 'warn' });
    const rejectionError = new Error('query invalidation threw after revert committed');
    const onUndo = makeOnUndoMock();
    onUndo.mockResolvedValueOnce({ status: 'confirmation-required', freshPlan });
    onUndo.mockRejectedValueOnce(rejectionError);
    onUndo.mockResolvedValueOnce({ status: 'reverted' });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));
    await user.click(screen.getByTestId('edit-preview-apply'));

    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument();
    expect(screen.getByTestId('undo-toast-unexpected-error')).toHaveTextContent(UNCONFIRMED_OUTCOME_MESSAGE);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByText(/reverted/i)).not.toBeInTheDocument();
    expect(ailogger.error).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('undo-toast-undo'));
    expect(onUndo).toHaveBeenCalledTimes(3);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('on an unconfirmed outcome, dismisses exactly once and renders neither the unexpected-error message nor any success/preview UI, since the call site owns that copy', async () => {
    const onUndo = makeOnUndoMock().mockResolvedValue({ status: 'unconfirmed' });
    const user = userEvent.setup();

    render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    await user.click(screen.getByTestId('undo-toast-undo'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('edit-preview-apply')).not.toBeInTheDocument();
    expect(screen.queryByTestId('undo-toast-unexpected-error')).not.toBeInTheDocument();
    expect(screen.queryByText(/reverted/i)).not.toBeInTheDocument();
  });

  it('suppresses auto-dismiss while the unexpected-error message is shown, even well past the default timeout', async () => {
    vi.useFakeTimers();
    try {
      const timeoutMs = 1000;
      const rejectionError = new Error('fetch failed');
      const onUndo = makeOnUndoMock().mockRejectedValueOnce(rejectionError);

      render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} timeoutMs={timeoutMs} />);
      fireEvent.click(screen.getByTestId('undo-toast-undo'));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId('undo-toast-unexpected-error')).toBeInTheDocument();

      // Well past the default auto-dismiss timeout: the error must still be
      // the only thing on screen, with no silent dismissal.
      await act(async () => {
        vi.advanceTimersByTime(timeoutMs * 10);
      });

      expect(onDismiss).not.toHaveBeenCalled();
      expect(screen.getByTestId('undo-toast-unexpected-error')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a late rejection after the component has unmounted: no dismiss, no React state-update warning, nothing thrown, but the rejection is still logged', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deferred = createRejectingDeferred<UndoRevertOutcome>();
    const onUndo = makeOnUndoMock().mockReturnValue(deferred.promise);

    const { unmount } = render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('undo-toast-undo'));
    unmount();

    await act(async () => {
      deferred.reject(new Error('late failure after unmount'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDismiss).not.toHaveBeenCalled();
    expect(ailogger.error).toHaveBeenCalledTimes(1);
    const stateUpdateWarning = consoleErrorSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].includes('unmounted component'));
    expect(stateUpdateWarning).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it('ignores a late rejection bound to a prior editOperationID after the prop changes: no error message or dismiss is attributed to the new operation, which remains fully usable', async () => {
    const deferred = createRejectingDeferred<UndoRevertOutcome>();
    const onUndo = makeOnUndoMock();
    onUndo.mockReturnValueOnce(deferred.promise);
    onUndo.mockResolvedValueOnce({ status: 'reverted' });

    const { rerender } = render(<UndoToast editOperationID={EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('undo-toast-undo'));

    // The parent swaps in a toast for a different edit operation before the
    // first (stale) revert request for EDIT_OPERATION_ID rejects.
    rerender(<UndoToast editOperationID={OTHER_EDIT_OPERATION_ID} onUndo={onUndo} onDismiss={onDismiss} />);
    expect(screen.getByTestId(`undo-toast-${OTHER_EDIT_OPERATION_ID}`)).toBeInTheDocument();

    await act(async () => {
      deferred.reject(new Error('stale rejection for prior operation'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The stale rejection must not surface its error message nor dismiss the
    // toast now bound to the new operation (but it is still logged).
    expect(screen.queryByTestId('undo-toast-unexpected-error')).not.toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId(`undo-toast-${OTHER_EDIT_OPERATION_ID}`)).toBeInTheDocument();
    expect(ailogger.error).toHaveBeenCalledTimes(1);

    // The new operation's own Undo click must still work (not stuck pending).
    fireEvent.click(screen.getByTestId('undo-toast-undo'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onUndo).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
