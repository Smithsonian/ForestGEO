
export type SitesRDS = {
  siteID: number;
  siteName: string;
  schemaName: string;
};
export type Site = SitesRDS | null;

export interface SitesResult {
  SiteID: any;
  SiteName: any;
  SchemaName: any;
}

