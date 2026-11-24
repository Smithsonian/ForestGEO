import React, { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IsolatedAttributesDataGrid from '@/components/datagrids/applications/isolated/isolatedattributesdatagrid';
import MultilineModal from '@/components/datagrids/applications/multiline/multilinemodal';
import { FormType } from '@/config/macros/formdetails';
import { ReviewStates } from '@/config/macros/uploadsystemmacros';

const MANUAL_ENTRY_BUTTON_LABEL = 'Manual Entry Form';
const FINALIZE_BUTTON_LABEL = 'Finalize Changes';
const COMPLETE_VALIDATION_BUTTON_LABEL = 'Complete validation';
const SIMULATED_NETWORK_DELAY_MS = 5;
const LOOP_OBSERVATION_WINDOW_MS = 300;

const harness = vi.hoisted(() => ({
  gridFetchCount: 0,
  triggerRefresh: vi.fn(),
  reportFromUnmountedValidation: null as ((state: string) => void) | null
}));

vi.mock('@/components/datagrids/isolateddatagridcommons', async () => {
  const { useEffect, useRef } = await import('react');
  function IsolatedDataGridCommonsStub(props: {
    refresh: boolean;
    setRefresh: (value: boolean) => void;
    dynamicButtons: { label: string; onClick: () => void }[];
  }) {
    const { refresh, setRefresh, dynamicButtons } = props;
    const previousRefresh = useRef(refresh);
    useEffect(() => {
      if (refresh && !previousRefresh.current) {
        harness.gridFetchCount += 1;
        const timer = setTimeout(() => setRefresh(false), SIMULATED_NETWORK_DELAY_MS);
        previousRefresh.current = refresh;
        return () => clearTimeout(timer);
      }
      previousRefresh.current = refresh;
    }, [refresh, setRefresh]);
    return (
      <div>
        {dynamicButtons.map(button => (
          <button key={button.label} onClick={button.onClick}>
            {button.label}
          </button>
        ))}
      </div>
    );
  }
  return { default: IsolatedDataGridCommonsStub };
});

vi.mock('@/components/client/datagridcolumns', () => ({ AttributeGridColumns: [] }));
vi.mock('@/components/uploadsystemhelpers/uploadparentmodal', () => ({ default: () => null }));
vi.mock('@/components/client/rendergridformexplanations', () => ({ default: () => null }));

function mockMultilineGrid(gridName: string) {
  return async () => {
    function MultilineGridStub({ setChangesSubmitted }: { setChangesSubmitted: (value: boolean) => void }) {
      return (
        <div data-testid={`multiline-grid-${gridName}`}>
          <button onClick={() => setChangesSubmitted(true)}>{FINALIZE_BUTTON_LABEL}</button>
        </div>
      );
    }
    return { default: MultilineGridStub };
  };
}

vi.mock('@/components/datagrids/applications/multiline/multilineattributesdatagrid', mockMultilineGrid('attributes'));
vi.mock('@/components/datagrids/applications/multiline/multilinespeciesdatagrid', mockMultilineGrid('species'));
vi.mock('@/components/datagrids/applications/multiline/multilinequadratsdatagrid', mockMultilineGrid('quadrats'));
vi.mock('@/components/datagrids/applications/multiline/multilinepersonneldatagrid', mockMultilineGrid('personnel'));
vi.mock('@/components/datagrids/applications/multiline/multilinemeasurementsdatagrid', mockMultilineGrid('measurements'));

vi.mock('@/components/uploadsystem/segments/uploadvalidation', async () => {
  const { ReviewStates } = await import('@/config/macros/uploadsystemmacros');
  function UploadValidationStub({ setReviewState }: { setReviewState: (state: string) => void }) {
    harness.reportFromUnmountedValidation = setReviewState;
    return (
      <div data-testid="upload-validation">
        <button onClick={() => setReviewState(ReviewStates.UPLOAD_AZURE)}>{COMPLETE_VALIDATION_BUTTON_LABEL}</button>
      </div>
    );
  }
  return { default: UploadValidationStub };
});
vi.mock('@/components/uploadsystem/segments/uploadupdatevalidations', () => ({ default: () => <div data-testid="upload-update-validations" /> }));

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => ({ schemaName: 'testschema', siteName: 'Test Site' })
}));
vi.mock('@/app/contexts/datavalidityprovider', () => ({
  useDataValidityContext: () => ({ triggerRefresh: harness.triggerRefresh })
}));

function waitForLoopObservationWindow(): Promise<void> {
  return act(() => new Promise<void>(resolve => setTimeout(resolve, LOOP_OBSERVATION_WINDOW_MS)));
}

