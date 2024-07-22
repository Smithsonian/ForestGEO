// quadrat custom data type
import { IDataMapper } from "../../datamapper";
import { ColumnStates } from '@/config/macros';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export type QuadratRDS = {
  id?: number;
  quadratID?: number;
  plotID?: number;
  censusID?: number;
  quadratName?: string;
  startX?: number;
  startY?: number;
  coordinateUnits?: string;
  dimensionX?: number;
  dimensionY?: number;
  dimensionUnits?: string;
  area?: number;
  areaUnits?: string;
  quadratShape?: string;
};

export interface QuadratsResult {
  QuadratID: any;
  PlotID: any;
  CensusID: any;
  QuadratName: any;
  StartX: any;
  StartY: any;
  CoordinateUnits: any;
  DimensionX: any;
  DimensionY: any;
  DimensionUnits: any;
  Area: any;
  AreaUnits: any;
  QuadratShape: any;
}

export class QuadratsMapper implements IDataMapper<QuadratsResult, QuadratRDS> {
  mapData(results: any[], indexOffset: number = 1): QuadratRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      quadratName: item.QuadratName != null ? String(item.QuadratName) : undefined,
      startX: item.StartX != null ? Number(item.StartX) : undefined,
      startY: item.StartY != null ? Number(item.StartY) : undefined,
      coordinateUnits: item.CoordinateUnits != null ? String(item.CoordinateUnits) : undefined,
      dimensionX: item.DimensionX != null ? Number(item.DimensionX) : undefined,
      dimensionY: item.DimensionY != null ? Number(item.DimensionY) : undefined,
      dimensionUnits: item.DimensionUnits != null ? String(item.DimensionUnits) : undefined,
      area: item.Area != null ? Number(item.Area) : undefined,
      areaUnits: item.AreaUnits != null ? String(item.AreaUnits) : undefined,
      quadratShape: item.QuadratShape != null ? String(item.QuadratShape) : undefined,
      // personnel: personnelWithId
    }));
  }

  demapData(results: QuadratRDS[]): any[] {
    return results.map(quadrat => ({
      QuadratID: quadrat.quadratID !== undefined ? Number(quadrat.quadratID) : null,
      PlotID: quadrat.plotID !== undefined ? Number(quadrat.plotID) : null,
      CensusID: quadrat.censusID !== undefined ? Number(quadrat.censusID) : null,
      QuadratName: quadrat.quadratName !== undefined ? String(quadrat.quadratName) : null,
      StartX: quadrat.startX !== undefined ? Number(quadrat.startX) : null,
      StartY: quadrat.startY !== undefined ? Number(quadrat.startY) : null,
      CoordinateUnits: quadrat.coordinateUnits !== undefined ? String(quadrat.coordinateUnits) : null,
      DimensionX: quadrat.dimensionX !== undefined ? Number(quadrat.dimensionX) : null,
      DimensionY: quadrat.dimensionY !== undefined ? Number(quadrat.dimensionY) : null,
      DimensionUnits: quadrat.dimensionUnits !== undefined ? String(quadrat.dimensionUnits) : null,
      Area: quadrat.area !== undefined ? Number(quadrat.area) : null,
      AreaUnits: quadrat.areaUnits !== undefined ? String(quadrat.areaUnits) : null,
      QuadratShape: quadrat.quadratShape !== undefined ? String(quadrat.quadratShape) : null,
      // Personnel: JSON.stringify(quadrat.personnel)
    }));
  }
}

export const initialQuadratRDSRow: QuadratRDS = {
  id: 0,
  quadratID: 0,
  plotID: 0,
  censusID: 0,
  quadratName: '',
  startX: 0,
  startY: 0,
  coordinateUnits: 'm',
  dimensionX: 0,
  dimensionY: 0,
  dimensionUnits: 'm',
  area: 0,
  areaUnits: 'm',
  quadratShape: '',
};

export interface QuadratRaw {
  quadratID: number;
  plotID: number;
  quadratName: string;
}

export type Quadrat = QuadratRDS | undefined;

export const validateQuadratsRow: ValidationFunction = (row) => {
  const errors: RowValidationErrors = {};

  if (row['unit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['unit'])) {
    errors['unit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export const quadratsFields = [
  'quadratName',
  'startX',
  'startY',
  'coordinateUnits',
  'dimensionX',
  'dimensionY',
  'dimensionUnits',
  'area',
  'areaUnits',
  'quadratShape',
];

export function getQuadratHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false
  };
}