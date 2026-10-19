import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/ailogger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

// validation-runner.ts only needs the type guard from this module; mocking it
// keeps this suite from pulling in the full (heavy) React component tree for
// a file it never renders.
vi.mock('@/components/client/validationcore', () => ({
  isNetworkValidationFetchFailure: () => false
}));

// The real Zustand store, not a spy stand-in. A whole-store mock of
// completeValidationRun/startValidationRun as independent vi.fn()s can't see
// the thing this task's corrections are actually about: whether stale
// status/progress/notices from a *previous* run keep lingering, and whether
// a rejected request ever leaves the store in a state it was never told to
// reach. Only the real reducers (which read/merge actual prior state) can
// expose that.
import { useAppStore } from '@/config/store/appstore';
import { ValidationRunner } from './validation-runner';

// ─── Response builders ───────────────────────────────────────────────────────
// Real Response objects (Node's built-in fetch implementation), not a
// duck-typed stand-in — .ok, .clone(), .json(), and the streaming .body
// reader all behave exactly as they do against a live server, including an
// empty body genuinely throwing out of .json() (exercising readResponsePayload's
// text() fallback) and a string body producing a real ReadableStream.

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ndjsonResponse(messages: Array<Record<string, unknown>>): Response {
  const payload = messages.map(message => JSON.stringify(message)).join('\n') + '\n';
  return new Response(payload, { status: 200 });
}

interface RouterHandlers {
  validationList: () => Response;
  createRun?: () => Response;
  patchRun?: () => Response;
  procedures?: Record<string, () => Response>;
  updatePassed?: () => Response;
  refreshSummary?: () => Response;
  refreshFullTable?: () => Response;
}

// Routes by URL + method rather than call-order (mockResolvedValueOnce chains),
// so these tests stay correct if the runner's internal call order ever shifts,
// and so an unexpected request fails loudly with the exact URL/method instead
// of a confusing "wrong mock value" assertion failure.
function buildFetchRouter(handlers: RouterHandlers) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.includes('/api/validations/validationlist')) {
      return Promise.resolve(handlers.validationList());
    }
    if (url === '/api/validations/run' && method === 'POST') {
      return Promise.resolve((handlers.createRun ?? (() => jsonResponse({ runID: 1 })))());
    }
    if (url === '/api/validations/run' && method === 'PATCH') {
      return Promise.resolve((handlers.patchRun ?? (() => jsonResponse({})))());
    }
    const procedureMatch = url.match(/\/api\/validations\/procedures\/(.+)$/);
    if (procedureMatch) {
      const procedureHandler = handlers.procedures?.[procedureMatch[1]];
      if (!procedureHandler) {
        throw new Error(`Unexpected validation procedure request: ${procedureMatch[1]}`);
      }
      return Promise.resolve(procedureHandler());
    }
    if (url === '/api/validations/updatepassedvalidations') {
      return Promise.resolve((handlers.updatePassed ?? (() => jsonResponse({ success: true })))());
    }
    if (url.includes('/api/refreshviews/measurementssummary/')) {
      return Promise.resolve((handlers.refreshSummary ?? (() => jsonResponse({ success: true })))());
    }
    if (url.includes('/api/refreshviews/viewfulltable/')) {
      return Promise.resolve((handlers.refreshFullTable ?? (() => jsonResponse({ success: true })))());
    }

    throw new Error(`Unexpected fetch in validation-runner test: ${method} ${url}`);
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, predicate: (url: string, method: string) => boolean) {
  const call = fetchMock.mock.calls.find(([input, init]) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
    return predicate(url, method);
  });
  const rawBody = (call?.[1] as RequestInit | undefined)?.body;
  return typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
}

/** Snapshot of the real store's validation slice, for compact assertions. */
function validationState() {
  const state = useAppStore.getState();
  return {
    status: state.validationStatus,
    runID: state.validationRunID,
    progress: state.validationProgress,
    errors: state.validationErrors,
    notices: state.validationNotices
  };
}

const RUN_PARAMS = { schema: 'test_schema', plotID: 1, censusID: 5 };
const MANUAL_RERUN_OPTIONS = { requirePersistedRun: true };
const SPECIES_CODE_VALIDATION = { ValidateSpeciesCode: { id: 11, description: 'Species code check', definition: '' } };

