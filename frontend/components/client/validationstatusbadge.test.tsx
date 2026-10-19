import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describeDbhFloorSkips } from '@/config/dbhchangevalidations';
import ValidationStatusBadge from './validationstatusbadge';

const state = vi.hoisted(() => ({
  status: 'completed',
  runID: null as number | null,
  progress: { completed: 2, total: 2, current: '' },
  errors: [] as string[],
  notices: [] as string[],
  startValidationRun: vi.fn(),
  updateValidationProgress: vi.fn(),
  completeValidationRun: vi.fn(),
  clearValidationRun: vi.fn()
}));

// Mutable (not a static () => false) so tests can move the local runner
// between active/inactive mid-test — this is exactly the signal the
// fallback-poll effect under test reads on every tick, not just at mount.
// `resume` is a real vi.fn() (not inlined in the mock factory below) so a
// test's beforeEach can re-arm its resolved value after vitest.config.mts's
// mockReset clears every vi.fn()'s implementation between tests.
const runnerState = vi.hoisted(() => ({ isRunning: false, resume: vi.fn() }));

vi.mock('@/config/store/appstore', () => ({ useBackgroundValidationState: () => state }));
vi.mock('@/config/validation-runner', () => ({
  ValidationRunner: {
    isRunning: () => runnerState.isRunning,
    resume: (...args: unknown[]) => runnerState.resume(...args)
  }
}));

function openDetails() {
  render(<ValidationStatusBadge />);
  fireEvent.click(screen.getByRole('button', { name: 'Validation status' }));
}

