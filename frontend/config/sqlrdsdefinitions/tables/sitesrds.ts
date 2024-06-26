import {IDataMapper} from "../../datamapper";

export type SitesRDS = {
  siteID?: number;
  siteName?: string;
  schemaName?: string;
  subquadratDimX?: number;
  subquadratDimY?: number;
  dbhUnits?: string;
  homUnits?: string;
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
}

export class SitesMapper implements IDataMapper<SitesResult, SitesRDS> {
  demapData(results: SitesRDS[]): SitesResult[] {
    return results.map(item => ({
      SiteID: item.siteID != null ? String(item.siteID) : null,
      SiteName: item.siteName != null ? String(item.siteName) : null,
      SchemaName: item.schemaName != null ? String(item.schemaName) : null,
      SQDimX: item.subquadratDimX != null ? String(item.subquadratDimX) : null,
      SQDimY: item.subquadratDimY != null ? String(item.subquadratDimY) : null,
      DefaultUOMDBH: item.dbhUnits != null ? String(item.dbhUnits) : null,
      DefaultUOMHOM: item.homUnits != null ? String(item.homUnits) : null,
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
    }));
  }
}
