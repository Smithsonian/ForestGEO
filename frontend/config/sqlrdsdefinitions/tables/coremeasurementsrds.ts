// core measurements custom data type
import { createInitialObject, ResultType } from '@/config/utils';
import { ColumnStates } from '@/config/macros';

export type CoreMeasurementsRDS = {
  id?: number;
  coreMeasurementID?: number;
  censusID?: number;
  stemID?: number;
  isValidated?: boolean;
  measurementDate?: Date;
  measuredDBH?: number;
  dbhUnit?: string;
  measuredHOM?: number;
  homUnit?: string;
  description?: string;
  userDefinedFields?: string;
};

export type CoreMeasurementsResult = ResultType<CoreMeasurementsRDS>;

export const initialCoreMeasurementsRDSRow = createInitialObject<CoreMeasurementsRDS>();

export function getCoreMeasurementsHCs(): ColumnStates {
  return {
    censusID: false,
    description: false,
    userDefinedFields: false
  };
}
