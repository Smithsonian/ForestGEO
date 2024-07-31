// validation changelog custom data type
import {IDataMapper, parseDate} from "../../datamapper";

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

export interface ValidationChangelogResult {
  ValidationRunID: any;
  ProcedureName: any;
  RunDateTime: any;
  TargetRowID: any;
  ValidationOutcome: any;
  ErrorMessage: any;
  ValidationCriteria: any;
  MeasuredValue: any;
  ExpectedValueRange: any;
  AdditionalDetails: any;
}

export class ValidationHistoryMapper implements IDataMapper<ValidationChangelogRDS, ValidationChangelogResult> {
  demapData(results: ValidationChangelogRDS[]): ValidationChangelogResult[] {
    return results.map((item) => ({
      ValidationRunID: item.validationRunID != undefined ? String(item.validationRunID) : null,
      ProcedureName: item.procedureName != undefined ? String(item.procedureName) : null,
      RunDateTime: item.runDateTime != undefined ? item.runDateTime.toISOString() : null,
      TargetRowID: item.targetRowID != undefined ? String(item.targetRowID) : null,
      ValidationOutcome: item.validationOutcome,
      ErrorMessage: item.errorMessage != undefined ? String(item.errorMessage) : null,
      ValidationCriteria: item.validationCriteria != undefined ? String(item.validationCriteria) : null,
      MeasuredValue: item.measuredValue != undefined ? String(item.measuredValue) : null,
      ExpectedValueRange: item.expectedValueRange != undefined ? String(item.expectedValueRange) : null,
      AdditionalDetails: item.additionalDetails != undefined ? String(item.additionalDetails) : null,
    }));
  }

  mapData(results: ValidationChangelogResult[], indexOffset: number = 1): ValidationChangelogRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      validationRunID: item.ValidationRunID != null ? Number(item.ValidationRunID) : undefined,
      procedureName: item.ProcedureName != null ? String(item.ProcedureName) : undefined,
      runDateTime: item.RunDateTime != null ? parseDate(item.RunDateTime) : undefined,
      targetRowID: item.TargetRowID != null ? Number(item.TargetRowID) : undefined,
      validationOutcome: item.ValidationOutcome != null ? item.ValidationOutcome as 'Passed' | 'Failed' : undefined,
      errorMessage: item.ErrorMessage != null ? String(item.ErrorMessage) : undefined,
      validationCriteria: item.ValidationCriteria != null ? String(item.ValidationCriteria) : undefined,
      measuredValue: item.MeasuredValue != null ? String(item.MeasuredValue) : undefined,
      expectedValueRange: item.ExpectedValueRange != null ? String(item.ExpectedValueRange) : undefined,
      additionalDetails: item.AdditionalDetails != null ? String(item.AdditionalDetails) : undefined,
    }));
  }
}

