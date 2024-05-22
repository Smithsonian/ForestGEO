import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from '../../datamapper';
import { unitSelectionOptions } from '@/config/macros';

export type PlotRDS = {
  id?: number;
  plotID?: number;
  plotName?: string;
  locationName?: string;
  countryName?: string;
  dimensionX?: number;
  dimensionY?: number;
  area?: number;
  globalX?: number;
  globalY?: number;
  globalZ?: number;
  unit?: string;
  plotShape?: string;
  plotDescription?: string;
  numQuadrats?: number;
};

export interface PlotRaw {
  key: string;
  num: number;
  id: number;
}

export type Plot = PlotRDS | undefined;

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
  NumQuadrats: any;
}

export class PlotsMapper implements IDataMapper<PlotsResult, PlotRDS> {
  mapData(results: PlotsResult[], indexOffset: number = 1): PlotRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      plotName: item.PlotName != null ? String(item.PlotName) : undefined,
      locationName: item.LocationName != null ? String(item.LocationName) : undefined,
      countryName: item.CountryName != null ? String(item.CountryName) : undefined,
      dimensionX: item.DimensionX != null ? Number(item.DimensionX) : undefined,
      dimensionY: item.DimensionY != null ? Number(item.DimensionY) : undefined,
      area: item.Area != null ? Number(item.Area) : undefined,
      globalX: item.GlobalX != null ? Number(item.GlobalX) : undefined,
      globalY: item.GlobalY != null ? Number(item.GlobalY) : undefined,
      globalZ: item.GlobalZ != null ? Number(item.GlobalZ) : undefined,
      unit: item.Unit != null ? String(item.Unit) : undefined,
      plotShape: item.PlotShape != null ? String(item.PlotShape) : undefined,
      plotDescription: item.PlotDescription != null ? String(item.PlotDescription) : undefined,
      numQuadrats: item.NumQuadrats !== null ? Number(item.NumQuadrats) : undefined,
    }));
  }

  demapData(results: PlotRDS[]): PlotsResult[] {
    return results.map((item) => ({
      PlotID: item.plotID !== undefined ? Number(item.plotID) : null,
      PlotName: item.plotName !== undefined ? String(item.plotName) : null,
      LocationName: item.locationName !== undefined ? String(item.locationName) : null,
      CountryName: item.countryName !== undefined ? String(item.countryName) : null,
      DimensionX: item.dimensionX !== undefined ? Number(item.dimensionX) : null,
      DimensionY: item.dimensionY !== undefined ? Number(item.dimensionY) : null,
      Area: item.area !== undefined ? Number(item.area) : null,
      GlobalX: item.globalX ? Number(item.globalX) : null,
      GlobalY: item.globalY !== undefined ? Number(item.globalY) : null,
      GlobalZ: item.globalZ !== undefined ? Number(item.globalZ) : null,
      Unit: item.unit !== undefined ? String(item.unit) : null,
      PlotShape: item.plotShape !== undefined ? String(item.plotShape) : null,
      PlotDescription: item.plotDescription !== undefined ? String(item.plotDescription) : null,
      NumQuadrats: item.numQuadrats !== undefined ? Number(item.numQuadrats) : null,
    }));
  }
}

export const PlotGridColumns: GridColDef[] = [
  { field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'plotName', headerName: 'PlotName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'locationName', headerName: 'LocationName', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'countryName', headerName: 'CountryName', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'dimensionX', headerName: 'DimX', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'dimensionY', headerName: 'DimY', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'globalX', headerName: 'GlobalX', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'globalY', headerName: 'GlobalY', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'globalZ', headerName: 'GlobalZ', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'unit', headerName: 'Units', headerClassName: 'header', flex: 1, align: 'left', type: 'singleSelect', valueOptions: unitSelectionOptions },
  { field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
];