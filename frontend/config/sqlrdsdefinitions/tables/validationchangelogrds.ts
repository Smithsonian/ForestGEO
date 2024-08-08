// validation changelog custom data type

import { ResultType } from '@/config/utils';

export type ValidationChangelogRDS = {
  id?: number;
  validationRunID?: number;
  procedureName?: string;
  runDateTime?: Date;
  targetRowID?: number;
  validationOutcome?: 'Passed' | 'Failed';
  errorMessage?: string;
  validationCriteria?: string;
  measuredValue?: string;
  expectedValueRange?: string;
  additionalDetails?: string;
};

export type ValidationChangelogResult = ResultType<ValidationChangelogRDS>;