function isManualEntryFormOpen(): boolean {
  return screen.queryByText(/Manual Input Form/) !== null;
}

function describeModalState(): string {
  return [
    `formOpen=${isManualEntryFormOpen()}`,
    `gridVisible=${screen.queryByTestId(/multiline-grid-/) !== null}`,
    `validationVisible=${screen.queryByTestId('upload-validation') !== null}`,
    `gridFetchCount=${harness.gridFetchCount}`,
    `triggerRefreshCalls=${harness.triggerRefresh.mock.calls.length}`
  ].join(' ');
}

describe('MultilineModal finalize handling (#511)', () => {
  beforeEach(() => {
    harness.gridFetchCount = 0;
    harness.triggerRefresh.mockClear();
    harness.reportFromUnmountedValidation = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('inside the real isolated attributes parent, whose close handler is a new inline function on every render', () => {
    it('closes the form and refetches the parent grid exactly once after Finalize Changes', async () => {
      const user = userEvent.setup();
      render(<IsolatedAttributesDataGrid />);

      await user.click(screen.getByRole('button', { name: MANUAL_ENTRY_BUTTON_LABEL }));
      expect(isManualEntryFormOpen(), describeModalState()).toBe(true);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      expect(isManualEntryFormOpen(), `form should close after finalize: ${describeModalState()}`).toBe(false);
      expect(harness.gridFetchCount, `parent grid refetched in a loop: ${describeModalState()}`).toBe(1);
      expect(harness.triggerRefresh, `validity refresh fired repeatedly: ${describeModalState()}`).toHaveBeenCalledTimes(1);
    });

    it('starts a reopened form clean, so a second finalize refetches exactly once more', async () => {
      const user = userEvent.setup();
      render(<IsolatedAttributesDataGrid />);

      await user.click(screen.getByRole('button', { name: MANUAL_ENTRY_BUTTON_LABEL }));
      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      await user.click(screen.getByRole('button', { name: MANUAL_ENTRY_BUTTON_LABEL }));
      await waitForLoopObservationWindow();
      expect(isManualEntryFormOpen(), `reopened form closed itself without a new finalize: ${describeModalState()}`).toBe(true);
      expect(harness.gridFetchCount, `reopening alone refetched the grid: ${describeModalState()}`).toBe(1);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      expect(isManualEntryFormOpen(), describeModalState()).toBe(false);
      expect(harness.gridFetchCount, `second finalize did not refetch exactly once more: ${describeModalState()}`).toBe(2);
      expect(harness.triggerRefresh, describeModalState()).toHaveBeenCalledTimes(2);
    });
  });

  describe('measurements form, whose parent passes inline close and submit-complete handlers like msvdatagrid', () => {
    function MeasurementsParentHarness({
      onClose,
      onSubmitComplete,
      reloadBeforeCloseMs = 0
    }: {
      onClose: (completed: boolean) => void;
      onSubmitComplete: () => void;
      reloadBeforeCloseMs?: number;
    }) {
      const [isOpen, setIsOpen] = useState(true);
      const [manualEntryCompleted, setManualEntryCompleted] = useState(false);
      const [isReloading, setIsReloading] = useState(false);
      function finishClose() {
        setIsReloading(false);
        setIsOpen(false);
        setManualEntryCompleted(false);
      }
      return (
        <>
          <button onClick={() => setIsOpen(true)}>{MANUAL_ENTRY_BUTTON_LABEL}</button>
          {isReloading && <span data-testid="parent-reloading" />}
          <MultilineModal
            isManualEntryFormOpen={isOpen}
            handleCloseManualEntryForm={() => {
              onClose(manualEntryCompleted);
              if (reloadBeforeCloseMs > 0) {
                setIsReloading(true);
                setTimeout(finishClose, reloadBeforeCloseMs);
              } else {
                finishClose();
              }
            }}
            formType={FormType.measurements}
            onSubmitComplete={() => {
              onSubmitComplete();
              setManualEntryCompleted(true);
            }}
          />
        </>
      );
    }

    it('shows validation after finalize and closes once, reporting completion, when validation finishes', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onSubmitComplete = vi.fn();
      render(<MeasurementsParentHarness onClose={onClose} onSubmitComplete={onSubmitComplete} />);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      expect(screen.queryByTestId('upload-validation'), `validation step not shown: ${describeModalState()}`).not.toBeNull();
      expect(onSubmitComplete, `submit-complete fired repeatedly: ${describeModalState()}`).toHaveBeenCalledTimes(1);
      expect(harness.triggerRefresh, describeModalState()).toHaveBeenCalledTimes(1);
      expect(onClose, `form closed before validation finished: ${describeModalState()}`).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: COMPLETE_VALIDATION_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      expect(isManualEntryFormOpen(), describeModalState()).toBe(false);
      expect(onClose.mock.calls, `close should fire once, with the entry marked completed: ${describeModalState()}`).toEqual([[true]]);
      expect(onSubmitComplete, describeModalState()).toHaveBeenCalledTimes(1);
    });

    it('requests close once and keeps the finished validation step on screen while the parent reloads before closing', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<MeasurementsParentHarness onClose={onClose} onSubmitComplete={vi.fn()} reloadBeforeCloseMs={LOOP_OBSERVATION_WINDOW_MS} />);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await user.click(screen.getByRole('button', { name: COMPLETE_VALIDATION_BUTTON_LABEL }));
      await waitFor(() => expect(screen.queryByTestId('parent-reloading'), describeModalState()).not.toBeNull());

      expect(isManualEntryFormOpen(), `form closed before the parent finished reloading: ${describeModalState()}`).toBe(true);
      expect(screen.queryByTestId('multiline-grid-measurements'), `empty entry grid flashed during the parent reload: ${describeModalState()}`).toBeNull();

      await waitForLoopObservationWindow();

      expect(isManualEntryFormOpen(), describeModalState()).toBe(false);
      expect(onClose.mock.calls, `close requested more than once while the parent re-rendered: ${describeModalState()}`).toEqual([[true]]);
    });

    it('requests close once when validation finishes while the parent is still reloading after the close button', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<MeasurementsParentHarness onClose={onClose} onSubmitComplete={vi.fn()} reloadBeforeCloseMs={LOOP_OBSERVATION_WINDOW_MS} />);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await user.click(screen.getByRole('button', { name: 'close' }));
      await waitFor(() => expect(screen.queryByTestId('parent-reloading'), describeModalState()).not.toBeNull());
      await user.click(screen.getByRole('button', { name: COMPLETE_VALIDATION_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      expect(isManualEntryFormOpen(), describeModalState()).toBe(false);
      expect(onClose.mock.calls, `close button plus finished validation started a second parent reload: ${describeModalState()}`).toEqual([[true]]);
    });

    it('ignores a validation result that arrives after the form closed when the next Finalize starts validation', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<MeasurementsParentHarness onClose={onClose} onSubmitComplete={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      const reportFromClosedValidation = harness.reportFromUnmountedValidation;
      await user.click(screen.getByRole('button', { name: 'close' }));
      await act(async () => reportFromClosedValidation?.(ReviewStates.UPLOAD_AZURE));

      await user.click(screen.getByRole('button', { name: MANUAL_ENTRY_BUTTON_LABEL }));
      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await waitForLoopObservationWindow();

      expect(screen.queryByTestId('upload-validation'), `second finalize skipped its validation step: ${describeModalState()}`).not.toBeNull();
      expect(onClose, `stale validation result closed the second submission early: ${describeModalState()}`).toHaveBeenCalledTimes(1);
    });

    it('reopens on the entry grid rather than the finished validation step', async () => {
      const user = userEvent.setup();
      render(<MeasurementsParentHarness onClose={vi.fn()} onSubmitComplete={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await user.click(screen.getByRole('button', { name: COMPLETE_VALIDATION_BUTTON_LABEL }));
      await waitFor(() => expect(isManualEntryFormOpen(), describeModalState()).toBe(false));

      await user.click(screen.getByRole('button', { name: MANUAL_ENTRY_BUTTON_LABEL }));

      expect(screen.queryByTestId('multiline-grid-measurements'), `reopened form did not show the entry grid: ${describeModalState()}`).not.toBeNull();
      expect(screen.queryByTestId('upload-validation'), describeModalState()).toBeNull();
    });

    it('reopens on the entry grid after the user closes the form mid-validation', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<MeasurementsParentHarness onClose={onClose} onSubmitComplete={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: FINALIZE_BUTTON_LABEL }));
      await user.click(screen.getByRole('button', { name: 'close' }));
      await waitForLoopObservationWindow();
      expect(onClose, `close button should close exactly once: ${describeModalState()}`).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: MANUAL_ENTRY_BUTTON_LABEL }));

      expect(screen.queryByTestId('multiline-grid-measurements'), describeModalState()).not.toBeNull();
      expect(screen.queryByTestId('upload-validation'), describeModalState()).toBeNull();
    });
  });
});
