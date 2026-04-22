import type { Session } from 'next-auth';
import MapperFactory from '@/config/datamapper';
import type { UserAuthRoles } from '@/config/macros';
import type { SitesRDS, SitesResult } from '@/config/sqlrdsdefinitions/zones';

const USER_AUTH_ROLES = new Set<UserAuthRoles>(['global', 'db admin', 'lead technician', 'field crew', 'pending']);

export class PendingUserEditForbiddenError extends Error {
  constructor() {
    super('pending users cannot edit measurements');
    this.name = 'PendingUserEditForbiddenError';
  }
}

export class SessionExpiredError extends Error {
  constructor(message = 'session authorization is no longer fresh') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export interface EditAuthorizationScope {
  schema: string;
  plotID: number;
  censusID: number;
}

export interface AuthorizationSnapshot {
  email: string;
  name?: string;
  userStatus: UserAuthRoles;
  sites: SitesRDS[];
}

export type FetchFreshAuthorization = (email: string) => Promise<AuthorizationSnapshot | null>;

export function assertSessionMayEdit(session: Session): void {
  if (session.user?.userStatus === 'pending') {
    throw new PendingUserEditForbiddenError();
  }
}

function isUserAuthRole(value: unknown): value is UserAuthRoles {
  return typeof value === 'string' && USER_AUTH_ROLES.has(value as UserAuthRoles);
}

function hasSchemaAccess(snapshot: AuthorizationSnapshot, schema: string): boolean {
  if (snapshot.userStatus === 'global' || snapshot.userStatus === 'db admin') {
    return true;
  }
  return snapshot.sites.some(site => site.schemaName === schema);
}

export function snapshotAuthorization(session: Session): AuthorizationSnapshot | null {
  const email = session.user?.email;
  const userStatus = session.user?.userStatus;
  if (!email || !isUserAuthRole(userStatus)) {
    return null;
  }
  return {
    email,
    name: session.user.name,
    userStatus,
    sites: session.user.sites ?? []
  };
}

export async function fetchAuthoritativeAuthorization(email: string): Promise<AuthorizationSnapshot | null> {
  const authURL = process.env.AUTH_FUNCTIONS_POLL_URL;
  if (!authURL) {
    throw new SessionExpiredError('fresh authorization endpoint is not configured');
  }

  const response = await fetch(`${authURL}?email=${encodeURIComponent(email)}`, {
    method: 'GET',
    cache: 'no-store'
  });
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new SessionExpiredError(`fresh authorization check failed with status ${response.status}`);
  }

  const data = (await response.json()) as { userStatus?: unknown; allowedSites?: SitesResult[] };
  if (!isUserAuthRole(data.userStatus)) {
    return null;
  }

  const sites = MapperFactory.getMapper<SitesRDS, SitesResult>('sites').mapData(data.allowedSites ?? []);
  return {
    email,
    userStatus: data.userStatus,
    sites
  };
}

export function assertAuthorizationStillFresh(
  initial: AuthorizationSnapshot | null,
  fresh: AuthorizationSnapshot | null,
  scope: EditAuthorizationScope
): void {
  if (!initial || !fresh) {
    throw new SessionExpiredError('session expired');
  }
  if (fresh.email !== initial.email) {
    throw new SessionExpiredError('session user changed before commit');
  }
  if (fresh.userStatus !== initial.userStatus) {
    throw new SessionExpiredError('user role changed before commit');
  }
  if (fresh.userStatus === 'pending') {
    throw new SessionExpiredError('user role no longer allows edits');
  }
  if (!hasSchemaAccess(fresh, scope.schema)) {
    throw new SessionExpiredError('user scope changed before commit');
  }
}

export function createFreshAuthorizationCheck(
  session: Session,
  scope: EditAuthorizationScope,
  fetchFreshAuthorization: FetchFreshAuthorization = fetchAuthoritativeAuthorization
): () => Promise<void> {
  const initial = snapshotAuthorization(session);
  return async () => {
    const fresh = initial ? await fetchFreshAuthorization(initial.email) : null;
    assertAuthorizationStillFresh(initial, fresh, scope);
  };
}
