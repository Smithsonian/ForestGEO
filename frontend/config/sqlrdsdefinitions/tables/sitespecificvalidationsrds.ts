import { ResultType } from '@/config/utils';

export type SiteSpecificValidationsRDS = {
  id?: number;
  validationProcedureID?: number;
  name?: string;
  definition?: string;
  description?: string;
  isEnabled?: boolean;
};

export type SiteSpecificValidationsResult = ResultType<SiteSpecificValidationsRDS>;
