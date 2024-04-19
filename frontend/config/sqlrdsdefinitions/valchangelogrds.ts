import {GridColDef} from '@mui/x-data-grid';


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
