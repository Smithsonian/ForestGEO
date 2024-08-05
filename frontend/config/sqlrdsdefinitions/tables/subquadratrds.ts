// subquadrat custom data type
import { ResultType } from '@/config/utils';
import { IDataMapper } from '../../datamapper';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export type SubquadratRDS = {
  id?: number;
  subquadratID?: number;
  subquadratName?: string;
  quadratID?: number;
  dimensionX?: number;
  dimensionY?: number;
  qX?: number;
  qY?: number;
  unit?: string;
  ordering?: number;
};

export type Subquadrat = SubquadratRDS | undefined;

export type SubquadratResult = ResultType<SubquadratRDS>;

export const validateSubquadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (row['unit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['unit'])) {
    errors['unit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export const subquadratsFields = ['subquadratName', 'dimensionX', 'dimensionY', 'qX', 'qY', 'unit', 'ordering'];
