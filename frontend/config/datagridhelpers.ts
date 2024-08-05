/**
 * Defines templates for new rows in data grids
 */
// datagridhelpers.ts
import { GridRowModel, GridToolbarProps } from "@mui/x-data-grid";
import { coreMeasurementsFields } from "./sqlrdsdefinitions/tables/coremeasurementsrds";
import { attributesFields } from "./sqlrdsdefinitions/tables/attributerds";
import { censusFields } from "./sqlrdsdefinitions/tables/censusrds";
import { personnelFields } from "./sqlrdsdefinitions/tables/personnelrds";
import { getQuadratHCs, quadratsFields } from "./sqlrdsdefinitions/tables/quadratrds";
import { speciesFields } from "./sqlrdsdefinitions/tables/speciesrds";
import { subquadratsFields } from "./sqlrdsdefinitions/tables/subquadratrds";
import { allTaxonomiesFields, stemTaxonomiesViewFields } from "@/components/processors/processorhelperfunctions";
import { getAllTaxonomiesViewHCs } from "./sqlrdsdefinitions/views/alltaxonomiesviewrds";
import { getMeasurementsSummaryViewHCs } from "./sqlrdsdefinitions/views/measurementssummaryviewrds";
import { getStemTaxonomiesViewHCs } from "./sqlrdsdefinitions/views/stemtaxonomiesviewrds";
import { getAllViewFullTableViewsHCs } from "./sqlrdsdefinitions/views/viewfulltableviewrds";

export interface FieldTemplate {
  type: "string" | "number" | "boolean" | "array" | "date" | "unknown";
  initialValue?: string | number | boolean | any[] | null;
}

export interface Templates {
  [gridType: string]: {
    [fieldName: string]: FieldTemplate;
  };
}

export type FetchQueryFunction = (
  siteSchema: string,
  gridType: string,
  page: number,
  pageSize: number,
  plotID?: number,
  censusID?: number,
  quadratID?: number
) => string;
export type ProcessPostPatchQueryFunction = (
  // incorporated validation system into this too
  siteSchema: string,
  dataType: string,
  gridID: string
) => string;
export type ProcessDeletionQueryFunction = (siteSchema: string, dataType: string, gridID: string, deletionID: number | string) => string;

export interface EditToolbarProps extends GridToolbarProps {
  locked?: boolean;
  handleAddNewRow: () => void;
  handleRefresh: () => Promise<void>;
}

const columnVisibilityMap: { [key: string]: { [key: string]: boolean } } = {
  default: {
    id: false
  },
  viewfulltableview: {
    id: false,
    ...getAllViewFullTableViewsHCs()
  },
  // views
  alltaxonomiesview: {
    id: false,
    ...getAllTaxonomiesViewHCs()
  },
  measurementssummaryview: {
    id: false,
    ...getMeasurementsSummaryViewHCs()
  },
  stemtaxonomiesview: {
    id: false,
    ...getStemTaxonomiesViewHCs()
  },
  quadrats: {
    id: false,
    ...getQuadratHCs()
  }
};

export const getColumnVisibilityModel = (gridType: string): { [key: string]: boolean } => {
  return columnVisibilityMap[gridType] || columnVisibilityMap.default;
};

export const createPostPatchQuery: ProcessPostPatchQueryFunction = (siteSchema: string, dataType: string, gridID: string) => {
  return `/api/fixeddata/${dataType}/${siteSchema}/${gridID}`;
};
export const createFetchQuery: FetchQueryFunction = (siteSchema: string, gridType, page, pageSize, plotID?, plotCensusNumber?, quadratID?: number) => {
  return `/api/fixeddata/${gridType.toLowerCase()}/${siteSchema}/${page}/${pageSize}/${plotID}/${plotCensusNumber}` + `${quadratID ? `/${quadratID}` : ``}`;
};

export const createDeleteQuery: ProcessDeletionQueryFunction = (siteSchema: string, gridType: string, deletionID: number | string) => {
  return `/api/fixeddata/${gridType}/${siteSchema}/${deletionID}`;
};

export function getGridID(gridType: string): string {
  switch (gridType.trim()) {
    case "coremeasurements":
    case "measurementssummaryview":
    case "viewfulltableview":
    case "measurementssummary": // materialized view --> should not be modified
    case "viewfulltable": // materialized view --> should not be modified
      return "coreMeasurementID";
    case "stemtaxonomiesview":
      return "stemID";
    case "attributes":
      return "code";
    case "census":
      return "censusID";
    case "personnel":
      return "personnelID";
    case "quadrats":
      return "quadratID";
    case "quadratpersonnel":
      return "quadratPersonnelID";
    case "subquadrats":
      return "subquadratID";
    case "alltaxonomiesview":
    case "species":
      return "speciesID";
    default:
      return "breakage";
  }
}

const comparePersonnelObjects = (obj1: any, obj2: any) => {
  return Object.entries(obj1).some(([key, value]) => obj2[key] !== value);
};

export function computeMutation(gridType: string, newRow: GridRowModel, oldRow: GridRowModel) {
  switch (gridType) {
    case "coremeasurements":
      return coreMeasurementsFields.some(field => newRow[field] !== oldRow[field]);
    case "attributes":
      return attributesFields.some(field => newRow[field] !== oldRow[field]);
    case "census":
      return censusFields.some(field => newRow[field] !== oldRow[field]);
    case "personnel":
      return personnelFields.some(field => newRow[field] !== oldRow[field]);
    case "quadrats":
      return quadratsFields.some(field => {
        if (field === "personnel") {
          // Special handling for 'personnel' field, which is an array
          return comparePersonnelObjects(newRow[field], oldRow[field]);
        }
        return newRow[field] !== oldRow[field];
      });
    case "subquadrats":
      return subquadratsFields.some(field => newRow[field] !== oldRow[field]);
    case "species":
      return speciesFields.some(field => newRow[field] !== oldRow[field]);
    // views
    case "stemtaxonomiesview":
      return stemTaxonomiesViewFields.some(field => newRow[field] !== oldRow[field]);
    case "alltaxonomiesview":
      return allTaxonomiesFields.some(field => newRow[field] !== oldRow[field]);
    default:
      throw new Error("invalid grid type submitted");
  }
}
