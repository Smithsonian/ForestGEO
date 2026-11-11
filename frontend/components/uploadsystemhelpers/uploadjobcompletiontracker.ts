import type { QueryScope } from '@/lib/query/queryKey';
import { BACKGROUND_JOB_STATUSES, NON_TERMINAL_BACKGROUND_JOB_STATUSES, type BackgroundJobStatus } from '@/lib/background-jobs/types';

/**
 * Tab-lifetime record of background upload jobs, so the job badge refreshes
 * the open grids once per finished job. Job IDs are unique across schemas
 * (catalog.background_jobs), so they are the key. No clock is involved: a
 * job counts if this tab submitted it or saw it active, and a finished job is
 * marked handled in the same synchronous call that returns it.
 */
export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set<BackgroundJobStatus>(NON_TERMINAL_BACKGROUND_JOB_STATUSES);
export const TERMINAL_JOB_STATUSES: ReadonlySet<string> = new Set<BackgroundJobStatus>(
  BACKGROUND_JOB_STATUSES.filter(status => !ACTIVE_JOB_STATUSES.has(status))
);

interface PolledUploadJob {
  jobID: number;
  status: string;
}

const submittedJobIDs = new Set<number>();
const observedActiveJobIDs = new Set<number>();
const handledJobIDs = new Set<number>();

export function registerSubmittedUploadJob(jobID: number): void {
  // The worker starts before the 202 returns, so a poll may already have handled this job.
  if (handledJobIDs.has(jobID)) return;
  submittedJobIDs.add(jobID);
}

export function takeNewlyFinishedUploadJobIDs(jobs: readonly PolledUploadJob[]): number[] {
  const newlyFinishedJobIDs: number[] = [];
  for (const { jobID, status } of jobs) {
    if (handledJobIDs.has(jobID)) continue;
    if (ACTIVE_JOB_STATUSES.has(status)) {
      observedActiveJobIDs.add(jobID);
      continue;
    }
    if (!TERMINAL_JOB_STATUSES.has(status)) continue;
    if (!submittedJobIDs.has(jobID) && !observedActiveJobIDs.has(jobID)) continue;
    submittedJobIDs.delete(jobID);
    observedActiveJobIDs.delete(jobID);
    handledJobIDs.add(jobID);
    newlyFinishedJobIDs.push(jobID);
  }
  return newlyFinishedJobIDs;
}

type FinishedUploadJobListener = (scope: QueryScope) => void;

const finishedUploadJobListeners = new Set<FinishedUploadJobListener>();

/**
 * Lets a grid that keeps its own row accumulator (infinite scroll) reload when
 * a job finishes: SWR invalidation never reaches that accumulator.
 */
export function subscribeToFinishedUploadJobs(listener: FinishedUploadJobListener): () => void {
  finishedUploadJobListeners.add(listener);
  return () => {
    finishedUploadJobListeners.delete(listener);
  };
}

export function announceFinishedUploadJobs(scope: QueryScope): void {
  finishedUploadJobListeners.forEach(listener => listener(scope));
}

/** Test isolation only: production code never forgets a job within a tab. */
export function resetUploadJobCompletionTrackerForTests(): void {
  submittedJobIDs.clear();
  observedActiveJobIDs.clear();
  handledJobIDs.clear();
}
