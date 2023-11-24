/**
 * macros for sql table props:
 */
import {GridColDef} from "@mui/x-data-grid";

export interface AttributeRDS {
  code: string | null;
  description: string | null;
  status: string | null;
}

export const AttributeGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'Code', headerClassName: 'header', width: 150}, // all unique ID columns need to be tagged 'id'
  {field: 'description', headerName: 'Description', headerClassName: 'header', width: 150},
  {field: 'status', headerName: 'Status', headerClassName: 'header', width: 150},
];

export interface CensusRDS {
  censusID: number | null;
  plotID: number | null;
  plotCensusNumber: number | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
}

export const CensusGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'censusID', headerClassName: 'header', width: 150},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', width: 150},
  {field: 'plotCensusNumber', headerName: 'PlotCensusNumber', headerClassName: 'header', width: 150},
  {field: 'startDate', headerName: 'StartDate', headerClassName: 'header', width: 150},
  {field: 'endDate', headerName: 'EndDate', headerClassName: 'header', width: 150},
  {field: 'description', headerName: 'Description', headerClassName: 'header', width: 150},
];

export interface CMAttributeRDS {
  cmaID: number | null;
  coreMeasurementID: number | null;
  code: string | null;
}

export const CMAttributeGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'CMAID', headerClassName: 'header', width: 150},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', width: 150},
  {field: 'code', headerName: 'Code', headerClassName: 'header', width: 150},
]

export interface CMVErrorRDS {
  cmvErrorID: number | null;
  coreMeasurementID: number | null;
  validationErrorID: number | null;
}

export const CMVErrorGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'CMVErrorID', headerClassName: 'header', width: 150},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', width: 150},
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', width: 150},
]

export interface CoreMeasurementRDS {
  coreMeasurementID: number | null;
  censusID: number | null;
  plotID: number | null;
  quadratID: number | null;
  treeID: number | null;
  stemID: number | null;
  personnelID: number | null;
  measurementTypeID: number | null;
  measurementDate: string | null;
  measurement: string | null;
  isRemeasurement: boolean | null;
  isCurrent: boolean | null;
  userDefinedFields: string | null;
}

export const CoreMeasurementGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'CoreMeasurementID', headerClassName: 'header', width: 150},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', width: 150},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', width: 150},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', width: 150},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', width: 150},
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', width: 150},
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', width: 150},
  {field: 'measurementTypeID', headerName: 'MeasurementTypeID', headerClassName: 'header', width: 150},
  {field: 'measurementDate', headerName: 'MeasurementDate', headerClassName: 'header', width: 150},
  {field: 'measurement', headerName: 'Measurement', headerClassName: 'header', width: 150},
  {field: 'isRemeasurement', headerName: 'IsRemeasurement', headerClassName: 'header', width: 150},
  {field: 'isCurrent', headerName: 'IsCurrent', headerClassName: 'header', width: 150},
  {field: 'userDefinedFields', headerName: 'UserDefinedFields', headerClassName: 'header', width: 150},
]

export interface CurrentObsoleteRDS {
  speciesID: number | null;
  obsoleteSpeciesID: number | null;
  changeDate: string | null;
  changeCodeID: number | null;
  changeNote: string | null;
}

export const CurrentObsoleteGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'SpeciesID', headerClassName: 'header', width: 150},
  {field: 'obsoleteSpeciesID', headerName: 'ObsoleteSpeciesID', headerClassName: 'header', width: 150},
  {field: 'changeDate', headerName: 'ChangeDate', headerClassName: 'header', width: 150},
  {field: 'changeCodeID', headerName: 'ChangeCodeID', headerClassName: 'header', width: 150},
  {field: 'changeNote', headerName: 'ChangeNote', headerClassName: 'header', width: 150},
]

export interface FamilyRDS {
  familyID: number | null;
  family: string | null;
  referenceID: number | null;
}

export const FamilyGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'FamilyID', headerClassName: 'header', width: 150},
  {field: 'family', headerName: 'Family', headerClassName: 'header', width: 150},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', width: 150},
]

