// measurementssummaryview custom data type
import { IDataMapper, parseDate } from '../../datamapper';
import { bitToBoolean, booleanToBit, ColumnStates } from '@/config/macros';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';
import { createInitialObject, ResultType } from '@/config/utils';

export const validateMeasurementsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (row['dbhunit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['dbhunit'])) {
    errors['dbhunit'] = 'Invalid DBH unit value.';
  }
  if (row['homunit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['homunit'])) {
    errors['homunit'] = 'Invalid HOM unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export const initialMeasurementsSummaryViewRDSRow = createInitialObject<MeasurementsSummaryRDS>();
export type MeasurementsSummaryRDS = {
  id?: number;
  coreMeasurementID?: number;
  censusID?: number;
  quadratID?: number;
  plotID?: number;
  treeID?: number;
  stemID?: number;
  speciesID?: number;
  quadratName?: string;
  speciesName?: string;
  subspeciesName?: string;
  speciesCode?: string;
  treeTag?: string;
  stemTag?: string;
  stemLocalX?: number;
  stemLocalY?: number;
  stemUnits?: string;
  measurementDate?: any;
  measuredDBH?: number;
  dbhUnits?: string;
  measuredHOM?: number;
  homUnits?: string;
  isValidated?: boolean;
  description?: string;
  attributes?: string;
};

export type MeasurementsSummaryResult = ResultType<MeasurementsSummaryRDS>;

export function getMeasurementsSummaryViewHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false,
    quadratID: false,
    subquadratID: false,
    treeID: false,
    stemID: false,
    personnelID: false
  };
}
