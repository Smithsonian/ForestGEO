import { ColumnStates } from '@/config/macros';
import { createInitialObject, ResultType } from '@/config/utils';
import { FileRow, RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';

export interface CoreMeasurementsRDS {
  id?: number;
  coreMeasurementID?: number;
  censusID?: number;
  stemID?: number;
  isValidated?: boolean;
  measurementDate?: Date;
  measuredDBH?: number;
  measuredHOM?: number;
  description?: string;
  userDefinedFields?: string;
}

export type CoreMeasurementsResult = ResultType<CoreMeasurementsRDS>;

export interface FailedMeasurementsRDS {
  id?: number;
  failedMeasurementID?: number;
  plotID?: number;
  censusID?: number;
  tag?: string;
  stemTag?: string;
  spCode?: string;
  quadrat?: string;
  x?: number;
  y?: number;
  dbh?: number;
  hom?: number;
  date?: Date | null;
  codes?: string;
  failureReasons?: string;
}

export type FailedMeasurementsResult = ResultType<FailedMeasurementsRDS>;

export function getFailedMeasurementsHCs(): ColumnStates {
  return {
    failedMeasurementID: false,
    plotID: false,
    censusID: false
  };
}

export function getCoreMeasurementsHCs(): ColumnStates {
  return {
    censusID: false,
    stemID: false,
    description: false,
    userDefinedFields: false
  };
}

export interface StagingCoreMeasurementsRDS {
  id?: number;
  stagingMeasurementID?: number;
  censusID?: number;
  stemID?: number;
  measuredDBH?: number;
  measuredHOM?: number;
  measurementDate?: Date;
  description?: string;
  userDefinedFields?: string;
  submittedBy?: number; // ID --> need to pull from catalog.sites
  isReviewed?: boolean;
  isSelected?: boolean;
  submissionDate?: Date;
  reviewerID?: number; // ID --> need to pull from catalog.sites
  reviewedDate?: Date;
}

export type StagingCoreMeasurementsResult = ResultType<StagingCoreMeasurementsRDS>;

export interface CMAttributesRDS {
  id?: number;
  cmaID?: number;
  coreMeasurementID?: number;
  code?: string;
}

export type CMAttributesResult = ResultType<CMAttributesRDS>;

export interface CMAttributesStagingRDS {
  id?: number;
  stagingMeasurementAttributeID?: number;
  stagingMeasurementID?: number;
  code?: string;
}

export type CMAttributesStagingResult = ResultType<CMAttributesStagingRDS>;

export interface CMVErrorRDS {
  id?: number;
  cmvErrorID?: number;
  coreMeasurementID?: number;
  validationErrorID?: number;
}

export type CMVErrorResult = ResultType<CMVErrorRDS>;
const ATTRIBUTES_CODE_LIMIT = 10;
export const validateAttributesRow: ValidationFunction = (row: FileRow) => {
  const errors: RowValidationErrors = {};

  if (row['code'] && row['code'].length > ATTRIBUTES_CODE_LIMIT) {
    errors['code'] = `Code exceeds ${ATTRIBUTES_CODE_LIMIT} characters.`;
  }
  // Allowing NULL for status, otherwise checking for valid values
  if (
    row['status'] !== null &&
    row['status'] !== undefined &&
    !['alive', 'alive-not measured', 'dead', 'stem dead', 'broken below', 'omitted', 'missing'].includes(row['status'])
  ) {
    errors['status'] = 'Invalid status value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export interface AttributesRDS {
  id?: number;
  code?: string;
  description?: string;
  status?: string;
}

export type AttributesResult = ResultType<AttributesRDS>;
export const initialAttributesRDSRow = createInitialObject<AttributesRDS>();
export const AttributeStatusOptions = ['alive', 'alive-not measured', 'dead', 'missing', 'broken below', 'stem dead'];
export const attributesFields = ['code', 'description', 'status'];

export interface UnifiedChangelogRDS {
  id?: number;
  changeID?: number;
  tableName?: string;
  recordID?: string;
  operation?: string;
  oldRowState?: Record<string, any>;
  newRowState?: Record<string, any>;
  changeTimestamp?: Date;
  changedBy?: string;
  plotID?: number;
  censusID?: number;
}

export type UnifiedChangelogResult = ResultType<UnifiedChangelogRDS>;
