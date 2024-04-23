import { GridColDef } from "@mui/x-data-grid";


export type SubQuadratRDS = {
  id: number;
  subquadratID: number;
  subquadratName: string;
  quadratID: number | null;
  xIndex: number;
  yIndex: number;
  sqIndex: number;
}

export type Subquadrat = SubQuadratRDS | null;

export const SubQuadratGridColumns: GridColDef[] = [
  {field: 'sqID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'sqName', headerName: 'Name', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratID', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'xIndex', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'yIndex', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'sqIndex', headerName: 'Index', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface SubQuadratResult {
  SQID: any;
  SQName: any;
  QuadratID: any;
  Xindex: any;
  Yindex: any;
  SQindex: any;
}