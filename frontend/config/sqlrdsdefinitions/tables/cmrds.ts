import {GridColDef} from '@mui/x-data-grid';

export type CMAttributesRDS = {
  id: number;
  cmaID: number;
  coreMeasurementID: number | null;
  code: string | null;
};

export const CMAttributeGridColumns: GridColDef[] = [
  {field: 'cmaID', headerName: 'CMAID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'code', headerName: 'Code', headerClassName: 'header', flex: 1, align: 'left'},
];

export interface CMAttributesResult {
  CMAID: any;
  CoreMeasurementID: any;
  Code: any;
}

export type CMVErrorRDS = {
  id: number;
  cmvErrorID: number;
  coreMeasurementID: number | null;
  validationErrorID: number | null;
};

export const CMVErrorGridColumns: GridColDef[] = [
  {field: 'cmvErrorID', headerName: 'CMVErrorID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1, align: 'left'},
];

export interface CMVErrorResult {
  CMVErrorID: any;
  CoreMeasurementID: any;
  ValidationErrorID: any;
}