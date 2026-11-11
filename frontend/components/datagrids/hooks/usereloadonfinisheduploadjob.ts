'use client';

import { useEffect } from 'react';
import ailogger from '@/ailogger';
import { subscribeToFinishedUploadJobs } from '@/components/uploadsystemhelpers/uploadjobcompletiontracker';
import type { QueryScope } from '@/lib/query/queryKey';

function isSameScope(first: QueryScope, second: QueryScope): boolean {
  return first.siteSchema === second.siteSchema && first.plotID === second.plotID && first.censusID === second.censusID;
}

export function useReloadOnFinishedUploadJob(gridScope: QueryScope, isInfiniteOn: boolean, reloadInfiniteRows: () => Promise<void>): void {
  useEffect(() => {
    if (!isInfiniteOn) return;
    return subscribeToFinishedUploadJobs(finishedJobScope => {
      if (!isSameScope(finishedJobScope, gridScope)) return;
      reloadInfiniteRows().catch((error: unknown) => {
        ailogger.error(
          '[useReloadOnFinishedUploadJob] Reloading the infinite grid rows after an upload job finished failed',
          error instanceof Error ? error : new Error(String(error))
        );
      });
    });
  }, [gridScope, isInfiniteOn, reloadInfiniteRows]);
}
