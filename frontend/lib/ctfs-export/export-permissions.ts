/**
 * Shared schema-export permission helpers for the CTFS export routes.
 *
 * Scope model (placeholder until the PI/data-manager export authority is
 * resolved — Jess/David pending):
 *   - App admins (global / db admin) can export any schema.
 *   - Lead technicians can export schemas in their session-scoped site list.
 */
import type { Session } from 'next-auth';

export function userIsAdmin(session: Session): boolean {
  return session.user?.userStatus === 'global' || session.user?.userStatus === 'db admin';
}

export function userCanExportSchema(session: Session, schema: string): boolean {
  if (userIsAdmin(session)) {
    return true;
  }
  if (session.user?.userStatus !== 'lead technician') {
    return false;
  }
  return (session.user?.sites ?? []).some(site => site.schemaName === schema);
}
