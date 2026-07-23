import { IDataMapper } from '@/config/datamapper';
import { ResultType } from '@/config/utils';
import { FileRow, RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';
import { bitToBoolean, booleanToBit } from '@/config/macros/bitconversion';
import type { ColumnStates } from '@/config/macros';

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

  mapData(results: SitesResult[], _indexOffset = 1): SitesRDS[] {
    return results.map(item => ({
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

// Row-level fields on the Quadrats upload (see TableHeadersByFormType[FormType.quadrats]).
const QUADRAT_NAME_FIELD = 'quadrat';
const QUADRAT_COORDINATE_FIELDS = ['startx', 'starty'] as const;
const QUADRAT_DIMENSION_FIELDS = ['dimx', 'dimy'] as const;

/**
 * Parses a required numeric upload field. Returns null for missing, blank, or non-numeric
 * input — never 0 — so a blank StartX/StartY cannot be silently coerced to the plot origin.
 * Mirrors lib/provisioning/quadrat-collection-validation.ts#parseRequiredNumber.
 */
function parseRequiredQuadratNumber(row: FileRow, field: string): number | null {
  const raw = row[field];
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Scalar, per-row checks only: a non-blank quadrat name, and StartX/StartY/DimensionX/DimensionY
 * present and numeric with DimensionX/DimensionY strictly positive. Collection-level geometry
 * (bounds against the plot, overlap, duplicate names, reference-corner normalization) is owned by
 * lib/provisioning/quadrat-collection-validation.ts#validateQuadratCollection, not duplicated here.
 */
export const validateQuadratsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (!row[QUADRAT_NAME_FIELD]?.trim()) {
    errors[QUADRAT_NAME_FIELD] = 'Quadrat name is required.';
  }

  for (const field of QUADRAT_COORDINATE_FIELDS) {
    if (parseRequiredQuadratNumber(row, field) === null) {
      errors[field] = `${field} is required and must be numeric.`;
    }
  }

  for (const field of QUADRAT_DIMENSION_FIELDS) {
    const parsed = parseRequiredQuadratNumber(row, field);
    if (parsed === null) {
      errors[field] = `${field} is required and must be numeric.`;
    } else if (parsed <= 0) {
      errors[field] = `${field} must be greater than zero.`;
    }
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

export interface CensusQuadratRDS {
  id?: number;
  cqID?: number;
  quadratID?: number;
  censusID?: number;
}

export type CensusQuadratResult = ResultType<CensusQuadratRDS>;

export interface CensusAttributesRDS {
  id?: number;
  caID?: number;
  quadratID?: number;
  code?: string;
}

export type CensusAttributesResult = ResultType<CensusAttributesRDS>;

export interface CensusPersonnelRDS {
  id?: number;
  cpID?: number;
  personnelID?: number;
  censusID?: number;
}

export type CensusPersonnelResult = ResultType<CensusPersonnelRDS>;

export interface CensusSpeciesRDS {
  id?: number;
  csID?: number;
  speciesID?: number;
  censusID?: number;
}

export type CensusSpeciesResult = ResultType<CensusSpeciesRDS>;
