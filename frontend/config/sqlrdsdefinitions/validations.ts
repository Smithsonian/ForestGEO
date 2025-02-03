import { createInitialObject, ResultType } from '@/config/utils';

export interface PostValidationQueriesRDS {
  id?: number;
  queryID?: number;
  queryName?: string;
  queryDefinition?: string;
  description?: string;
  isEnabled?: boolean;
  lastRunAt?: Date;
  lastRunResult?: string;
  lastRunStatus?: string;
}

export type PostValidationQueriesResult = ResultType<PostValidationQueriesRDS>;

export interface ValidationProceduresRDS {
  id?: number;
  validationID?: number;
  procedureName?: string;
  description?: string;
  criteria?: string;
  definition?: string;
  isEnabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type ValidationProceduresResult = ResultType<ValidationProceduresRDS>;
export const initialValidationProcedure = createInitialObject<ValidationProceduresRDS>();

export interface ValidationChangelogRDS {
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
}

export type ValidationChangelogResult = ResultType<ValidationChangelogRDS>;

export interface SiteSpecificValidationsRDS {
  id?: number;
  validationProcedureID?: number;
  name?: string;
  definition?: string;
  description?: string;
  isEnabled?: boolean;
}

export type SiteSpecificValidationsResult = ResultType<SiteSpecificValidationsRDS>;
export const initialSiteSpecificValidation = createInitialObject<SiteSpecificValidationsRDS>();
