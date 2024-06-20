import {GridColDef} from '@mui/x-data-grid';
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

export class ValidationHistoryMapper implements IDataMapper<ValidationChangelogResult, ValidationChangelogRDS> {
  demapData(results: ValidationChangelogRDS[]): ValidationChangelogResult[] {
    return results.map((item) => ({
      ValidationRunID: item.validationRunID != null ? String(item.validationRunID) : null,
      ProcedureName: item.procedureName != null ? String(item.procedureName) : null,
      RunDateTime: item.runDateTime != null ? item.runDateTime.toISOString() : null,
      TargetRowID: item.targetRowID != null ? String(item.targetRowID) : null,
      ValidationOutcome: item.validationOutcome,
      ErrorMessage: item.errorMessage != null ? String(item.errorMessage) : null,
      ValidationCriteria: item.validationCriteria != null ? String(item.validationCriteria) : null,
      MeasuredValue: item.measuredValue != null ? String(item.measuredValue) : null,
      ExpectedValueRange: item.expectedValueRange != null ? String(item.expectedValueRange) : null,
      AdditionalDetails: item.additionalDetails != null ? String(item.additionalDetails) : null,
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

export const ValidationChangelogGridColumns: GridColDef[] = [
  {field: 'validationRunID', headerName: 'ID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'procedureName', headerName: 'Procedure', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'runDatetime', headerName: 'Date', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'targetRowID', headerName: 'Core Measurement Target', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'errorMessage', headerName: 'Error Message', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'validationCriteria', headerName: 'Validation Criteria', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'measuredValue', headerName: 'Measured', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'expectedValueRange', headerName: 'Expected Range', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'additionalDetails', headerName: 'Details', headerClassName: 'header', flex: 1, align: 'left',},
];
