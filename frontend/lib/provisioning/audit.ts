import ailogger from '@/ailogger';

export type ProvisioningAction = 'start' | 'retry' | 'abort' | 'teardown' | 'mark_failed' | 'reconcile' | 'schema_drop';

export interface AuditContext {
  action: ProvisioningAction;
  user: string;
  runId?: number;
  schemaName?: string;
  error?: Error;
}

function compact(ctx: AuditContext): Record<string, unknown> {
  const out: Record<string, unknown> = { action: ctx.action, user: ctx.user };
  if (ctx.runId !== undefined) out.runId = ctx.runId;
  if (ctx.schemaName !== undefined) out.schemaName = ctx.schemaName;
  if (ctx.error) out.errorMessage = ctx.error.message;
  return out;
}

export function auditAttempt(ctx: AuditContext): void {
  ailogger.info('provisioning.attempt', compact(ctx));
}

export function auditSuccess(ctx: AuditContext): void {
  ailogger.info('provisioning.success', compact(ctx));
}

export function auditFailure(ctx: AuditContext): void {
  ailogger.warn('provisioning.failure', compact(ctx));
}
