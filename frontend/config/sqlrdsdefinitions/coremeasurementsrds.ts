import {GridColDef} from '@mui/x-data-grid';


export type CoreMeasurementsRDS = {
  id: number;
  coreMeasurementID: number;
  censusID: number | null;
  plotID: number | null;
  quadratID: number | null;
  treeID: number | null;
  stemID: number | null;
  personnelID: number | null;
  isValidated: boolean | null;
  measurementDate: Date | null;
  measuredDBH: number | null;
  measuredHOM: number | null;
  description: string | null;
  userDefinedFields: string | null;
};


export const CoreMeasurementsGridColumns: GridColDef[] = [
  {field: 'coreMeasurementID', headerName: 'CMID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'isValidated', headerName: 'IsValidated', headerClassName: 'header', flex: 1, align: 'left'},
  {
    field: 'measurementDate',
    headerName: 'MeasurementDate',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    valueGetter: (params: any) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left'},
];

export interface CoreMeasurementsResult {
  CoreMeasurementID: any;
  CensusID: any;
  PlotID: any;
  QuadratID: any;
  TreeID: any;
  StemID: any;
  PersonnelID: any;
  IsValidated: any;
  MeasurementDate: any;
  MeasuredDBH: any;
  MeasuredHOM: any;
  Description: any;
  UserDefinedFields: any;
}

