// quadrat custom data type
import { IDataMapper } from '../../datamapper';
import { ColumnStates } from '@/config/macros';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';
import { createInitialObject, ResultType } from '@/config/utils';

export type QuadratRDS = {
  id?: number;
  quadratID?: number;
  plotID?: number;
  censusID?: number;
  quadratName?: string;
  startX?: number;
  startY?: number;
  coordinateUnits?: string;
  dimensionX?: number;
  dimensionY?: number;
  dimensionUnits?: string;
  area?: number;
  areaUnits?: string;
  quadratShape?: string;
};

export type QuadratsResult = ResultType<QuadratRDS>;

export const initialQuadratRDSRow = createInitialObject<QuadratRDS>();

export interface QuadratRaw {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export type Quadrat = QuadratRDS | undefined;

export const validateQuadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (row['unit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['unit'])) {
    errors['unit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export const quadratsFields = [
  'quadratName',
  'startX',
  'startY',
  'coordinateUnits',
  'dimensionX',
  'dimensionY',
  'dimensionUnits',
  'area',
  'areaUnits',
  'quadratShape'
];

export function getQuadratHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false
  };
}
