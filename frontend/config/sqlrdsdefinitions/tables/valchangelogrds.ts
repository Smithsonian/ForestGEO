import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper, parseDate } from "../../datamapper";

export type ValidationChangelogRDS = {
  id: number;
  validationRunID: number;
  procedureName: string;
  runDateTime: Date;
  targetRowID: number | null;
  validationOutcome: 'Passed' | 'Failed' | null;
  errorMessage: string | null;
  validationCriteria: string | null;
  measuredValue: string | null;
  expectedValueRange: string | null;
  additionalDetails: string | null;
};

export const ValidationChangelogGridColumns: GridColDef[] = [
  { field: 'validationRunID', headerName: 'ID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'procedureName', headerName: 'Procedure', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'runDatetime', headerName: 'Date', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'targetRowID', headerName: 'Core Measurement Target', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'errorMessage', headerName: 'Error Message', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'validationCriteria', headerName: 'Validation Criteria', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'measuredValue', headerName: 'Measured', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'expectedValueRange', headerName: 'Expected Range', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'additionalDetails', headerName: 'Details', headerClassName: 'header', flex: 1, align: 'left', },
];

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
      ValidationRunID: String(item.validationRunID),
      ProcedureName: item.procedureName,
      RunDateTime: item.runDateTime.toISOString(),
      TargetRowID: String(item.targetRowID),
      ValidationOutcome: item.validationOutcome,
      ErrorMessage: item.errorMessage,
      ValidationCriteria: item.validationCriteria,
      MeasuredValue: item.measuredValue,
      ExpectedValueRange: item.expectedValueRange,
      AdditionalDetails: item.additionalDetails
    }));
  }
  mapData(results: ValidationChangelogResult[], indexOffset: number = 1): ValidationChangelogRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      validationRunID: Number(item.ValidationRunID),
      procedureName: String(item.ProcedureName),
      runDateTime: parseDate(item.RunDateTime)!,
      targetRowID: Number(item.TargetRowID),
      validationOutcome: <'Passed' | 'Failed' | null>(item.ValidationOutcome),
      errorMessage: String(item.ErrorMessage),
      validationCriteria: String(item.ValidationCriteria),
      measuredValue: String(item.MeasuredValue),
      expectedValueRange: String(item.ExpectedValueRange),
      additionalDetails: String(item.AdditionalDetails),
    }));
  }
}
