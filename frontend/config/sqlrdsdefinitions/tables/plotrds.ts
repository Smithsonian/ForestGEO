// plot custom data type
import {IDataMapper} from '../../datamapper';

export type PlotRDS = {
  id?: number;
  plotID?: number;
  plotName?: string;
  locationName?: string;
  countryName?: string;
  dimensionX?: number;
  dimensionY?: number;
  dimensionUnits?: string;
  area?: number;
  areaUnits?: string;
  globalX?: number;
  globalY?: number;
  globalZ?: number;
  coordinateUnits?: string;
  plotShape?: string;
  plotDescription?: string;
  numQuadrats?: number;
  usesSubquadrats?: boolean;
};

export type Plot = PlotRDS | undefined;

export interface PlotsResult {
  PlotID: any;
  PlotName: any;
  LocationName: any;
  CountryName: any;
  DimensionX: any;
  DimensionY: any;
  DimensionUnits: any;
  Area: any;
  AreaUnits: any;
  GlobalX: any;
  GlobalY: any;
  GlobalZ: any;
  CoordinateUnits: any;
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
      dimensionUnits: item.DimensionUnits != null ? String(item.DimensionUnits) : undefined,
      area: item.Area != null ? Number(item.Area) : undefined,
      areaUnits: item.AreaUnits != null ? String(item.AreaUnits) : undefined,
      globalX: item.GlobalX != null ? Number(item.GlobalX) : undefined,
      globalY: item.GlobalY != null ? Number(item.GlobalY) : undefined,
      globalZ: item.GlobalZ != null ? Number(item.GlobalZ) : undefined,
      coordinateUnits: item.CoordinateUnits != null ? String(item.CoordinateUnits) : undefined,
      plotShape: item.PlotShape != null ? String(item.PlotShape) : undefined,
      plotDescription: item.PlotDescription != null ? String(item.PlotDescription) : undefined,
      numQuadrats: item.NumQuadrats !== null ? Number(item.NumQuadrats) : undefined,
      usesSubquadrats: false
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
      DimensionUnits: item.dimensionUnits !== undefined ? String(item.dimensionUnits) : null,
      Area: item.area !== undefined ? Number(item.area) : null,
      AreaUnits: item.areaUnits !== undefined ? String(item.areaUnits) : null,
      GlobalX: item.globalX ? Number(item.globalX) : null,
      GlobalY: item.globalY !== undefined ? Number(item.globalY) : null,
      GlobalZ: item.globalZ !== undefined ? Number(item.globalZ) : null,
      CoordinateUnits: item.coordinateUnits !== undefined ? String(item.coordinateUnits) : null,
      PlotShape: item.plotShape !== undefined ? String(item.plotShape) : null,
      PlotDescription: item.plotDescription !== undefined ? String(item.plotDescription) : null,
      NumQuadrats: item.numQuadrats !== undefined ? Number(item.numQuadrats) : null,
    }));
  }
}