describe('ValidationStatusBadge completion messages', () => {
  beforeEach(() => {
    state.status = 'completed';
    state.errors = [];
    state.notices = [];
  });

  it('shows persisted notices for a completed run without presenting a failure', () => {
    const notice = describeDbhFloorSkips(42)!;
    state.notices = [notice];

    openDetails();

    expect(screen.getByText('Validation completed with notices')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(notice);
    expect(screen.queryByText(/validations? failed/)).not.toBeInTheDocument();
    expect(screen.queryByText('All 2 validations passed')).not.toBeInTheDocument();
  });

  it('keeps the success display for a completed run without notices', () => {
    openDetails();

    expect(screen.getByText('All 2 validations passed')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('still displays failures and their messages for failed runs', () => {
    state.status = 'failed';
    state.errors = ['Failed to refresh measurement views'];
    state.notices = ['One comparison skipped'];

    openDetails();

    expect(screen.getByText('1 validation failed')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('One comparison skipped');
    expect(screen.getByText(state.errors[0])).toBeInTheDocument();
    expect(screen.queryByText('Validation completed with notices')).not.toBeInTheDocument();
  });
});

describe('ValidationStatusBadge fallback DB poll (R2.1 regression)', () => {
  // Mirrors the non-exported DB_POLL_INTERVAL_MS in validationstatusbadge.tsx.
  const POLL_INTERVAL_MS = 10_000;

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state.status = 'running';
    state.runID = null;
    state.progress = { completed: 0, total: 2, current: '' };
    state.errors = [];
    state.notices = [];
    runnerState.isRunning = false;
    // mockReset (vitest.config.mts) clears this between every test.
    runnerState.resume.mockResolvedValue(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('installs the fallback timer even while the local runner is active at mount, and only polls once it becomes inactive (local-running -> following)', async () => {
    // The moment ValidationRunner.start() has synchronously flipped status
    // to 'running' but not yet cleared its own activity in .finally().
    runnerState.isRunning = true;
    fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        run: { RunID: 777, Status: 'completed', TotalSteps: 2, CompletedSteps: 2, ErrorMessages: [], Notices: [] }
      })
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={5} />);

    // Under the bug this corrects, isRunning() === true at mount caused the
    // effect to return before installing any timer at all, so no later
    // activity change could ever trigger a poll. Proven below: a tick IS
    // observed once isRunning() flips, with no re-render/dependency change
    // in between — only the per-tick check can explain that.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.completeValidationRun).not.toHaveBeenCalled();

    // The module-level runner clears its own activity flag non-reactively
    // (ValidationRunner.start()'s .finally()) — nothing about this effect's
    // dependencies changes when that happens.
    runnerState.isRunning = false;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.completeValidationRun).toHaveBeenCalledWith('completed', [], []);
  });

  it('discards a poll response that resolves after the local runner takes over mid-flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    fetchMock = vi.fn(
      () =>
        new Promise(resolve => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={5} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A new local run starts (e.g. the user re-clicked "Run Validations")
    // while this earlier poll's fetch is still in flight.
    runnerState.isRunning = true;

    await act(async () => {
      resolveFetch({
        json: async () => ({
          run: { RunID: 777, Status: 'completed', TotalSteps: 2, CompletedSteps: 2, ErrorMessages: [], Notices: [] }
        })
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // The response arrived, but it's stale relative to the new local run —
    // writing it into Zustand now would clobber what that run is reporting.
    expect(state.completeValidationRun).not.toHaveBeenCalled();
  });

  it('discards a stale poll response for the previous run once the followed run changes identity while status stays running', async () => {
    const PREVIOUS_RUN_ID = 101;
    const NEXT_RUN_ID = 202;
    state.runID = PREVIOUS_RUN_ID;

    let resolvePreviousRunFetch: (value: unknown) => void = () => {};
    fetchMock = vi.fn(
      () =>
        new Promise(resolve => {
          resolvePreviousRunFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={5} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The local tab hands off from the previous followed run to a
    // different persisted run — status never leaves 'running', so only a
    // reactive runID dependency can end the previous run's poll lifetime.
    state.runID = NEXT_RUN_ID;
    rerender(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={5} />);

    await act(async () => {
      resolvePreviousRunFetch({
        json: async () => ({
          run: { RunID: PREVIOUS_RUN_ID, Status: 'completed', TotalSteps: 2, CompletedSteps: 2, ErrorMessages: [], Notices: [] }
        })
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // The previous run's completion must never land now that a different
    // run is the one being followed.
    expect(state.completeValidationRun).not.toHaveBeenCalled();
  });

  it('never has two fetches in flight within the same run lifetime, so a slower tick cannot overwrite a faster, later one', async () => {
    let fetchCount = 0;
    const pendingResolvers: Array<(value: unknown) => void> = [];
    fetchMock = vi.fn(() => {
      fetchCount += 1;
      return new Promise(resolve => pendingResolvers.push(resolve));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={5} />);

    // Two ticks elapse before either response has resolved.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });

    // The in-flight guard skips the second tick's fetch entirely — never
    // two requests racing within the same lifetime.
    expect(fetchCount).toBe(1);

    pendingResolvers[0]({
      json: async () => ({ run: { RunID: 777, Status: 'running', TotalSteps: 2, CompletedSteps: 1, CurrentStep: 'step', ErrorMessages: [], Notices: [] } })
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // A third tick, now that the first fetch has settled, is free to fetch again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(fetchCount).toBe(2);
  });
});

describe('ValidationStatusBadge scope switch while following another run', () => {
  const FOLLOWED_RUN_ID = 41;

  beforeEach(() => {
    state.status = 'running';
    state.runID = FOLLOWED_RUN_ID;
    state.progress = { completed: 0, total: 2, current: 'Waiting for other run to finish' };
    runnerState.isRunning = false;
    runnerState.resume.mockResolvedValue(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ run: null }) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the followed run on first mount, then clears it and resumes the new scope when the plot changes', async () => {
    const { rerender } = render(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={2} />);

    expect(state.clearValidationRun, 'first mount must not wipe a run the tab is already following').not.toHaveBeenCalled();
    expect(runnerState.resume, 'first mount resumes the current scope').toHaveBeenCalledExactlyOnceWith({ schema: 'test_schema', plotID: 1, censusID: 2 });

    await act(async () => {
      rerender(<ValidationStatusBadge schema="test_schema" plotID={3} censusID={2} />);
    });

    expect(state.clearValidationRun, "switching plot must drop plot 1's run from the unscoped store").toHaveBeenCalledTimes(1);
    expect(runnerState.resume, 'the new plot must be resumed, not skipped by a stale resumed flag').toHaveBeenLastCalledWith({
      schema: 'test_schema',
      plotID: 3,
      censusID: 2
    });
    expect(runnerState.resume).toHaveBeenCalledTimes(2);
  });

  it('does not clear or resume while this tab is driving its own run', async () => {
    const { rerender } = render(<ValidationStatusBadge schema="test_schema" plotID={1} censusID={2} />);
    runnerState.isRunning = true;

    await act(async () => {
      rerender(<ValidationStatusBadge schema="test_schema" plotID={3} censusID={2} />);
    });

    expect(state.clearValidationRun, "the active local run's progress must not be wiped").not.toHaveBeenCalled();
    expect(runnerState.resume).toHaveBeenCalledTimes(1);
  });
});