export interface GenusRDS {
  genusID: number | null;
  familyID: number | null;
  genusName: string | null;
  referenceID: number | null;
  authority: string | null;
}

export const GenusGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'GenusID', headerClassName: 'header', width: 150},
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', width: 150},
  {field: 'genusName', headerName: 'GenusName', headerClassName: 'header', width: 150},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', width: 150},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', width: 150},
]

export interface MeasurementTypeRDS {
  measurementTypeID: number | null;
  measurementTypeDescription: string | null;
}

export const MeasurementTypeGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'MeasurementTypeID', headerClassName: 'header', width: 150},
  {
    field: 'measurementTypeDescription',
    headerName: 'MeasurementTypeDescription',
    headerClassName: 'header',
    width: 150
  },
]

export interface PersonnelRDS {
  personnelID: number | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

export const PersonnelGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'PersonnelID', headerClassName: 'header', width: 150},
  {field: 'firstName', headerName: 'FirstName', headerClassName: 'header', width: 150},
  {field: 'lastName', headerName: 'LastName', headerClassName: 'header', width: 150},
  {field: 'role', headerName: 'Role', headerClassName: 'header', width: 150},
]

export interface PlotRDS {
  plotID: number | null;
  plotName: string | null;
  locationName: string | null;
  countryName: string | null;
  area: number | null;
  plotX: number | null;
  plotY: number | null;
  plotZ: number | null;
  plotShape: string | null;
  plotDescription: string | null;
}

export const PlotGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'PlotID', headerClassName: 'header', width: 150},
  {field: 'plotName', headerName: 'PlotName', headerClassName: 'header', width: 150},
  {field: 'locationName', headerName: 'LocationName', headerClassName: 'header', width: 150},
  {field: 'countryName', headerName: 'CountryName', headerClassName: 'header', width: 150},
  {field: 'area', headerName: 'Area', headerClassName: 'header', width: 150},
  {field: 'plotX', headerName: 'PlotX', headerClassName: 'header', width: 150},
  {field: 'plotY', headerName: 'PlotY', headerClassName: 'header', width: 150},
  {field: 'plotZ', headerName: 'PlotZ', headerClassName: 'header', width: 150},
  {field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', width: 150},
  {field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', width: 150},
]

export interface QuadratRDS {
  quadratID: number | null;
  plotID: number | null;
  quadratName: string | null;
  quadratX: number | null;
  quadratY: number | null;
  quadratZ: number | null;
  dimensionX: number | null;
  dimensionY: number | null;
  area: number | null;
  quadratShape: string | null;
}

export const QuadratGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'QuadratID', headerClassName: 'header', width: 150},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', width: 150},
  {field: 'quadratName', headerName: 'QuadratName', headerClassName: 'header', width: 150},
  {field: 'quadratX', headerName: 'QuadratX', headerClassName: 'header', width: 150},
  {field: 'quadratY', headerName: 'QuadratY', headerClassName: 'header', width: 150},
  {field: 'quadratZ', headerName: 'QuadratZ', headerClassName: 'header', width: 150},
  {field: 'dimensionX', headerName: 'DimensionX', headerClassName: 'header', width: 150},
  {field: 'dimensionY', headerName: 'DimensionY', headerClassName: 'header', width: 150},
  {field: 'area', headerName: 'Area', headerClassName: 'header', width: 150},
  {field: 'quadratShape', headerName: 'QuadratShape', headerClassName: 'header', width: 150},
]

export interface ReferenceRDS {
  referenceID: number | null;
  publicationTitle: string | null;
  fullReference: string | null;
  dateOfPublication: string | null;
}

export const ReferenceGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'ReferenceID', headerClassName: 'header', width: 150},
  {field: 'publicationTitle', headerName: 'PublicationTitle', headerClassName: 'header', width: 150},
  {field: 'fullReference', headerName: 'FullReference', headerClassName: 'header', width: 150},
  {field: 'dateOfPublication', headerName: 'DateOfPublication', headerClassName: 'header', width: 150},
]

