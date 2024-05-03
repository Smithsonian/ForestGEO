import { IDataMapper } from "../../datamapper";

export type SitesRDS = {
  siteID: number;
  siteName: string;
  schemaName: string;
  subquadratDimX: number | null;
  subquadratDimY: number | null;
  dbhUnits: string | null;
  homUnits: string | null;
};
export type Site = SitesRDS | null;

export interface SitesResult {
  SiteID: any;
  SiteName: any;
  SchemaName: any;
  SQDimX: any;
  SQDimY: any;
  DefaultUOMDBH: any;
  DefaultUOMHOM: any;
};

export class SitesMapper implements IDataMapper<SitesResult, SitesRDS> {
  demapData(results: SitesRDS[]): SitesResult[] {
    return results.map(item => ({
      SiteID: item.siteID,
      SiteName: item.siteName,
      SchemaName: item.schemaName,
      SQDimX: item.subquadratDimX,
      SQDimY: item.subquadratDimY,
      DefaultUOMDBH: item.dbhUnits,
      DefaultUOMHOM: item.homUnits
    }));
  }
  mapData(results: SitesResult[], indexOffset?: number | undefined): SitesRDS[] {
    return results.map((item) => ({
      siteID: Number(item.SiteID),
      schemaName: String(item.SchemaName),
      siteName: String(item.SiteName),
      subquadratDimX: Number(item.SQDimX),
      subquadratDimY: Number(item.SQDimY),
      dbhUnits: String(item.DefaultUOMDBH),
      homUnits: String(item.DefaultUOMHOM)
    }));
  }
}
