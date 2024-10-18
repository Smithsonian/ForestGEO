import { createInitialObject, ResultType } from '@/config/utils';

export type PostValidationQueriesRDS = {
  id?: number;
  queryID?: number;
  queryName?: string;
  queryDefinition?: string;
  description?: string;
  isEnabled?: boolean;
  lastRunAt?: Date;
  lastRunResult?: string;
  lastRunStatus?: string;
};
export type PostValidationQueriesResult = ResultType<PostValidationQueriesRDS>;

export type ValidationProceduresRDS = {
  id?: number;
  validationID?: number;
  procedureName?: string;
  description?: string;
  definition?: string;
  isEnabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};
export type ValidationProceduresResult = ResultType<ValidationProceduresRDS>;
export const initialValidationProcedure = createInitialObject<ValidationProceduresRDS>();
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
export type SiteSpecificValidationsRDS = {
  id?: number;
  validationProcedureID?: number;
  name?: string;
  definition?: string;
  description?: string;
  isEnabled?: boolean;
};
export type SiteSpecificValidationsResult = ResultType<SiteSpecificValidationsRDS>;
export const initialSiteSpecificValidation = createInitialObject<SiteSpecificValidationsRDS>();
