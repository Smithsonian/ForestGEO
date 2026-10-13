import { describe, it, expect, vi } from 'vitest';
import { requestEditRevert, EditRevertRequest, UNCONFIRMED_OUTCOME_MESSAGE } from './requestrevert';
import { ApplyResult, EditPlan } from '@/config/editplan/types';
import { HTTPResponses } from '@/config/macros';

const PLAN_HASH = 'a'.repeat(64);
const FRESH_PLAN_HASH = 'b'.repeat(64);

function makeBaseRequest(overrides: Partial<EditRevertRequest> = {}): EditRevertRequest {
  return {
    schema: 'cocoli',
    plotID: 1,
    censusID: 7,
    editOperationID: 42,
    ...overrides
  };
}

function makeFreshPlan(overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    dataType: 'measurementssummary',
    targetID: 99,
    fieldChanges: [],
    effects: [],
    maxSeverity: 'warn',
    planHash: FRESH_PLAN_HASH,
    generatedAt: '2026-04-20T12:00:00Z',
    ...overrides
  };
}

// Mirrors the real ApplyResult contract (frontend/config/editplan/types.ts)
// produced by revertEdit (frontend/config/editplan/revert.ts) and returned
// by frontend/app/api/edits/revert/route.ts. Every field present and typed
// exactly as the server emits it, so success-path tests exercise the real
// contract instead of a hollow stand-in.
function makeApplyResult(overrides: Partial<ApplyResult> = {}): ApplyResult {
  return {
    updatedIDs: { CoreMeasurementID: 42 },
    applyErrors: [],
    editOperationID: 1234,
    validationPending: false,
    ...overrides
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('requestEditRevert', () => {
  describe('200 success path (real ApplyResult contract)', () => {
    it('returns reverted with the parsed ApplyResult on a 200 response, posting no confirmedPlanHash key when not supplied', async () => {
      const applyResult = makeApplyResult();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(outcome).toEqual({ status: 'reverted', result: applyResult });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/edits/revert');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      const sentBody = JSON.parse(init?.body as string);
      expect(sentBody).toEqual({ schema: 'cocoli', plotID: 1, censusID: 7, editOperationID: 42 });
      expect('confirmedPlanHash' in sentBody).toBe(false);
    });

    it('includes exactly the supplied confirmedPlanHash and preserves the rest of the scope', async () => {
      const applyResult = makeApplyResult();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));

      await requestEditRevert(makeBaseRequest({ confirmedPlanHash: PLAN_HASH }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const sentBody = JSON.parse(init?.body as string);
      expect(sentBody).toEqual({
        schema: 'cocoli',
        plotID: 1,
        censusID: 7,
        editOperationID: 42,
        confirmedPlanHash: PLAN_HASH
      });
    });

    it('returns reverted with non-empty applyErrors and validationPending true, proving those fields pass through unmodified', async () => {
      const applyResult = makeApplyResult({
        applyErrors: [{ ruleID: 'rule-7', coreMeasurementID: 55, reason: 'stale measurement' }],
        validationPending: true,
        postValidation: { newErrors: 2, clearedErrors: 1 }
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, applyResult));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'reverted', result: applyResult });
    });
  });

  describe('200 response with a malformed body never becomes reverted or failed', () => {
    it('returns unconfirmed (not reverted, not failed) when the 200 body is empty', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: HTTPResponses.OK }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when the 200 body is non-JSON', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json at all', { status: HTTPResponses.OK }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when the 200 body is an unrelated JSON object ({ ok: true })', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, { ok: true }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when editOperationID is null, since revert.ts only marks the operation reverted for a non-null recorded ID', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(HTTPResponses.OK, makeApplyResult({ editOperationID: null as unknown as number })));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when editOperationID is 0 (not a positive integer)', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, makeApplyResult({ editOperationID: 0 })));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when editOperationID is negative', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, makeApplyResult({ editOperationID: -3 })));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when editOperationID is a non-integer number', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, makeApplyResult({ editOperationID: 12.5 })));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when validationPending is missing entirely', async () => {
      const { validationPending, ...withoutValidationPending } = makeApplyResult();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, withoutValidationPending));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when applyErrors is not an array', async () => {
      const malformed = { ...makeApplyResult(), applyErrors: 'none' };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, malformed));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when an applyErrors item is missing its string reason', async () => {
      const malformed = makeApplyResult({ applyErrors: [{ ruleID: 'rule-1' } as unknown as ApplyResult['applyErrors'][number]] });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, malformed));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });

    it('returns unconfirmed when an updatedIDs value is not a number (the original dishonest fixture shape)', async () => {
      const malformed = { ...makeApplyResult(), updatedIDs: { CoreMeasurementID: '42' } };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.OK, malformed));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });
  });

  describe('409 CONFLICT with a freshPlan validated against the renderable EditPlan shape', () => {
    it('returns confirmation-required with the fresh plan on 409 "revert drift"', async () => {
      const freshPlan = makeFreshPlan();
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe('confirmation-required');
      if (outcome.status === 'confirmation-required') {
        expect(outcome.freshPlan).toEqual(freshPlan);
      }
    });

    it('returns confirmation-required with the fresh plan on 409 "plan hash mismatch"', async () => {
      const freshPlan = makeFreshPlan({ maxSeverity: 'destructive' });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'plan hash mismatch', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest({ confirmedPlanHash: PLAN_HASH }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe('confirmation-required');
      if (outcome.status === 'confirmation-required') {
        expect(outcome.freshPlan.planHash).toBe(FRESH_PLAN_HASH);
      }
    });

    it('returns a fully valid plan unchanged (deep equality), proving the guard does not strip renderable fields', async () => {
      const freshPlan = makeFreshPlan({
        fieldChanges: [{ field: 'SpeciesCode', from: 'PSEU', to: 'ALSE' }],
        effects: [
          {
            id: 'effect-1',
            severity: 'warn',
            category: 'field',
            title: 'Species updated',
            detail: 'The species code on this tree will change.',
            affectedTable: 'coremeasurements',
            affectedRowCount: 3,
            references: { coreMeasurementIDs: [1, 2, 3] }
          }
        ],
        errors: [
          {
            kind: 'RoleForbiddenField',
            field: 'SpeciesCode',
            role: 'unknown',
            message: 'blocked',
            severity: 'destructive',
            blocking: true
          }
        ],
        canApply: false
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'confirmation-required', freshPlan });
    });

    it('returns failed (not confirmation-required) on 409 "already reverted", naming the reverting edit operation without leaking hash internals', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'already reverted', byEditOperationID: 101 }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') {
        expect(outcome.httpStatus).toBe(HTTPResponses.CONFLICT);
        expect(outcome.message).toContain('101');
        expect(outcome.message.toLowerCase()).not.toContain('hash');
      }
    });

    it('returns failed on 409 "edit operation changed during revert" with no fresh plan, without hash-internals phrasing', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'edit operation changed during revert, please retry' }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') {
        expect(outcome.httpStatus).toBe(HTTPResponses.CONFLICT);
        expect(outcome.message.toLowerCase()).not.toContain('hash mismatch without fresh plan');
      }
    });
  });

  describe('409 CONFLICT with a malformed freshPlan falls through to failed (never manufactured/repaired, never re-posted)', () => {
    it('falls through to failed when freshPlan.effects is missing', async () => {
      const { effects, ...planWithoutEffects } = makeFreshPlan();
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan: planWithoutEffects }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when an effects item has an unknown severity', async () => {
      const freshPlan = makeFreshPlan({
        effects: [
          {
            id: 'effect-1',
            // Intentionally not a real Severity, to prove the guard rejects
            // values the SEVERITY_RANK/SEVERITY_CHIP_COLOR lookups cannot index.
            severity: 'catastrophic' as unknown as EditPlan['effects'][number]['severity'],
            category: 'field',
            title: 'Bad severity',
            detail: 'Should be rejected',
            affectedTable: 'coremeasurements',
            affectedRowCount: 1
          }
        ]
      });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when freshPlan.fieldChanges is not an array', async () => {
      const freshPlan = { ...makeFreshPlan(), fieldChanges: 'none' };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when freshPlan.planHash is empty', async () => {
      const freshPlan = makeFreshPlan({ planHash: '' });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when an errors entry is not an object', async () => {
      const freshPlan = { ...makeFreshPlan(), errors: ['blocked'] };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when canApply is not a boolean', async () => {
      const freshPlan = { ...makeFreshPlan(), canApply: 'false' };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when maxSeverity is "toString", proving the Object.prototype inherited key is not accepted as a real severity', async () => {
      const freshPlan = { ...makeFreshPlan(), maxSeverity: 'toString' };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when maxSeverity is "constructor", proving the Object.prototype inherited key is not accepted as a real severity', async () => {
      const freshPlan = { ...makeFreshPlan(), maxSeverity: 'constructor' };
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when targetID is 0, which is not a positive integer row identifier', async () => {
      const freshPlan = makeFreshPlan({ targetID: 0 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when targetID is negative', async () => {
      const freshPlan = makeFreshPlan({ targetID: -1 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('falls through to failed when targetID is fractional', async () => {
      const freshPlan = makeFreshPlan({ targetID: 1.5 });
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'failed', httpStatus: HTTPResponses.CONFLICT, message: 'revert drift' });
    });

    it('never re-posts automatically after rejecting a malformed freshPlan: exactly one fetch call', async () => {
      const { planHash, ...planWithoutHash } = makeFreshPlan();
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(HTTPResponses.CONFLICT, { error: 'revert drift', freshPlan: planWithoutHash }));

      await requestEditRevert(makeBaseRequest());
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('other error statuses and transport failure', () => {
    it('surfaces the server message on 422 "edit operation is not revertable"', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse(HTTPResponses.UNPROCESSABLE_ENTITY, { error: 'edit operation is not revertable' }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        status: 'failed',
        httpStatus: HTTPResponses.UNPROCESSABLE_ENTITY,
        message: 'edit operation is not revertable'
      });
    });

    it('returns failed on 423 "scope locked"', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(HTTPResponses.LOCKED, { error: 'scope locked' }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({
        status: 'failed',
        httpStatus: HTTPResponses.LOCKED,
        message: 'scope locked'
      });
    });

    it('returns failed with the HTTP status when the error response body is empty/non-JSON, without crashing', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: HTTPResponses.INTERNAL_SERVER_ERROR }));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') {
        expect(outcome.httpStatus).toBe(HTTPResponses.INTERNAL_SERVER_ERROR);
        expect(outcome.message).toContain(String(HTTPResponses.INTERNAL_SERVER_ERROR));
      }
    });

    it('returns unconfirmed (not failed, not reverted) and resolves without throwing when fetch itself rejects with a network error', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

      const outcome = await requestEditRevert(makeBaseRequest());

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ status: 'unconfirmed', message: UNCONFIRMED_OUTCOME_MESSAGE });
    });
  });
});
