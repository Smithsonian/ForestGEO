// viewfulltableview custom data type
import { ColumnStates } from '@/config/macros';
import { createInitialObject, ResultType } from '@/config/utils';

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

export const initialViewFullTableViewRDS: ViewFullTableViewRDS = createInitialObject<ViewFullTableViewRDS>();

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
