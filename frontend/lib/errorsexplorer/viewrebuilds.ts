import type { ErrorsExplorerReadScope, RowMutationScope } from '@/config/errorsexplorer';

const REBUILT_VIEWS = ['measurementssummary', 'viewfulltable'] as const;
type RebuiltView = (typeof REBUILT_VIEWS)[number];
const REBUILD_FAILURE_FALLBACK: Record<RebuiltView, string> = {
  measurementssummary: 'Failed to refresh errors explorer data',
  viewfulltable: 'Failed to refresh view full table data'
};

/** What one refresh POST rebuilds: the named measurements' rows (Task 2, R4) or the whole plot census. */
type ViewRebuildBody = { coreMeasurementIDs: number[] } | { plotID: number; censusID: number };

export class ViewRebuildFailedError extends Error {
  readonly view: RebuiltView;
  constructor(view: RebuiltView, message: string) {
    super(message);
    this.name = 'ViewRebuildFailedError';
    this.view = view;
  }
}

function viewRebuildEndpoint(view: RebuiltView, schema: string): string {
  return `/api/refreshviews/${view}/${schema}`;
}

function readFailureMessage(body: unknown, view: RebuiltView): string {
  if (body !== null && typeof body === 'object') {
    const candidate = 'error' in body ? body.error : 'message' in body ? body.message : undefined;
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }
  return REBUILD_FAILURE_FALLBACK[view];
}

async function rebuildView(view: RebuiltView, schema: string, body: ViewRebuildBody): Promise<void> {
  const response = await fetch(viewRebuildEndpoint(view, schema), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (response.ok) return;
  const failureBody: unknown = await response.json().catch(() => null);
  throw new ViewRebuildFailedError(view, readFailureMessage(failureBody, view));
}

/** Each refresh route runs its own transaction, so a caller hears about a failure only once both have settled (P3-2). */
async function rebuildBothViews(schema: string, body: ViewRebuildBody): Promise<void> {
  const settled = await Promise.allSettled(REBUILT_VIEWS.map(view => rebuildView(view, schema, body)));
  const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (firstFailure) throw firstFailure.reason;
}

/**
 * The two client rebuilds after a save or an undo (spec "After a save, an undo or a Clear"); the Clear route rebuilds itself.
 * Only the edited measurement's rows (Task 2, R4): the writers rebuild every other row they change in their own transaction.
 */
export async function requestMeasurementViewRebuilds(scope: RowMutationScope, coreMeasurementIDs: readonly number[]): Promise<void> {
  await rebuildBothViews(scope.schema, { coreMeasurementIDs: [...coreMeasurementIDs] });
}

/** Retry refresh for a pending scope (spec "View rebuild required"): the whole plot census covers every save or undo whose rebuild failed there. */
export async function requestScopeViewRebuilds(scope: RowMutationScope): Promise<void> {
  await rebuildBothViews(scope.schema, { plotID: scope.plotID, censusID: scope.censusID });
}

export function isSameMutationScope(a: RowMutationScope, b: RowMutationScope): boolean {
  return a.schema === b.schema && a.plotID === b.plotID && a.censusID === b.censusID;
}

export function scopeOverlapsRead(pending: RowMutationScope, read: ErrorsExplorerReadScope): boolean {
  return pending.schema === read.schema && pending.plotID === read.plotID && read.censusIDs.includes(pending.censusID);
}

export function addPendingScope(pending: readonly RowMutationScope[], scope: RowMutationScope): RowMutationScope[] {
  return pending.some(entry => isSameMutationScope(entry, scope)) ? [...pending] : [...pending, { ...scope }];
}

export function removePendingScope(pending: readonly RowMutationScope[], scope: RowMutationScope): RowMutationScope[] {
  return pending.filter(entry => !isSameMutationScope(entry, scope));
}
