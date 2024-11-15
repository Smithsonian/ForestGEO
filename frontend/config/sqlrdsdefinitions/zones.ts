import { IDataMapper } from '@/config/datamapper';
import { ResultType } from '@/config/utils';
import { RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';
import { AreaSelection, areaSelectionOptions, bitToBoolean, booleanToBit, ColumnStates, UnitSelection, unitSelectionOptions } from '@/config/macros';

export type SitesRDS = {
  siteID?: number;
  siteName?: string;
  schemaName?: string;
  subquadratDimX?: number;
  subquadratDimY?: number;
  dbhUnits?: string;
  homUnits?: string;
  doubleDataEntry?: boolean;
};
export type Site = SitesRDS | undefined;

export interface SitesResult {
  SiteID: any;
  SiteName: any;
  SchemaName: any;
  SQDimX: any;
  SQDimY: any;
  DefaultUOMDBH: any;
  DefaultUOMHOM: any;
  DoubleDataEntry: any;
}

export class SitesMapper implements IDataMapper<SitesRDS, SitesResult> {
  demapData(results: SitesRDS[]): SitesResult[] {
    return results.map(item => ({
      SiteID: item.siteID != undefined ? String(item.siteID) : null,
      SiteName: item.siteName != undefined ? String(item.siteName) : null,
      SchemaName: item.schemaName != undefined ? String(item.schemaName) : null,
      SQDimX: item.subquadratDimX != undefined ? String(item.subquadratDimX) : null,
      SQDimY: item.subquadratDimY != undefined ? String(item.subquadratDimY) : null,
      DefaultUOMDBH: item.dbhUnits != undefined ? String(item.dbhUnits) : null,
      DefaultUOMHOM: item.homUnits != undefined ? String(item.homUnits) : null,
      DoubleDataEntry: item.doubleDataEntry != undefined ? booleanToBit(item.doubleDataEntry) : null
    }));
  }

  mapData(results: SitesResult[], indexOffset: number = 1): SitesRDS[] {
    return results.map((item, index) => ({
      siteID: item.SiteID != null ? Number(item.SiteID) : undefined,
      siteName: item.SiteName != null ? String(item.SiteName) : undefined,
      schemaName: item.SchemaName != null ? String(item.SchemaName) : undefined,
      subquadratDimX: item.SQDimX != null ? Number(item.SQDimX) : undefined,
      subquadratDimY: item.SQDimY != null ? Number(item.SQDimY) : undefined,
      dbhUnits: item.DefaultUOMDBH != null ? String(item.DefaultUOMDBH) : undefined,
      homUnits: item.DefaultUOMHOM != null ? String(item.DefaultUOMHOM) : undefined,
      doubleDataEntry: item.DoubleDataEntry != null ? bitToBoolean(item.DoubleDataEntry) : undefined
    }));
  }
}

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
export type PlotsResult = ResultType<PlotRDS>;
export type QuadratRDS = {
  id?: number;
  quadratID?: number;
  plotID?: number;
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
export type QuadratResult = ResultType<QuadratRDS>;
export type Quadrat = QuadratRDS | undefined;
export const validateQuadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (!row['coordinateunit'] || (row['coordinateunit'] !== null && !unitSelectionOptions.includes(row['coordinateunit'] as UnitSelection))) {
    errors['coordinateunit'] = 'Invalid unit value.';
  }
  if (!row['dimensionunit'] || (row['dimensionunit'] !== null && !unitSelectionOptions.includes(row['dimensionunit'] as UnitSelection))) {
    errors['dimensionunit'] = 'Invalid unit value.';
  }
  if (!row['areaunit'] || (row['areaunit'] !== null && !areaSelectionOptions.includes(row['areaunit'] as AreaSelection))) {
    errors['areaunit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export function getQuadratHCs(): ColumnStates {
  return {
    quadratID: false,
    plotID: false,
    censusID: false
  };
}

export type CensusQuadratRDS = {
  id?: number;
  cqID?: number;
  quadratID?: number;
  censusID?: number;
};
export type CensusQuadratResult = ResultType<CensusQuadratRDS>;

export type SubquadratRDS = {
  id?: number;
  subquadratID?: number;
  subquadratName?: string;
  quadratID?: number;
  dimensionX?: number;
  dimensionY?: number;
  qX?: number;
  qY?: number;
  unit?: string;
  ordering?: number;
};
export type Subquadrat = SubquadratRDS | undefined;
export type SubquadratResult = ResultType<SubquadratRDS>;
export const validateSubquadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (row['unit'] && !unitSelectionOptions.includes(row['unit'] as UnitSelection)) {
    errors['unit'] = 'Invalid unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};
export const subquadratsFields = ['subquadratName', 'dimensionX', 'dimensionY', 'qX', 'qY', 'unit', 'ordering'];
