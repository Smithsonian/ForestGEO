import { HTTPResponses, type UserAuthRoles } from '@/config/macros';
import type { OrgCensus, OrgCensusRDS } from '@/lib/db/definitions/timekeeping';

export const CENSUS_DELETE_ADMIN_ONLY_REASON = 'Only global and database administrators can delete census measurements.';
export const CENSUS_DELETE_LATEST_ONLY_REASON = 'Only the latest census can be deleted. Delete newer censuses first.';
export const CENSUS_DELETE_INACTIVE_REASON = "This census is inactive, so it can't be deleted.";
export const CENSUS_DELETE_GENERIC_FAILURE_MESSAGE = 'Failed to delete census. Please try again.';

export const CENSUS_DELETE_STALE_LIST_STATUSES: readonly number[] = [HTTPResponses.NOT_FOUND, HTTPResponses.CONFLICT];

const CENSUS_DELETE_ROLES: ReadonlySet<UserAuthRoles> = new Set<UserAuthRoles>(['global', 'db admin']);

function isActiveCensus(census: OrgCensus): census is OrgCensusRDS {
  return census?.isActive === true;
}

/**
 * Mirrors app/api/clearcensus/route.ts: admin only, and only the highest
 * PlotCensusNumber among ACTIVE censuses. The server stays authoritative;
 * this only decides how the delete controls look. Activity comes from the
 * refetched list entry, never from the census passed in, because a persisted
 * selection can predate the isActive field.
 */
export function getCensusDeleteBlockReason(
  census: Pick<OrgCensusRDS, 'plotCensusNumber'> | undefined,
  censusList: readonly OrgCensus[] | undefined,
  userStatus: UserAuthRoles | undefined
): string | null {
  if (!userStatus || !CENSUS_DELETE_ROLES.has(userStatus)) return CENSUS_DELETE_ADMIN_ONLY_REASON;
  const knownCensuses = censusList ?? [];
  const listEntry = knownCensuses.find(entry => entry?.plotCensusNumber === census?.plotCensusNumber);
  if (!census || !isActiveCensus(listEntry)) return CENSUS_DELETE_INACTIVE_REASON;
  const latestActivePlotCensusNumber = Math.max(...knownCensuses.filter(isActiveCensus).map(entry => entry.plotCensusNumber));
  return census.plotCensusNumber === latestActivePlotCensusNumber ? null : CENSUS_DELETE_LATEST_ONLY_REASON;
}

/**
 * The reason /api/clearcensus gave for refusing a delete (409 latest-only,
 * 409 lock held, 404 not found, 403 admin-only). Null for a 5xx or a body
 * with no usable reason. Only a JSON SyntaxError is swallowed.
 */
export async function readCensusDeleteRejectionMessage(response: Response): Promise<string | null> {
  if (response.status < HTTPResponses.BAD_REQUEST || response.status >= HTTPResponses.INTERNAL_SERVER_ERROR) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch (parseError) {
    if (parseError instanceof SyntaxError) return null;
    throw parseError;
  }
  if (typeof body !== 'object' || body === null) return null;
  const { error, message } = body as { error?: unknown; message?: unknown };
  if (typeof error === 'string' && error.trim() !== '') return error;
  if (typeof message === 'string' && message.trim() !== '') return message;
  return null;
}
