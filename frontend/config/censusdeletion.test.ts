import { describe, expect, it } from 'vitest';
import {
  CENSUS_DELETE_ADMIN_ONLY_REASON,
  CENSUS_DELETE_INACTIVE_REASON,
  CENSUS_DELETE_LATEST_ONLY_REASON,
  getCensusDeleteBlockReason,
  readCensusDeleteRejectionMessage
} from './censusdeletion';
import { HTTPResponses } from '@/config/macros';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';

const PLOT_ID = 1;

function buildCensus(plotCensusNumber: number, isActive: boolean): OrgCensusRDS {
  const censusID = 100 + plotCensusNumber;
  return { plotID: PLOT_ID, plotCensusNumber, censusIDs: [censusID], dateRanges: [{ censusID }], description: `Census ${plotCensusNumber}`, isActive };
}

const EARLIER_ACTIVE = buildCensus(1, true);
const LATEST_ACTIVE = buildCensus(2, true);
const NEWER_INACTIVE = buildCensus(3, false);
const CENSUS_LIST = [EARLIER_ACTIVE, LATEST_ACTIVE, NEWER_INACTIVE];
const NOT_IN_LIST = buildCensus(9, true);

describe('getCensusDeleteBlockReason (#525 items 2+3)', () => {
  it.each(['field crew', 'lead technician', 'pending', undefined] as const)(
    'blocks a %s user with the admin-only reason, before any census check',
    userStatus => {
      expect(getCensusDeleteBlockReason(LATEST_ACTIVE, CENSUS_LIST, userStatus)).toBe(CENSUS_DELETE_ADMIN_ONLY_REASON);
    }
  );

  it('blocks a census missing from the list with the inactive reason', () => {
    expect(getCensusDeleteBlockReason(NOT_IN_LIST, CENSUS_LIST, 'global')).toBe(CENSUS_DELETE_INACTIVE_REASON);
  });

  it('reads activity from the list entry, not from the census passed in (a persisted selection can predate the flag)', () => {
    const persistedSelectionClaimingActive = { ...NEWER_INACTIVE, isActive: true };
    expect(getCensusDeleteBlockReason(persistedSelectionClaimingActive, CENSUS_LIST, 'global')).toBe(CENSUS_DELETE_INACTIVE_REASON);
  });

  it('blocks an inactive census numbered above the latest active one with the inactive reason', () => {
    expect(getCensusDeleteBlockReason(NEWER_INACTIVE, CENSUS_LIST, 'global')).toBe(CENSUS_DELETE_INACTIVE_REASON);
  });

  it('blocks an active census that is not the latest active one with the latest-only reason', () => {
    expect(getCensusDeleteBlockReason(EARLIER_ACTIVE, CENSUS_LIST, 'db admin')).toBe(CENSUS_DELETE_LATEST_ONLY_REASON);
  });

  it.each(['global', 'db admin'] as const)('allows a %s user to delete the latest active census even when a higher inactive census exists', userStatus => {
    const reason = getCensusDeleteBlockReason(LATEST_ACTIVE, CENSUS_LIST, userStatus);
    console.log(`[#525 items 2+3] ${userStatus} deleting census ${LATEST_ACTIVE.plotCensusNumber}: ${reason}`);
    expect(reason).toBeNull();
  });
});

describe('readCensusDeleteRejectionMessage (#525 items 2+3)', () => {
  const CONFLICT_MESSAGE = 'Only the latest census can be cleared. Delete newer censuses first.';
  const LOCK_MESSAGE = 'Another census clear is already running for this plot.';
  const UNEXPECTED_READ_FAILURE = new TypeError('body stream already read');

  it('returns the error field of a 4xx JSON body', async () => {
    const response = new Response(JSON.stringify({ error: CONFLICT_MESSAGE }), { status: HTTPResponses.CONFLICT });
    const message = await readCensusDeleteRejectionMessage(response);
    console.log(`[#525 items 2+3] 409 error body -> ${message}`);
    expect(message).toBe(CONFLICT_MESSAGE);
  });

  it('falls back to the message field when error is absent', async () => {
    const response = new Response(JSON.stringify({ message: LOCK_MESSAGE }), { status: HTTPResponses.CONFLICT });
    expect(await readCensusDeleteRejectionMessage(response)).toBe(LOCK_MESSAGE);
  });

  it('returns null for a 4xx body that is not JSON', async () => {
    const response = new Response('<html>Not Found</html>', { status: HTTPResponses.NOT_FOUND });
    expect(await readCensusDeleteRejectionMessage(response)).toBeNull();
  });

  it('returns null for a 4xx JSON body with neither field', async () => {
    const response = new Response(JSON.stringify({ detail: 'nope' }), { status: HTTPResponses.FORBIDDEN });
    expect(await readCensusDeleteRejectionMessage(response)).toBeNull();
  });

  it('returns null for a 5xx even when it carries an error field', async () => {
    const response = new Response(JSON.stringify({ error: 'ER_LOCK_DEADLOCK in clearcensusmsmts' }), { status: HTTPResponses.INTERNAL_SERVER_ERROR });
    expect(await readCensusDeleteRejectionMessage(response)).toBeNull();
  });

  it('rethrows a body-read failure that is not a JSON SyntaxError', async () => {
    const response = { status: HTTPResponses.CONFLICT, json: async () => Promise.reject(UNEXPECTED_READ_FAILURE) } as unknown as Response;
    await expect(readCensusDeleteRejectionMessage(response)).rejects.toBe(UNEXPECTED_READ_FAILURE);
  });
});
