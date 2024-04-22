import {GridColDef} from '@mui/x-data-grid';


export type StemRDS = {
  id: number;
  stemID: number;
  treeID: number | null;
  subQuadratID: number | null;
  stemNumber: number | null;
  stemTag: string | null;
  localX: number | null;
  localY: number | null;
  moved: boolean | null;
  stemDescription: string | null;
};

export const StemGridColumns: GridColDef[] = [
  // {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemNumber', headerName: 'StemNumber', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemTag', headerName: 'Stem Tag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'treeTag', headerName: 'Tree Tag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'localX', headerName: 'Plot X', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'localY', headerName: 'Plot Y', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'moved', headerName: 'Moved', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface StemResult {
  StemID: any;
  TreeID: any;
  SubQuadratID: any;
  StemNumber: any;
  StemTag: any;
  LocalX: any;
  LocalY: any;
  Moved: any;
  StemDescription: any;
}