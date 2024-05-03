import {GridColDef} from '@mui/x-data-grid';
import { IDataMapper } from '../../datamapper';


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
  unit: string | null;
  plotShape: string | null;
  plotDescription: string | null;
};

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
  Unit: any;
  PlotShape: any;
  PlotDescription: any;
}

export class PlotsMapper implements IDataMapper<PlotsResult, PlotRDS> {
  mapData(results: PlotsResult[], indexOffset: number = 1): PlotRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      plotID: Number(item.PlotID),
      plotName: String(item.PlotName),
      locationName: String(item.LocationName),
      countryName: String(item.CountryName),
      dimensionX: Number(item.DimensionX),
      dimensionY: Number(item.DimensionY),
      area: Number(item.Area),
      globalX: Number(item.GlobalX),
      globalY: Number(item.GlobalY),
      globalZ: Number(item.GlobalZ),
      unit: String(item.Unit),
      plotShape: String(item.PlotShape),
      plotDescription: String(item.PlotDescription)
    }));
  }
  demapData(results: PlotRDS[]): PlotsResult[] {
    return results.map((item) => ({
      PlotID: Number(item.plotID),
      PlotName: String(item.plotName),
      LocationName: String(item.locationName),
      CountryName: String(item.countryName),
      DimensionX: Number(item.dimensionX),
      DimensionY: Number(item.dimensionY),
      Area: Number(item.area),
      GlobalX: Number(item.globalX),
      GlobalY: Number(item.globalY),
      GlobalZ: Number(item.globalZ),
      Unit: String(item.unit),
      PlotShape: String(item.plotShape),
      PlotDescription: String(item.plotDescription)
    }));
  }
}

export const PlotGridColumns: GridColDef[] = [
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotName', headerName: 'PlotName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'locationName', headerName: 'LocationName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'countryName', headerName: 'CountryName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'globalX', headerName: 'GlobalX', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'globalY', headerName: 'GlobalY', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'globalZ', headerName: 'GlobalZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'unit', headerName: 'Units', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', flex: 1, align: 'left',},
];