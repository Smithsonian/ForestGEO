/**
 * macros for sql table props:
 */
import {GridColDef} from "@mui/x-data-grid";

function objectToQueryString(obj: any) {
  const keys = Object.keys(obj);
  const keyValuePairs = keys.map(key => {
    return encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]);
  });
  return keyValuePairs.join('&');
}

export interface AttributeRDS {
  id: number;
  code: string;
  description: string | null;
  status: string | null;
}

export const AttributeStatusOptions = ['alive', 'alive-not measured', 'dead', 'missing', 'broken below', 'stem dead']

export const AttributeGridColumns: GridColDef[] = [
  {field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true}, // all unique ID columns need to be tagged 'id'
  {
    field: 'description',
    headerName: 'Description',
    headerClassName: 'header',
    minWidth: 250,
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'status',
    headerName: 'Status',
    headerClassName: 'header',
    minWidth: 150,
    flex: 1,
    editable: true,
    type: 'singleSelect',
    valueOptions: AttributeStatusOptions,
  },
];

export interface CensusRDS {
  id: number;
  censusID: number;
  plotID: number | null;
  plotCensusNumber: number | null;
  startDate: Date | null;
  endDate: Date | null;
  description: string | null;
}

export const CensusGridColumns: GridColDef[] = [
  {
    field: 'censusID',
    headerName: 'CensusID',
    type: 'number',
    headerClassName: 'header',
    minWidth: 200,
    flex: 1,
    editable: true
  },
  {
    field: 'plotID',
    headerName: 'PlotID',
    type: 'number',
    headerClassName: 'header',
    minWidth: 200,
    flex: 1,
    editable: true
  },
  {
    field: 'plotCensusNumber',
    headerName: 'PlotCensusNumber',
    type: 'number',
    headerClassName: 'header',
    minWidth: 150,
    flex: 1,
    editable: true
  },
  {
    field: 'startDate',
    headerName: 'StartDate',
    type: 'date',
    headerClassName: 'header',
    minWidth: 200,
    flex: 1,
    editable: true,
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {
    field: 'endDate',
    headerName: 'EndDate',
    type: 'date',
    headerClassName: 'header',
    minWidth: 200,
    flex: 1,
    editable: true,
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'description', headerName: 'Description', headerClassName: 'header', minWidth: 200, flex: 1, editable: true},
];

export interface CMAttributeRDS {
  id: number;
  cmaID: number;
  coreMeasurementID: number | null;
  code: string | null;
}

export const CMAttributeGridColumns: GridColDef[] = [
  {field: 'cmaID', headerName: 'CMAID', headerClassName: 'header', flex: 1},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1},
  {field: 'code', headerName: 'Code', headerClassName: 'header', flex: 1},
]

export interface CMVErrorRDS {
  id: number;
  cmvErrorID: number;
  coreMeasurementID: number | null;
  validationErrorID: number | null;
}

export const CMVErrorGridColumns: GridColDef[] = [
  {field: 'cmvErrorID', headerName: 'CMVErrorID', headerClassName: 'header', flex: 1},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1},
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1},
]

export interface CoreMeasurementRDS {
  id: number;
  coreMeasurementID: number;
  censusID: number | null;
  plotID: number | null;
  quadratID: number | null;
  treeID: number | null;
  stemID: number | null;
  personnelID: number | null;
  measurementTypeID: number | null;
  measurementDate: Date | null;
  measurement: string | null;
  isRemeasurement: boolean | null;
  isCurrent: boolean | null;
  userDefinedFields: string | null;
}


