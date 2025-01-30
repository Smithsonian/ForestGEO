import { IDataMapper } from '@/config/datamapper';
import { ResultType } from '@/config/utils';
import { RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';
import { bitToBoolean, booleanToBit, ColumnStates } from '@/config/macros';

export interface SitesRDS {
  siteID?: number;
  siteName?: string;
  schemaName?: string;
  subquadratDimX?: number;
  subquadratDimY?: number;
  doubleDataEntry?: boolean;
}
export type Site = SitesRDS | undefined;

export interface SitesResult {
  SiteID: any;
  SiteName: any;
  SchemaName: any;
  SQDimX: any;
  SQDimY: any;
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
      DoubleDataEntry: item.doubleDataEntry != undefined ? booleanToBit(item.doubleDataEntry) : null
    }));
  }

  mapData(results: SitesResult[], indexOffset = 1): SitesRDS[] {
    return results.map((item, index) => ({
      siteID: item.SiteID != null ? Number(item.SiteID) : undefined,
      siteName: item.SiteName != null ? String(item.SiteName) : undefined,
      schemaName: item.SchemaName != null ? String(item.SchemaName) : undefined,
      subquadratDimX: item.SQDimX != null ? Number(item.SQDimX) : undefined,
      subquadratDimY: item.SQDimY != null ? Number(item.SQDimY) : undefined,
      doubleDataEntry: item.DoubleDataEntry != null ? bitToBoolean(item.DoubleDataEntry) : undefined
    }));
  }
}

export interface PlotRDS {
  id?: number;
  plotID?: number;
  // plot name & location
  plotName?: string;
  locationName?: string;
  countryName?: string;
  plotShape?: string;
  plotDescription?: string;
  // plot area
  dimensionX?: number;
  dimensionY?: number;
  area?: number;
  // plot coordinates
  globalX?: number;
  globalY?: number;
  globalZ?: number;
  // default units
  defaultDimensionUnits?: string;
  defaultCoordinateUnits?: string;
  defaultAreaUnits?: string;
  defaultDBHUnits?: string;
  defaultHOMUnits?: string;
  // # of quadrats
  numQuadrats?: number;
  usesSubquadrats?: boolean;
}
export type Plot = PlotRDS | undefined;
export type PlotsResult = ResultType<PlotRDS>;
export interface QuadratRDS {
  id?: number;
  quadratID?: number;
  plotID?: number;
  quadratName?: string;
  startX?: number;
  startY?: number;
  dimensionX?: number;
  dimensionY?: number;
  area?: number;
  quadratShape?: string;
}
export type QuadratResult = ResultType<QuadratRDS>;
export type Quadrat = QuadratRDS | undefined;
export const validateQuadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};
  return Object.keys(errors).length > 0 ? errors : null;
};

export function getQuadratHCs(): ColumnStates {
  return {
    quadratID: false,
    plotID: false,
    censusID: false
  };
}

export interface CensusQuadratRDS {
  id?: number;
  cqID?: number;
  quadratID?: number;
  censusID?: number;
}
export type CensusQuadratResult = ResultType<CensusQuadratRDS>;
