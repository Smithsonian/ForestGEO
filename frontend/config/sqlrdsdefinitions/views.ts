import { ColumnStates } from '@/config/macros';
import { ResultType } from '@/config/utils';
import { RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';

export type AllTaxonomiesViewRDS = {
  id?: number;
  familyID?: number;
  genusID?: number;
  speciesID?: number;
  family?: string;
  genus?: string;
  genusAuthority?: string;
  speciesCode?: string;
  speciesName?: string;
  subspeciesName?: string;
  speciesIDLevel?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  fieldFamily?: string;
  speciesDescription?: string;
};
export type AllTaxonomiesViewResult = ResultType<AllTaxonomiesViewRDS>;

export function getAllTaxonomiesViewHCs(): ColumnStates {
  return {
    familyID: false,
    genusID: false
  };
}

export const validateMeasurementsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};

  if (row['dbhunit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['dbhunit'])) {
    errors['dbhunit'] = 'Invalid DBH unit value.';
  }
  if (row['homunit'] && !['km', 'hm', 'dam', 'm', 'dm', 'cm', 'mm'].includes(row['homunit'])) {
    errors['homunit'] = 'Invalid HOM unit value.';
  }

  return Object.keys(errors).length > 0 ? errors : null;
};
export type MeasurementsSummaryRDS = {
  id?: number;
  coreMeasurementID?: number;
  censusID?: number;
  quadratID?: number;
  plotID?: number;
  treeID?: number;
  stemID?: number;
  speciesID?: number;
  quadratName?: string;
  speciesName?: string;
  subspeciesName?: string;
  speciesCode?: string;
  treeTag?: string;
  stemTag?: string;
  stemLocalX?: number;
  stemLocalY?: number;
  stemUnits?: string;
  measurementDate?: any;
  measuredDBH?: number;
  dbhUnits?: string;
  measuredHOM?: number;
  homUnits?: string;
  isValidated?: boolean;
  description?: string;
  attributes?: string;
};
export type MeasurementsSummaryResult = ResultType<MeasurementsSummaryRDS>;

export function getMeasurementsSummaryViewHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false,
    quadratID: false,
    subquadratID: false,
    treeID: false,
    stemID: false,
    personnelID: false,
    dbhUnits: false,
    homUnits: false
  };
}

export type StemTaxonomiesViewRDS = {
  id?: number;
  stemID?: number;
  treeID?: number;
  speciesID?: number;
  genusID?: number;
  familyID?: number;
  quadratID?: number;
  stemTag?: string;
  treeTag?: string;
  speciesCode?: string;
  family?: string;
  genus?: string;
  speciesName?: string;
  subspeciesName?: string;
  validCode?: string;
  genusAuthority?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  speciesIDLevel?: string;
  speciesFieldFamily?: string;
};
export type StemTaxonomiesViewResult = ResultType<StemTaxonomiesViewRDS>;

export function getStemTaxonomiesViewHCs(): ColumnStates {
  return {
    treeID: false,
    speciesID: false,
    familyID: false,
    genusID: false,
    quadratName: false,
    plotName: false,
    locationName: false,
    countryName: false,
    quadratDimensionX: false,
    quadratDimensionY: false,
    stemQuadX: false,
    stemQuadY: false,
    stemDescription: false
  };
}

/**
 * materialized view --> do this before batch updates to make sure that refresh function isn't called for each row
 * INSERT INTO batchprocessingflag (flag_status) VALUES ('STARTED')
 ON DUPLICATE KEY UPDATE flag_status = 'STARTED';
 */

export type ViewFullTableViewRDS = {
  // datagrid
  id?: number;
  // IDs
  coreMeasurementID?: number;
  plotID?: number;
  censusID?: number;
  quadratID?: number;
  subquadratID?: number;
  treeID?: number;
  stemID?: number;
  personnelID?: number;
  speciesID?: number;
  genusID?: number;
  familyID?: number;
  // coremeasurements
  measurementDate: any;
  measuredDBH: number;
  dbhUnits: string;
  measuredHOM: number;
  homUnits: string;
  description: string;
  isValidated: boolean;
  // plots
  plotName?: string;
  locationName?: string;
  countryName?: string;
  dimensionX?: number;
  dimensionY?: number;
  PlotDimensionUnits?: string;
  plotArea?: number;
  plotAreaUnits?: string;
  plotGlobalX?: number;
  plotGlobalY?: number;
  plotGlobalZ?: number;
  plotCoordinateUnits?: string;
  plotShape?: string;
  plotDescription?: string;
  // census
  censusStartDate?: any;
  censusEndDate?: any;
  censusDescription?: string;
  plotCensusNumber?: number;
  // quadrats
  quadratName?: string;
  quadratDimensionX?: number;
  quadratDimensionY?: number;
  quadratDimensionUnits?: string;
  quadratArea?: number;
  quadratAreaUnits?: string;
  quadratStartX?: number;
  quadratStartY?: number;
  quadratCoordinateUnits?: string;
  quadratShape?: string;
  // subquadrats
  subquadratName?: string;
  subquadratDimensionX?: number;
  subquadratDimensionY?: number;
  subquadratDimensionUnits?: string;
  subquadratX?: number;
  subquadratY?: number;
  subquadratCoordinateUnits?: string;
  // trees
  treeTag?: string;
  // stems
  stemTag?: string;
  stemLocalX?: number;
  stemLocalY?: number;
  stemCoordinateUnits?: string;
  // personnel
  firstName?: string;
  lastName?: string;
  // roles
  personnelRoles?: string;
  // species
  speciesCode?: string;
  speciesName?: string;
  subspeciesName?: string;
  subspeciesAuthority?: string;
  idLevel?: string;
  // genus
  genus?: string;
  genusAuthority?: string;
  // family
  family?: string;
  // attributes
  attributeCode?: string;
  attributeDescription?: string;
  attributeStatus?: string;
};
export type ViewFullTableViewResult = ResultType<ViewFullTableViewRDS>;

export function getAllViewFullTableViewsHCs(): ColumnStates {
  return {
    plotID: false,
    censusID: false,
    quadratID: false,
    subquadratID: false,
    speciesID: false,
    treeID: false,
    stemID: false,
    personnelID: false,
    familyID: false,
    genusID: false,
    subquadratName: false,
    subquadratDimensionX: false,
    subquadratDimensionY: false,
    subquadratDimensionUnits: false,
    subquadratX: false,
    subquadratY: false,
    subquadratCoordinateUnits: false
  };
}
