// quadrat custom data type
import { ColumnStates } from '@/config/macros';
import { RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';
import { createInitialObject, ResultType } from '@/config/utils';

export type QuadratRDS = {
  id?: number;
  quadratID?: number;
  plotID?: number;
  censusID?: number;
  quadratName?: string;
  startX?: number;
  startY?: number;
  coordinateunit?: string;
  dimensionX?: number;
  dimensionY?: number;
  dimensionunit?: string;
  area?: number;
  areaunit?: string;
  quadratShape?: string;
};

export type QuadratsResult = ResultType<QuadratRDS>;

export const initialQuadratRDSRow = createInitialObject<QuadratRDS>();

export type Quadrat = QuadratRDS | undefined;

export const validateQuadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (!row['coordinateunit'] || (row['coordinateunit'] !== null && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['coordinateunit']))) {
    errors['coordinateunit'] = 'Invalid unit value.';
  }
  if (!row['dimensionunit'] || (row['dimensionunit'] !== null && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['dimensionunit']))) {
    errors['dimensionunit'] = 'Invalid unit value.';
  }
  if (!row['areaunit'] || (row['areaunit'] !== null && !['km2', 'hm2', 'dam2', 'm2', 'dm2', 'cm2', 'mm2'].includes(row['areaunit']))) {
    errors['areaunit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export function getQuadratHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false
  };
}
