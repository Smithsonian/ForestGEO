// catalog rds types

import { createInitialObject, ResultType } from '@/config/utils';

export type ValidationProceduresRDS = {
  id?: number;
  validationID?: number;
  procedureName?: string;
  description?: string;
  isEnabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ValidationProceduresResult = ResultType<ValidationProceduresRDS>;

export const initialValidationProcedure = createInitialObject<ValidationProceduresRDS>();
