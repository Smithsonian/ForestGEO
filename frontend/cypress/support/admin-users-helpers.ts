interface AdminUserRecord {
  userID: number;
  firstName: string;
  lastName: string;
  email: string;
  notifications: boolean;
  userStatus: string;
  userSites: string;
}

interface AdminSiteRecord {
  siteID: number;
  siteName: string;
  schemaName: string;
}

interface MockRouteResponse<T> {
  statusCode?: number;
  body?: T;
  forceNetworkError?: boolean;
}

interface PatchAdminUsersResult {
  statusCode?: number;
  body?: Record<string, unknown>;
  users?: AdminUserRecord[];
}

interface MockAdminUsersApiOptions {
  users: AdminUserRecord[];
  sites?: AdminSiteRecord[];
  userResponses?: MockRouteResponse<AdminUserRecord[]>[];
  siteResponses?: MockRouteResponse<AdminSiteRecord[]>[];
  patchHandler?: (
    requestBody: { oldRow: Partial<AdminUserRecord>; newRow: Partial<AdminUserRecord> },
    users: AdminUserRecord[]
  ) => PatchAdminUsersResult | void;
}

function cloneUsers(users: AdminUserRecord[]) {
  return users.map(user => ({ ...user }));
}

function cloneSites(sites: AdminSiteRecord[]) {
  return sites.map(site => ({ ...site }));
}

function consumeResponse<T>(responses: MockRouteResponse<T>[] | undefined, index: number) {
  if (!responses || responses.length === 0) return undefined;
  return responses[Math.min(index, responses.length - 1)];
}

function applyUserUpdate(users: AdminUserRecord[], nextUser: Partial<AdminUserRecord>) {
  return users.map(user =>
    user.userID === nextUser.userID
      ? {
          ...user,
          ...nextUser
        }
      : user
  );
}

export function buildAdminUser(overrides: Partial<AdminUserRecord> = {}): AdminUserRecord {
  const userID = overrides.userID ?? 1;

  return {
    userID,
    firstName: overrides.firstName ?? `User${userID}`,
    lastName: overrides.lastName ?? 'Example',
    email: overrides.email ?? `user${userID}@forestgeo.si.edu`,
    notifications: overrides.notifications ?? true,
    userStatus: overrides.userStatus ?? 'field crew',
    userSites: overrides.userSites ?? '1'
  };
}

export function buildAdminSite(overrides: Partial<AdminSiteRecord> = {}): AdminSiteRecord {
  const siteID = overrides.siteID ?? 1;

  return {
    siteID,
    siteName: overrides.siteName ?? 'Luquillo',
    schemaName: overrides.schemaName ?? 'luquillo'
  };
}

export function mockAdminUsersApi({ users, sites = [buildAdminSite()], userResponses, siteResponses, patchHandler }: MockAdminUsersApiOptions) {
  const state = {
    users: cloneUsers(users),
    sites: cloneSites(sites),
    userRequestCount: 0,
    siteRequestCount: 0
  };

  cy.intercept('GET', '**/api/administrative/fetch/users**', req => {
    const response = consumeResponse(userResponses, state.userRequestCount);
    state.userRequestCount += 1;

    if (response?.forceNetworkError) {
      req.reply({ forceNetworkError: true });
      return;
    }

    req.reply({
      statusCode: response?.statusCode ?? 200,
      body: response?.body ?? cloneUsers(state.users)
    });
  }).as('fetchAdminUsers');

  cy.intercept('GET', '**/api/administrative/fetch/sites**', req => {
    const response = consumeResponse(siteResponses, state.siteRequestCount);
    state.siteRequestCount += 1;

    if (response?.forceNetworkError) {
      req.reply({ forceNetworkError: true });
      return;
    }

    req.reply({
      statusCode: response?.statusCode ?? 200,
      body: response?.body ?? cloneSites(state.sites)
    });
  }).as('fetchAdminSites');

  cy.intercept('PATCH', '**/api/administrative/fetch/users**', req => {
    const requestBody = req.body as { oldRow: Partial<AdminUserRecord>; newRow: Partial<AdminUserRecord> };
    const result = patchHandler?.(requestBody, cloneUsers(state.users));
    const statusCode = result?.statusCode ?? 200;

    if (result?.users) {
      state.users = cloneUsers(result.users);
    } else if (statusCode < 400) {
      state.users = applyUserUpdate(state.users, requestBody.newRow);
    }

    req.reply({
      statusCode,
      body:
        result?.body ??
        (statusCode < 400
          ? {
              success: true
            }
          : {
              message: `Failed to save user ${requestBody.newRow.userID}`
            })
    });
  }).as('saveAdminUsers');

  return state;
}