export const CoreMeasurementGridColumns: GridColDef[] = [
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1},
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1},
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1},
  {field: 'measurementTypeID', headerName: 'MeasurementTypeID', headerClassName: 'header', flex: 1},
  {
    field: 'measurementDate',
    headerName: 'MeasurementDate',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'measurement', headerName: 'Measurement', headerClassName: 'header', flex: 1},
  {field: 'isRemeasurement', headerName: 'IsRemeasurement', headerClassName: 'header', flex: 1},
  {field: 'isCurrent', headerName: 'IsCurrent', headerClassName: 'header', flex: 1},
  {field: 'userDefinedFields', headerName: 'UserDefinedFields', headerClassName: 'header', flex: 1},
]

export interface CurrentObsoleteRDS {
  id: number;
  speciesID: number;
  obsoleteSpeciesID: number;
  changeDate: Date | null;
  changeCodeID: number | null;
  changeNote: string | null;
}


export const CurrentObsoleteGridColumns: GridColDef[] = [
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1},
  {field: 'obsoleteSpeciesID', headerName: 'ObsoleteSpeciesID', headerClassName: 'header', flex: 1},
  {
    field: 'changeDate',
    headerName: 'ChangeDate',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'changeCodeID', headerName: 'ChangeCodeID', headerClassName: 'header', flex: 1},
  {field: 'changeNote', headerName: 'ChangeNote', headerClassName: 'header', flex: 1},
]

export interface FamilyRDS {
  id: number;
  familyID: number;
  family: string | null;
  referenceID: number | null;
}

export const FamilyGridColumns: GridColDef[] = [
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1},
  {field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1},
]

export interface GenusRDS {
  id: number;
  genusID: number;
  familyID: number | null;
  genusName: string | null;
  referenceID: number | null;
  authority: string | null;
}

export const GenusGridColumns: GridColDef[] = [
  {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1},
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1},
  {field: 'genusName', headerName: 'GenusName', headerClassName: 'header', flex: 1},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', flex: 1},
]

export interface MeasurementTypeRDS {
  id: number;
  measurementTypeID: number;
  measurementTypeDescription: string | null;
}

export const MeasurementTypeGridColumns: GridColDef[] = [
  {field: 'measurementTypeID', headerName: 'MeasurementTypeID', headerClassName: 'header', flex: 1},
  {
    field: 'measurementTypeDescription',
    headerName: 'MeasurementTypeDescription',
    headerClassName: 'header',
    flex: 1
  },
]

export interface PersonnelRDS {
  id: number;
  personnelID: number;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

export const PersonnelGridColumns: GridColDef[] = [
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1},
  {field: 'firstName', headerName: 'FirstName', headerClassName: 'header', flex: 1},
  {field: 'lastName', headerName: 'LastName', headerClassName: 'header', flex: 1},
  {field: 'role', headerName: 'Role', headerClassName: 'header', flex: 1},
]

export interface PlotRDS {
  id: number;
  plotID: number;
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
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1},
  {field: 'plotName', headerName: 'PlotName', headerClassName: 'header', flex: 1},
  {field: 'locationName', headerName: 'LocationName', headerClassName: 'header', flex: 1},
  {field: 'countryName', headerName: 'CountryName', headerClassName: 'header', flex: 1},
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1},
  {field: 'plotX', headerName: 'PlotX', headerClassName: 'header', flex: 1},
  {field: 'plotY', headerName: 'PlotY', headerClassName: 'header', flex: 1},
  {field: 'plotZ', headerName: 'PlotZ', headerClassName: 'header', flex: 1},
  {field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', flex: 1},
  {field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', flex: 1},
]

export interface QuadratRDS {
  id: number;
  quadratID: number;
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
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1},
  {field: 'quadratName', headerName: 'QuadratName', headerClassName: 'header', flex: 1},
  {field: 'quadratX', headerName: 'QuadratX', headerClassName: 'header', flex: 1},
  {field: 'quadratY', headerName: 'QuadratY', headerClassName: 'header', flex: 1},
  {field: 'quadratZ', headerName: 'QuadratZ', headerClassName: 'header', flex: 1},
  {field: 'dimensionX', headerName: 'DimensionX', headerClassName: 'header', flex: 1},
  {field: 'dimensionY', headerName: 'DimensionY', headerClassName: 'header', flex: 1},
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1},
  {field: 'quadratShape', headerName: 'QuadratShape', headerClassName: 'header', flex: 1},
]

