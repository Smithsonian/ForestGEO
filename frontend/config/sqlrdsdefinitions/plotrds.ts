import {GridColDef} from '@mui/x-data-grid';


export type PlotRDS = {
  id: number;
  plotID: number;
  plotName: string | null;
  locationName: string | null;
  countryName: string | null;
  dimensionX: number | null;
  dimensionY: number | null;
  area: number | null;
  globalX: number | null;
  globalY: number | null;
  globalZ: number | null;
  plotShape: string | null;
  plotDescription: string | null;
};

export const PlotGridColumns: GridColDef[] = [
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotName', headerName: 'PlotName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'locationName', headerName: 'LocationName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'countryName', headerName: 'CountryName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'globalX', headerName: 'GlobalX', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'globalY', headerName: 'GlobalY', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'globalZ', headerName: 'GlobalZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', flex: 1, align: 'left',},
];// INTERFACES

export interface PlotRaw {
  key: string;
  num: number;
  id: number;
}

export type Plot = PlotRaw | null;

export interface PlotsResult {
  PlotID: any;
  PlotName: any;
  LocationName: any;
  CountryName: any;
  DimensionX: any;
  DimensionY: any;
  Area: any;
  GlobalX: any;
  GlobalY: any;
  GlobalZ: any;
  PlotShape: any;
  PlotDescription: any;
}

