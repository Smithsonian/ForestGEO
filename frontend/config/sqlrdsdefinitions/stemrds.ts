import {GridColDef} from '@mui/x-data-grid';


export type StemRDS = {
  id: number;
  stemID: number;
  treeID: number | null;
  quadratID: number | null;
  stemNumber: number | null;
  stemTag: string | null;
  stemPlotX: number | null;
  stemPlotY: number | null;
  stemPlotZ: number | null;
  stemQuadX: number | null;
  stemQuadY: number | null;
  stemQuadZ: number | null;
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
  {field: 'stemPlotX', headerName: 'Plot X', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemPlotY', headerName: 'Plot Y', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemPlotZ', headerName: 'StemPlotZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemQuadX', headerName: 'Quadrat X', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemQuadY', headerName: 'Quadrat Y', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemQuadZ', headerName: 'StemQuadZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'moved', headerName: 'Moved', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', flex: 1, align: 'left',},
];
