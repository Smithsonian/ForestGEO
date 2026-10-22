import { beforeEach, describe, expect, it } from 'vitest';
import { registerSubmittedUploadJob, resetUploadJobCompletionTrackerForTests, takeNewlyFinishedUploadJobIDs } from './uploadjobcompletiontracker';

const REGISTERED_JOB_ID = 101;
const OBSERVED_JOB_ID = 202;
const UNKNOWN_JOB_ID = 303;
const LATE_REGISTRATION_JOB_ID = 404;
const RESET_JOB_ID = 505;
const TERMINAL_STATUS_CASES = [
  ['completed', 601],
  ['failed', 602],
  ['cancelled', 603]
] as const;

describe('uploadjobcompletiontracker (#525 item 6)', () => {
  beforeEach(() => {
    resetUploadJobCompletionTrackerForTests();
  });

  function poll(jobs: Array<{ jobID: number; status: string }>, label: string): number[] {
    const finished = takeNewlyFinishedUploadJobIDs(jobs);
    console.log(`[#525 item 6] ${label}: ${JSON.stringify(jobs)} -> ${JSON.stringify(finished)}`);
    return finished;
  }

  it('forgets submitted, observed and handled jobs when reset, so each test starts empty', () => {
    registerSubmittedUploadJob(RESET_JOB_ID);
    expect(poll([{ jobID: RESET_JOB_ID, status: 'completed' }], 'handled before reset')).toEqual([RESET_JOB_ID]);
    registerSubmittedUploadJob(REGISTERED_JOB_ID);
    expect(poll([{ jobID: OBSERVED_JOB_ID, status: 'running' }], 'observed before reset')).toEqual([]);

    resetUploadJobCompletionTrackerForTests();

    expect(
      poll(
        [
          { jobID: REGISTERED_JOB_ID, status: 'completed' },
          { jobID: OBSERVED_JOB_ID, status: 'completed' }
        ],
        'submitted and observed jobs after reset'
      )
    ).toEqual([]);
    registerSubmittedUploadJob(RESET_JOB_ID);
    expect(poll([{ jobID: RESET_JOB_ID, status: 'completed' }], 'previously handled job after reset')).toEqual([RESET_JOB_ID]);
  });

  it('returns a registered job the first time a poll sees it terminal, and never again', () => {
    registerSubmittedUploadJob(REGISTERED_JOB_ID);
    expect(poll([{ jobID: REGISTERED_JOB_ID, status: 'completed' }], 'first terminal poll')).toEqual([REGISTERED_JOB_ID]);
    expect(poll([{ jobID: REGISTERED_JOB_ID, status: 'completed' }], 'second terminal poll')).toEqual([]);
  });

  it('returns a job seen active and later terminal exactly once', () => {
    expect(poll([{ jobID: OBSERVED_JOB_ID, status: 'running' }], 'active poll')).toEqual([]);
    expect(poll([{ jobID: OBSERVED_JOB_ID, status: 'completed' }], 'terminal poll')).toEqual([OBSERVED_JOB_ID]);
    expect(poll([{ jobID: OBSERVED_JOB_ID, status: 'completed' }], 'repeat terminal poll')).toEqual([]);
  });

  it('never returns a terminal job that was neither registered nor seen active', () => {
    expect(poll([{ jobID: UNKNOWN_JOB_ID, status: 'completed' }], 'pre-existing job')).toEqual([]);
    expect(poll([{ jobID: UNKNOWN_JOB_ID, status: 'completed' }], 'pre-existing job again')).toEqual([]);
  });

  it('returns a job once even when its submit response is registered after a poll already handled it', () => {
    expect(poll([{ jobID: LATE_REGISTRATION_JOB_ID, status: 'running' }], 'active before the 202 arrives')).toEqual([]);
    expect(poll([{ jobID: LATE_REGISTRATION_JOB_ID, status: 'completed' }], 'finished before the 202 arrives')).toEqual([LATE_REGISTRATION_JOB_ID]);
    registerSubmittedUploadJob(LATE_REGISTRATION_JOB_ID);
    expect(poll([{ jobID: LATE_REGISTRATION_JOB_ID, status: 'completed' }], 'after the late registration')).toEqual([]);
  });

  it.each(TERMINAL_STATUS_CASES)('treats %s as finished (job %i)', (terminalStatus, jobID) => {
    registerSubmittedUploadJob(jobID);
    expect(poll([{ jobID, status: terminalStatus }], `${terminalStatus} poll`)).toEqual([jobID]);
  });

  it('ignores a status it does not know, without forgetting the job', () => {
    registerSubmittedUploadJob(REGISTERED_JOB_ID);
    expect(poll([{ jobID: REGISTERED_JOB_ID, status: 'archived' }], 'unknown status')).toEqual([]);
    expect(poll([{ jobID: REGISTERED_JOB_ID, status: 'completed' }], 'then completed')).toEqual([REGISTERED_JOB_ID]);
  });
});