export interface ReferenceRDS {
  id: number;
  referenceID: number;
  publicationTitle: string | null;
  fullReference: string | null;
  dateOfPublication: Date | null;
}


export const ReferenceGridColumns: GridColDef[] = [
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1},
  {field: 'publicationTitle', headerName: 'PublicationTitle', headerClassName: 'header', flex: 1},
  {field: 'fullReference', headerName: 'FullReference', headerClassName: 'header', flex: 1},
  {
    field: 'dateOfPublication',
    headerName: 'DateOfPublication',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
]

export interface SpeciesRDS {
  id: number;
  speciesID: number;
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
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1},
  {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', flex: 1},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', flex: 1},
  {field: 'speciesName', headerName: 'SpeciesName', headerClassName: 'header', flex: 1},
  {field: 'speciesCode', headerName: 'SpeciesCode', headerClassName: 'header', flex: 1},
  {field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', flex: 1},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', flex: 1},
  {field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', flex: 1},
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1},
]

export interface SpeciesInventoryRDS {
  id: number;
  speciesInventoryID: number;
  censusID: number | null;
  plotID: number | null;
  speciesID: number | null;
  subSpeciesID: number | null;
}

export const SpeciesInventoryGridColumns: GridColDef[] = [
  {field: 'speciesInventoryID', headerName: 'SpeciesInventoryID', headerClassName: 'header', flex: 1},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1},
]

export interface StemRDS {
  id: number;
  stemID: number;
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
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1},
  {field: 'stemNumber', headerName: 'StemNumber', headerClassName: 'header', flex: 1},
  {field: 'stemTag', headerName: 'StemTag', headerClassName: 'header', flex: 1},
  {field: 'treeTag', headerName: 'TreeTag', headerClassName: 'header', flex: 1},
  {field: 'stemX', headerName: 'StemX', headerClassName: 'header', flex: 1},
  {field: 'stemY', headerName: 'StemY', headerClassName: 'header', flex: 1},
  {field: 'stemZ', headerName: 'StemZ', headerClassName: 'header', flex: 1},
  {field: 'moved', headerName: 'Moved', headerClassName: 'header', flex: 1},
  {field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', flex: 1},
]

export interface SubSpeciesRDS {
  id: number;
  subSpeciesID: number;
  speciesID: number | null;
  subSpeciesName: string | null;
  subSpeciesCode: string | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  authority: string | null;
  infraSpecificLevel: string | null;
}


export const SubSpeciesGridColumns: GridColDef[] = [
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1},
  {field: 'subSpeciesName', headerName: 'SubSpeciesName', headerClassName: 'header', flex: 1},
  {field: 'subSpeciesCode', headerName: 'SubSpeciesCode', headerClassName: 'header', flex: 1},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', flex: 1},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', flex: 1},
  {field: 'authority', headerName: 'authority', headerClassName: 'header', flex: 1},
  {field: 'infraSpecificLevel', headerName: 'InfraSpecificLevel', headerClassName: 'header', flex: 1},
]

export interface TreeRDS {
  id: number;
  treeID: number;
  treeTag: string | null;
  speciesID: number | null;
  subSpeciesID: number | null;
}

export const TreeGridColumns: GridColDef[] = [
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1},
  {field: 'treeTag', headerName: 'TreeTag', headerClassName: 'header', flex: 1},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1},
]

export interface ValidationErrorRDS {
  id: number;
  validationErrorID: number;
  validationErrorDescription: string | null;
}

export const ValidationErrorGridColumns: GridColDef[] = [
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1},
  {
    field: 'validationErrorDescription',
    headerName: 'ValidationErrorDescription',
    headerClassName: 'header',
    flex: 1
  },
]