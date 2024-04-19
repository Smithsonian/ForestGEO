import {GridColDef} from '@mui/x-data-grid';


export type StemTreeDetailsRDS = {
  id: number;
  stemID: number;
  stemTag: string;
  treeID: number;
  treeTag: string;
  speciesName: string | null;
  subSpeciesName: string | null;
  quadratName: string | null;
  plotName: string | null;
  locationName: string | null;
  countryName: string | null;
  quadratDimensionX: number | null;
  quadratDimensionY: number | null;
  stemQuadX: number | null;
  stemQuadY: number | null;
  stemDescription: string | null;
};

export const StemTreeDetailsGridColumns: GridColDef[] = [
  {field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeTag', headerName: 'Tree', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'subSpeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratName', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotName', headerName: 'Plot', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'locationName', headerName: 'Location', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'countryName', headerName: 'Country', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionX', headerName: 'QDimX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionY', headerName: 'QDimY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemQuadX', headerName: 'SQuadX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemQuadY', headerName: 'SQuadY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemDescription', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left'},
];

export interface StemTreeDetailsResult {
  StemID: any;
  StemTag: any;
  TreeID: any;
  TreeTag: any;
  SpeciesName: any;
  SubSpeciesName: any;
  QuadratName: any;
  PlotName: any;
  LocationName: any;
  CountryName: any;
  QuadratDimensionX: any;
  QuadratDimensionY: any;
  StemQuadX: any;
  StemQuadY: any;
  StemDescription: any;
}

