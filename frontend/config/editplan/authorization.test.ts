import { describe, expect, it, vi } from 'vitest';
import {
  assertAuthorizationStillFresh,
  assertSessionMayEdit,
  createFreshAuthorizationCheck,
  PendingUserEditForbiddenError,
  SessionExpiredError,
  snapshotAuthorization
} from './authorization';

const scope = { schema: 'forestgeo_testing', plotID: 1, censusID: 2 };

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      email: 'mason@example.com',
      name: 'Mason',
      userStatus: 'field crew',
      sites: [{ schemaName: 'forestgeo_testing' }],
      allsites: [],
      ...overrides
    }
  } as any;
}

describe('edit authorization freshness', () => {
  it('blocks pending users before edit work starts', () => {
    expect(() => assertSessionMayEdit(makeSession({ userStatus: 'pending' }))).toThrow(PendingUserEditForbiddenError);
  });

  it('snapshots the authenticated user and scoped sites', () => {
    expect(snapshotAuthorization(makeSession())).toEqual({
      email: 'mason@example.com',
      name: 'Mason',
      userStatus: 'field crew',
      sites: [{ schemaName: 'forestgeo_testing' }]
    });
  });

  it('accepts unchanged fresh authorization for the same scope', async () => {
    const fetchFresh = vi.fn(async () => ({
      email: 'mason@example.com',
      userStatus: 'field crew' as const,
      sites: [{ schemaName: 'forestgeo_testing' }]
    }));

    await expect(createFreshAuthorizationCheck(makeSession(), scope, fetchFresh)()).resolves.toBeUndefined();
    expect(fetchFresh).toHaveBeenCalledWith('mason@example.com');
  });

  it('rejects role changes before commit', async () => {
    const fetchFresh = vi.fn(async () => ({
      email: 'mason@example.com',
      userStatus: 'pending' as const,
      sites: [{ schemaName: 'forestgeo_testing' }]
    }));

    await expect(createFreshAuthorizationCheck(makeSession(), scope, fetchFresh)()).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('rejects scope loss before commit', () => {
    expect(() =>
      assertAuthorizationStillFresh(
        {
          email: 'mason@example.com',
          userStatus: 'lead technician',
          sites: [{ schemaName: 'forestgeo_testing' }]
        },
        {
          email: 'mason@example.com',
          userStatus: 'lead technician',
          sites: [{ schemaName: 'another_schema' }]
        },
        scope
      )
    ).toThrow(SessionExpiredError);
  });
});