export interface SpeciesRDS {
  speciesID: number | null;
  genusID: number | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  speciesName: string | null;
  speciesCode: string | null;
  idLevel: string | null;
  authority: string | null;
  fieldFamily: string | null;
  description: string | null;
  referenceID: number | null;
}

export const SpeciesGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'SpeciesID', headerClassName: 'header', width: 150},
  {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', width: 150},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', width: 150},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', width: 150},
  {field: 'speciesName', headerName: 'SpeciesName', headerClassName: 'header', width: 150},
  {field: 'speciesCode', headerName: 'SpeciesCode', headerClassName: 'header', width: 150},
  {field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', width: 150},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', width: 150},
  {field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', width: 150},
  {field: 'description', headerName: 'Description', headerClassName: 'header', width: 150},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', width: 150},
]

export interface SpeciesInventoryRDS {
  speciesInventoryID: number | null;
  censusID: number | null;
  plotID: number | null;
  speciesID: number | null;
  subSpeciesID: number | null;
}

export const SpeciesInventoryGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'SpeciesInventoryID', headerClassName: 'header', width: 150},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', width: 150},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', width: 150},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', width: 150},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', width: 150},
]

export interface StemRDS {
  stemID: number | null;
  treeID: number | null;
  quadratID: number | null;
  stemNumber: number | null;
  stemTag: string | null;
  treeTag: string | null;
  stemX: number | null;
  stemY: number | null;
  stemZ: number | null;
  moved: boolean | null;
  stemDescription: string | null;
}

export const StemGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'StemID', headerClassName: 'header', width: 150},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', width: 150},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', width: 150},
  {field: 'stemNumber', headerName: 'StemNumber', headerClassName: 'header', width: 150},
  {field: 'stemTag', headerName: 'StemTag', headerClassName: 'header', width: 150},
  {field: 'treeTag', headerName: 'TreeTag', headerClassName: 'header', width: 150},
  {field: 'stemX', headerName: 'StemX', headerClassName: 'header', width: 150},
  {field: 'stemY', headerName: 'StemY', headerClassName: 'header', width: 150},
  {field: 'stemZ', headerName: 'StemZ', headerClassName: 'header', width: 150},
  {field: 'moved', headerName: 'Moved', headerClassName: 'header', width: 150},
  {field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', width: 150},
]

export interface SubSpeciesRDS {
  subSpeciesID: number | null;
  speciesID: number | null;
  subSpeciesName: string | null;
  subSpeciesCode: string | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  authority: string | null;
  infraSpecificLevel: string | null;
}

export const SubSpeciesGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'SubSpeciesID', headerClassName: 'header', width: 150},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', width: 150},
  {field: 'subSpeciesName', headerName: 'SubSpeciesName', headerClassName: 'header', width: 150},
  {field: 'subSpeciesCode', headerName: 'SubSpeciesCode', headerClassName: 'header', width: 150},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', width: 150},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', width: 150},
  {field: 'authority', headerName: 'authority', headerClassName: 'header', width: 150},
  {field: 'infraSpecificLevel', headerName: 'InfraSpecificLevel', headerClassName: 'header', width: 150},
]

export interface TreeRDS {
  treeID: number | null;
  treeTag: string | null;
  speciesID: number | null;
  subSpeciesID: number | null;
}

export const TreeGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'TreeID', headerClassName: 'header', width: 150},
  {field: 'treeTag', headerName: 'TreeTag', headerClassName: 'header', width: 150},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', width: 150},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', width: 150},
]

export interface ValidationErrorRDS {
  validationErrorID: number | null;
  validationErrorDescription: string | null;
}

export const ValidationErrorGridColumns: GridColDef[] = [
  {field: 'id', headerName: 'ValidationErrorID', headerClassName: 'header', width: 150},
  {field: 'validationErrorDescription', headerName: 'ValidationErrorDescription', headerClassName: 'header', width: 150},
]