describe('ValidationRunner.start', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    useAppStore.getState().clearValidationRun();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    // ValidationRunner is a module-level singleton with no reset hook.
    // getActiveParams() only clears in executeRun's trailing .finally(),
    // after its last awaited step — including the finalization PATCH,
    // which IS awaited in production (not fire-and-forget). Waiting on
    // this signal, rather than a fixed timer tick, guarantees that PATCH
    // has actually been issued against the current fetch mock before the
    // next test swaps it out — a timer tick can resolve before that, which
    // would leak a stray request into the next test.
    await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());
    ValidationRunner.cancel();
    vi.unstubAllGlobals();
  });

  describe('validation-list fetch failure (gap this task fixes)', () => {
    it('treats an HTTP failure as a failed run and surfaces the response error, without creating a run or calling procedures', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ error: 'DB connection lost' }, { status: 500 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      // Reuses the existing failed-run status path rather than a bespoke one.
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['DB connection lost']);
      expect(state.runID).toBeNull();

      // Only the validation-list request happened: no run row, no procedures,
      // no finalization for a request that never produced data.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to an HTTP-status message when the failure response has no JSON error field', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse(undefined, { status: 503 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['HTTP 503']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('truncates an overlong JSON error field instead of putting an unbounded string in the badge', async () => {
      const overlongMessage = 'D'.repeat(400);
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ error: overlongMessage }, { status: 500 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      // 300-char bound (MAX_STARTUP_ERROR_MESSAGE_LENGTH) plus the "…" marker
      // — never the raw 400-char string.
      expect(state.errors).toEqual([`${'D'.repeat(300)}…`]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to an HTTP-status message when the JSON error field is not a string', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ error: { code: 'ECONNRESET' } }, { status: 500 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      // A serialized object would be unreadable noise in the badge — the
      // bounded HTTP-status fallback is used instead.
      expect(state.errors).toEqual(['HTTP 500']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to an HTTP-status message when the error field is a reverse-proxy HTML error page', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ error: '<html><body>502 Bad Gateway</body></html>' }, { status: 502 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      // An HTML document must never render verbatim in the badge.
      expect(state.errors).toEqual(['HTTP 502']);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still completes immediately for a successful response with zero validations defined (regression guard)', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: {} })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('completed');
      expect(state.runID).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('run-creation failures on a manual rerun (requirePersistedRun: fail closed)', () => {
    it('stops before any procedure call when run creation is rejected (e.g. 403)', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ error: 'Forbidden' }, { status: 403 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS, MANUAL_RERUN_OPTIONS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['Forbidden']);
      expect(state.runID).toBeNull();
      // validationlist + the rejected run-creation request only — no
      // procedure or finalization request for a run that was never created.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stops before any procedure call when run creation returns a nonpositive runID', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ runID: -5 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS, MANUAL_RERUN_OPTIONS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['Validation run API did not return a runID']);
      expect(state.runID).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('run-creation failures on an upload-triggered run (default: continue in-memory)', () => {
    it('still runs every procedure and finalizes when run creation is rejected, so freshly ingested rows are not left pending', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ error: 'Internal Server Error' }, { status: 500 }),
        procedures: { ValidateSpeciesCode: () => ndjsonResponse([{ type: 'result', data: true }]) }
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status, `upload validation must complete without a run record; store errors: ${JSON.stringify(state.errors)}`).toBe('completed');
      expect(state.runID, 'no run record was created, so the in-memory run has no runID').toBeNull();
      expect(
        fetchMock.mock.calls.some(([input]) => String(input).includes('/procedures/ValidateSpeciesCode')),
        'the validation procedure must still execute'
      ).toBe(true);
      expect(
        fetchMock.mock.calls.some(([input]) => String(input) === '/api/validations/updatepassedvalidations'),
        'finalization must still move passing rows out of pending'
      ).toBe(true);
    });
  });

  describe('run-creation conflicts', () => {
    it('follows an existing persisted run instead of executing procedures locally', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ conflict: true, existingRunID: 4242 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('running');
      expect(state.runID).toBe(4242);
      expect(state.progress.current).toBe('Waiting for other run to finish');
      // validationlist + createRun only — this tab never executes a
      // procedure for a run it doesn't own.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces a visible, recoverable failure for a scope lock with no existing run to follow, and clears a stale completed state from a previous run', async () => {
      // Seed a stale "completed" run (with a notice) from a previous click,
      // so this test can prove start() wipes it rather than leaving it
      // visible underneath — or after — the new, rejected request.
      useAppStore.getState().startValidationRun(111, 2);
      useAppStore.getState().updateValidationProgress({ completed: 2 });
      useAppStore.getState().completeValidationRun('completed', [], ['Stale notice from a previous run']);
      expect(useAppStore.getState().validationStatus).toBe('completed');

      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ conflict: true, reason: 'A measurement operation is already in progress for this plot/census' })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);

      // Synchronous check: before the validationlist request has even
      // resolved, the stale completed status/notice must already be gone.
      expect(useAppStore.getState().validationStatus).toBe('running');
      expect(useAppStore.getState().validationNotices).toEqual([]);
      expect(useAppStore.getState().validationRunID).toBeNull();

      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['A measurement operation is already in progress for this plot/census']);
      expect(state.notices).toEqual([]);
      expect(state.runID).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('successful sequential run', () => {
    it('runs every validation task in order, persists progress, and completes', async () => {
      fetchMock = buildFetchRouter({
        validationList: () =>
          jsonResponse({
            coreValidations: {
              ValidateSpeciesCode: { id: 11, description: 'Species code check', definition: '' },
              ValidateQuadratName: { id: 22, description: 'Quadrat name check', definition: '' }
            }
          }),
        createRun: () => jsonResponse({ runID: 777 }),
        procedures: {
          ValidateSpeciesCode: () => ndjsonResponse([{ type: 'result', data: true }]),
          // Includes a heartbeat line ahead of the result to prove the real
          // NDJSON reader (not a stand-in) drives this test end to end.
          ValidateQuadratName: () => ndjsonResponse([{ type: 'heartbeat' }, { type: 'result', data: true }])
        }
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('completed');
      expect(state.errors).toEqual([]);
      expect(state.notices).toEqual([]);
      expect(state.runID).toBe(777);
      expect(state.progress.completed).toBe(2);
      expect(state.progress.total).toBe(2);

      expect(requestBody(fetchMock, (url, method) => url === '/api/validations/run' && method === 'POST')).toEqual({
        schema: 'test_schema',
        plotID: 1,
        censusID: 5,
        totalSteps: 2
      });

      const speciesCodeCallIndex = fetchMock.mock.calls.findIndex(([input]) => String(input).includes('/procedures/ValidateSpeciesCode'));
      const quadratNameCallIndex = fetchMock.mock.calls.findIndex(([input]) => String(input).includes('/procedures/ValidateQuadratName'));
      expect(speciesCodeCallIndex).toBeGreaterThanOrEqual(0);
      expect(quadratNameCallIndex).toBeGreaterThan(speciesCodeCallIndex);

      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/validations/updatepassedvalidations')).toBe(true);
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/refreshviews/measurementssummary/'))).toBe(true);
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/refreshviews/viewfulltable/'))).toBe(true);
    });
  });

  describe('finalization HTTP failures (existing checks — proven by test, not reimplemented)', () => {
    it('reports the run as failed when updatepassedvalidations itself returns a non-OK response, but still runs the refresh views', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ runID: 779 }),
        procedures: {
          ValidateSpeciesCode: () => ndjsonResponse([{ type: 'result', data: true }])
        },
        updatePassed: () => jsonResponse({ error: 'Lock timeout' }, { status: 500 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['Failed to update validated rows: Lock timeout']);

      // Finalization doesn't short-circuit on this failure — both refresh
      // requests still fire even though updatepassedvalidations failed.
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/refreshviews/measurementssummary/'))).toBe(true);
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/refreshviews/viewfulltable/'))).toBe(true);
    });

    it('reports the run as failed when the post-run summary refresh returns a non-OK response', async () => {
      fetchMock = buildFetchRouter({
        validationList: () => jsonResponse({ coreValidations: SPECIES_CODE_VALIDATION }),
        createRun: () => jsonResponse({ runID: 778 }),
        procedures: {
          ValidateSpeciesCode: () => ndjsonResponse([{ type: 'result', data: true }])
        },
        refreshSummary: () => jsonResponse({ error: 'View rebuild failed' }, { status: 500 })
      });
      vi.stubGlobal('fetch', fetchMock);

      ValidationRunner.start(RUN_PARAMS);
      await vi.waitFor(() => expect(ValidationRunner.getActiveParams()).toBeNull());

      const state = validationState();
      expect(state.status).toBe('failed');
      expect(state.errors).toEqual(['Failed to refresh summary views: View rebuild failed']);

      // All tasks passed, so updatepassedvalidations still ran before the
      // finalization refresh — only the refresh step is what failed here.
      expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/validations/updatepassedvalidations')).toBe(true);
      // Promise.all fires both refresh requests regardless of which rejects.
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/refreshviews/viewfulltable/'))).toBe(true);
    });
  });
});
