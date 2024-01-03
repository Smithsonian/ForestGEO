/**
 * macros for sql table props:
 */
import {DataGrid, GridColDef} from "@mui/x-data-grid";
import {styled} from "@mui/system";

export const StyledDataGrid = styled(DataGrid)(({theme}) => ({
  border: 0,
  color:
    theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.85)',
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"',
  ].join(','),
  WebkitFontSmoothing: 'auto',
  letterSpacing: 'normal',
  '& .MuiDataGrid-columnsContainer': {
    backgroundColor: theme.palette.mode === 'light' ? '#fafafa' : '#1d1d1d',
  },
  '& .MuiDataGrid-iconSeparator': {
    display: 'none',
  },
  '& .MuiDataGrid-columnHeader, .MuiDataGrid-cell': {
    borderRight: `1px solid ${
      theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'
    }`,
  },
  '& .MuiDataGrid-columnsContainer, .MuiDataGrid-cell': {
    borderBottom: `1px solid ${
      theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'
    }`,
  },
  '& .MuiDataGrid-cell': {
    color:
      theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.65)',
  },
  '& .MuiPaginationItem-root': {
    borderRadius: 0,
  },
}));

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
    align: 'left',
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
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'plotID',
    headerName: 'PlotID',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'plotCensusNumber',
    headerName: 'PlotCensusNumber',
    type: 'number',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'startDate',
    headerName: 'StartDate',
    type: 'date',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
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
    flex: 1,
    align: 'left',
    editable: true,
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, editable: true},
]

export interface CMAttributeRDS {
  id: number;
  cmaID: number;
  coreMeasurementID: number | null;
  code: string | null;
}

export const CMAttributeGridColumns: GridColDef[] = [
  {field: 'cmaID', headerName: 'CMAID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'code', headerName: 'Code', headerClassName: 'header', flex: 1, align: 'left'},
]

export interface CMVErrorRDS {
  id: number;
  cmvErrorID: number;
  coreMeasurementID: number | null;
  validationErrorID: number | null;
}

export const CMVErrorGridColumns: GridColDef[] = [
  {field: 'cmvErrorID', headerName: 'CMVErrorID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1, align: 'left'},
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
  {field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'measurementTypeID', headerName: 'MeasurementTypeID', headerClassName: 'header', flex: 1, align: 'left'},
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
  {field: 'measurement', headerName: 'Measurement', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'isRemeasurement', headerName: 'IsRemeasurement', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'isCurrent', headerName: 'IsCurrent', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'userDefinedFields', headerName: 'UserDefinedFields', headerClassName: 'header', flex: 1, align: 'left'},
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
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'obsoleteSpeciesID', headerName: 'ObsoleteSpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'changeDate',
    headerName: 'ChangeDate',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    valueGetter: (params) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'changeCodeID', headerName: 'ChangeCodeID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'changeNote', headerName: 'ChangeNote', headerClassName: 'header', flex: 1, align: 'left',},
]

export interface FamilyRDS {
  id: number;
  familyID: number;
  family: string | null;
  referenceID: number | null;
}

export const FamilyGridColumns: GridColDef[] = [
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
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
  {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'genusName', headerName: 'GenusName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left',},
]

export interface MeasurementTypeRDS {
  id: number;
  measurementTypeID: number;
  measurementTypeDescription: string | null;
}

export const MeasurementTypeGridColumns: GridColDef[] = [
  {field: 'measurementTypeID', headerName: 'MeasurementTypeID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'measurementTypeDescription',
    headerName: 'MeasurementTypeDescription',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
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
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'firstName', headerName: 'FirstName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'lastName', headerName: 'LastName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'role', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left',},
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
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotName', headerName: 'PlotName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'locationName', headerName: 'LocationName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'countryName', headerName: 'CountryName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotX', headerName: 'PlotX', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotY', headerName: 'PlotY', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotZ', headerName: 'PlotZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', flex: 1, align: 'left',},
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
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratName', headerName: 'QuadratName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratX', headerName: 'QuadratX', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratY', headerName: 'QuadratY', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratZ', headerName: 'QuadratZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'dimensionX', headerName: 'DimensionX', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'dimensionY', headerName: 'DimensionY', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratShape', headerName: 'QuadratShape', headerClassName: 'header', flex: 1, align: 'left',},
]

export interface ReferenceRDS {
  id: number;
  referenceID: number;
  publicationTitle: string | null;
  fullReference: string | null;
  dateOfPublication: Date | null;
}


export const ReferenceGridColumns: GridColDef[] = [
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'publicationTitle', headerName: 'PublicationTitle', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'fullReference', headerName: 'FullReference', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'dateOfPublication',
    headerName: 'DateOfPublication',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    align: 'left',
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
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesName', headerName: 'SpeciesName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesCode', headerName: 'SpeciesCode', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
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
  {field: 'speciesInventoryID', headerName: 'SpeciesInventoryID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
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
  {field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'quadratID', headerName: 'QuadratID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemNumber', headerName: 'StemNumber', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemTag', headerName: 'StemTag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'treeTag', headerName: 'TreeTag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemX', headerName: 'StemX', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemY', headerName: 'StemY', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemZ', headerName: 'StemZ', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'moved', headerName: 'Moved', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', flex: 1, align: 'left',},
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
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesName', headerName: 'SubSpeciesName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesCode', headerName: 'SubSpeciesCode', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'authority', headerName: 'authority', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'infraSpecificLevel', headerName: 'InfraSpecificLevel', headerClassName: 'header', flex: 1, align: 'left',},
]

export interface TreeRDS {
  id: number;
  treeID: number;
  treeTag: string | null;
  speciesID: number | null;
  subSpeciesID: number | null;
}

export const TreeGridColumns: GridColDef[] = [
  {field: 'treeID', headerName: 'TreeID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'treeTag', headerName: 'TreeTag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
]

export interface ValidationErrorRDS {
  id: number;
  validationErrorID: number;
  validationErrorDescription: string | null;
}

export const ValidationErrorGridColumns: GridColDef[] = [
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'validationErrorDescription',
    headerName: 'ValidationErrorDescription',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
  },
]

export const SchemaTableNames = [
  {name: "Attributes", columns: AttributeGridColumns},
  {name: "Census", columns: CensusGridColumns},
  {name: "CMAttributes", columns: CMAttributeGridColumns},
  {name: "CMVErrors", columns: CMVErrorGridColumns},
  {name: "CoreMeasurements", columns: CoreMeasurementGridColumns},
  {name: "CurrentObsolete", columns: CurrentObsoleteGridColumns},
  {name: "Family", columns: FamilyGridColumns},
  {name: "Genus", columns: GenusGridColumns},
  {name: "MeasurementTypes", columns: MeasurementTypeGridColumns},
  {name: "Personnel", columns: PersonnelGridColumns},
  {name: "Plots", columns: PlotGridColumns},
  {name: "Quadrats", columns: QuadratGridColumns},
  {name: "Reference", columns: ReferenceGridColumns},
  {name: "Species", columns: SpeciesGridColumns},
  {name: "SpeciesInventory", columns: SpeciesInventoryGridColumns},
  {name: "Stems", columns: StemGridColumns},
  {name: "SubSpecies", columns: SubSpeciesGridColumns},
  {name: "Trees", columns: TreeGridColumns},
  {name: "ValidationErrors", columns: ValidationErrorGridColumns}
]