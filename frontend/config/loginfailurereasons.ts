// Reason slugs shared between the session callback (which classifies the
// failure), the hub layout (which builds the /loginfailed redirect), and the
// login-failure page (which maps slugs to user-facing messages). Kept
// dependency-free so it is safe to import from both server and client code.
export const LOGIN_FAILURE_REASONS = {
  PERMISSIONS_UNAVAILABLE: 'permissions-unavailable',
  USER_NOT_PROVISIONED: 'user-not-provisioned'
} as const;

export type LoginFailureReason = (typeof LOGIN_FAILURE_REASONS)[keyof typeof LOGIN_FAILURE_REASONS];
