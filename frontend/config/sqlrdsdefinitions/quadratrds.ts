import {GridColDef} from '@mui/x-data-grid';
import {PersonnelRDS} from './personnelrds';

export type QuadratsRDS = {
  id: number;
  quadratID: number;
  plotID: number | null;
  censusID: number | null;
  quadratName: string | null;
  dimensionX: number | null;
  dimensionY: number | null;
  area: number | null;
  quadratShape: string | null;
  personnel?: PersonnelRDS[];
};


export const QuadratsGridColumns: GridColDef[] = [
  {field: 'quadratID', headerName: 'ID', headerClassName: 'header', maxWidth: 75, align: 'left',},
  // {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'quadratName',
    headerName: 'Name',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 140,
    align: 'left',
    editable: true
  },
  {
    field: 'dimensionX',
    headerName: 'X',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 125,
    align: 'left',
    editable: true
  },
  {
    field: 'dimensionY',
    headerName: 'Y',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 125,
    align: 'left',
    editable: true
  },
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, maxWidth: 125, align: 'left', editable: true},
  {
    field: 'quadratShape',
    headerName: 'Shape',
    headerClassName: 'header',
    flex: 1,
    maxWidth: 125,
    align: 'left',
    editable: true
  },
];

export interface QuadratRaw {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export type Quadrat = QuadratRaw | null;

export interface QuadratsResult {
  QuadratID: any;
  PlotID: any;
  CensusID: any;
  QuadratName: any;
  DimensionX: any;
  DimensionY: any;
  Area: any;
  QuadratShape: any;
}

