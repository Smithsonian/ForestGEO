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
  idLevel?: string;
  speciesAuthority?: string;
  validCode?: string;
  subspeciesAuthority?: string;
  fieldFamily?: string;
  description?: string;
};
export type AllTaxonomiesViewResult = ResultType<AllTaxonomiesViewRDS>;

export function getAllTaxonomiesViewHCs(): ColumnStates {
  return {
    speciesID: false,
    familyID: false,
    genusID: false
  };
}

export const validateMeasurementsRow: ValidationFunction = row => {
  const errors: RowValidationErrors = {};
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
  measurementDate?: any;
  measuredDBH?: number;
  measuredHOM?: number;
  isValidated?: boolean;
  description?: string;
  attributes?: string;
};
export type MeasurementsSummaryResult = ResultType<MeasurementsSummaryRDS>;

export function getMeasurementsSummaryViewHCs(): ColumnStates {
  return {
    coreMeasurementID: false,
    plotID: false,
    censusID: false,
    quadratID: false,
    subquadratID: false,
    treeID: false,
    stemID: false,
    personnelID: false,
    speciesID: false
  };
}

export type MeasurementsSummaryStagingRDS = MeasurementsSummaryRDS & {
  submittedBy?: number;
  isReviewed?: boolean;
  isSelected?: boolean;
  submissionDate?: Date;
};

export type _MeasurementsSummaryStagingResult = ResultType<MeasurementsSummaryStagingRDS>;

export function _getMeasurementsSummaryStagingViewHCs(): ColumnStates {
  return {
    ...getMeasurementsSummaryViewHCs(),
    submittedBy: false,
    isReviewed: false,
    isSelected: false,
    submissionDate: false
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
  idLevel?: string;
  fieldFamily?: string;
};

export type ViewFullTableRDS = {
  // datagrid
  id?: number;
  // IDs
  coreMeasurementID?: number;
  plotID?: number;
  censusID?: number;
  quadratID?: number;
  treeID?: number;
  stemID?: number;
  personnelID?: number;
  speciesID?: number;
  genusID?: number;
  familyID?: number;

  // coremeasurements
  measurementDate: any;
  measuredDBH: number;
  measuredHOM: number;
  description: string;
  isValidated: boolean;

  // plots
  plotName?: string;
  locationName?: string;
  countryName?: string;
  dimensionX?: number;
  dimensionY?: number;
  plotArea?: number;
  plotGlobalX?: number;
  plotGlobalY?: number;
  plotGlobalZ?: number;
  plotShape?: string;
  plotDescription?: string;
  defaultDimensionUnits?: string;
  defaultCoordinateUnits?: string;
  defaultAreaUnits?: string;
  defaultDBHUnits?: string;
  defaultHOMUnits?: string;

  // census
  censusStartDate?: any;
  censusEndDate?: any;
  censusDescription?: string;
  plotCensusNumber?: number;

  // quadrats
  quadratName?: string;
  quadratDimensionX?: number;
  quadratDimensionY?: number;
  quadratArea?: number;
  quadratStartX?: number;
  quadratStartY?: number;
  quadratShape?: string;

  // trees
  treeTag?: string;

  // stems
  stemTag?: string;
  stemLocalX?: number;
  stemLocalY?: number;

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

export type ViewFullTableResult = ResultType<ViewFullTableRDS>;

export function getAllViewFullTableViewsHCs(): ColumnStates {
  return {
    coreMeasurementID: false,
    plotID: false,
    censusID: false,
    quadratID: false,
    speciesID: false,
    treeID: false,
    stemID: false,
    personnelID: false,
    familyID: false,
    genusID: false
  };
}
