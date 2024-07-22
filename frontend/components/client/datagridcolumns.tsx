import { unitSelectionOptions, areaSelectionOptions } from "@/config/macros";
import { AttributeStatusOptions } from "@/config/sqlrdsdefinitions/tables/attributerds";
import { Stack, Typography } from "@mui/joy";
import { GridColDef } from "@mui/x-data-grid";

const formatHeader = (word1: string, word2: string) => (
  <Stack direction={"column"} sx={{ alignItems: 'center', justifyContent: 'center' }}>
    <Typography level="body-sm" fontWeight={"xl"}>{word1}</Typography>
    <Typography level="body-xs">{word2}</Typography>
  </Stack>
);

export const quadratGridColumns: GridColDef[] = [
  { field: 'quadratID', headerName: '#', headerClassName: 'header', flex: 0.3, align: 'right', headerAlign: 'right', editable: false },
  { field: 'quadratName', headerName: 'Quadrat Name', headerClassName: 'header', renderHeader: () => formatHeader("Quadrat", "Name"), flex: 0.75, align: 'right', headerAlign: 'right', type: 'string', editable: true },
  { field: 'startX', headerName: 'X', headerClassName: 'header', flex: 0.5, align: 'right', headerAlign: 'right', type: 'number', editable: true },
  { field: 'startY', headerName: 'Y', headerClassName: 'header', flex: 0.5, align: 'right', headerAlign: 'right', type: 'number', editable: true },
  { field: 'coordinateUnits', headerName: 'Unit', headerClassName: 'header', flex: 1, renderHeader: () => formatHeader("Coordinate", "Units"), align: 'right', headerAlign: 'right', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions },
  { field: 'area', headerName: 'Area', headerClassName: 'header', flex: 0.75, align: 'right', headerAlign: 'right', type: 'number', editable: true },
  { field: 'areaUnits', headerName: 'Unit', headerClassName: 'header', flex: 1, renderHeader: () => formatHeader("Area", "Unit"), align: 'right', headerAlign: 'right', editable: true, type: 'singleSelect', valueOptions: areaSelectionOptions },
  { field: 'dimensionX', headerName: 'DimX', headerClassName: 'header', flex: 1, renderHeader: () => formatHeader("Dimension", "X"), align: 'right', type: 'number', editable: true },
  { field: 'dimensionY', headerName: 'DimY', headerClassName: 'header', flex: 1, renderHeader: () => formatHeader("Dimension", "Y"), align: 'right', headerAlign: 'right', type: 'number', editable: true },
  { field: 'dimensionUnits', headerName: 'Unit', headerClassName: 'header', flex: 1, renderHeader: () => formatHeader("Dimension", "Unit"), align: 'right', headerAlign: 'right', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions },
  { field: 'quadratShape', headerName: 'Quadrat Shape', headerClassName: 'header', flex: 1, renderHeader: () => formatHeader("Quadrat", "Shape"), align: 'right', headerAlign: 'right', type: 'string', editable: true },
];

export const AllTaxonomiesViewGridColumns: GridColDef[] = [
  { field: 'speciesID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: false },
  { field: 'speciesCode', headerName: 'Species Code', renderHeader: () => formatHeader("Species", "Code"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'familyID', headerName: 'Family ID', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'genusID', headerName: 'Genus ID', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'genusAuthority', headerName: 'Genus Auth', renderHeader: () => formatHeader("Genus", "Authority"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subspeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesIDLevel', headerName: 'Species ID Level', renderHeader: () => formatHeader("Species", "ID Level"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesAuthority', headerName: 'Species Auth', renderHeader: () => formatHeader("Species", "Authority"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subspeciesAuthority', headerName: 'Subspecies Auth', renderHeader: () => formatHeader("Subspecies", "Authority"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'fieldFamily', headerName: 'Field Family', renderHeader: () => formatHeader("Field", "Family"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesDescription', headerName: 'Species Description', renderHeader: () => formatHeader("Species", "Description"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'referenceID', headerName: 'Reference ID', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'publicationTitle', headerName: 'Publication', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'dateOfPublication', headerName: 'Publish Date', renderHeader: () => formatHeader("Publish", "Date"), headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'citation', headerName: 'Citation', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
];

export const AttributeGridColumns: GridColDef[] = [
  { field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true }, // all unique ID columns need to be tagged 'id'
  { field: 'description', headerName: 'Description', headerClassName: 'header', minWidth: 250, flex: 1, align: 'left', editable: true },
  { field: 'status', headerName: 'Status', headerClassName: 'header', minWidth: 150, flex: 1, align: 'left', editable: true, type: 'singleSelect', valueOptions: AttributeStatusOptions, },
];

export const PersonnelGridColumns: GridColDef[] = [
  { field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'censusID', headerName: 'Census ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'firstName', headerName: 'FirstName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'lastName', headerName: 'LastName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'role', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', editable: true },
];

export const StemTaxonomiesViewGridColumns: GridColDef[] = [
  { field: 'stemID', headerName: '#', headerClassName: 'header', flex: 0.1, align: 'left' },
  { field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'treeID', headerName: 'Tree ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'treeTag', headerName: 'Tree', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesID', headerName: 'Species ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesCode', headerName: 'Species Code', renderHeader: () => formatHeader("Species", "Code"), headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'familyID', headerName: 'Family ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genusID', headerName: 'Genus ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'subspeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genusAuthority', headerName: 'Genus Authority', renderHeader: () => formatHeader("Genus", "Authority"), headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'speciesAuthority', headerName: 'Species Authority', renderHeader: () => formatHeader("Species", "Authority"), headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'subspeciesAuthority', headerName: 'Subspecies Authority', renderHeader: () => formatHeader("Subspecies", "Authority"), headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesIDLevel', headerName: 'Species ID Level', renderHeader: () => formatHeader("Species", "ID Level"), headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesFieldFamily', headerName: 'Species Field Family', renderHeader: () => formatHeader("Species", "Field Family"), headerClassName: 'header', flex: 1, align: 'left' },
];

// note --> originally attempted to use GridValueFormatterParams, but this isn't exported by MUI X DataGrid anymore. replaced with <any> for now. 
export const msvGridColumns: GridColDef[] = [
  { field: 'coreMeasurementID', headerName: '#', headerAlign: 'left', headerClassName: 'header', flex: 0.25, align: 'left' },
  { field: 'plotID', headerName: 'Plot ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'plotName', headerName: 'Plot Name', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'censusID', headerName: 'Census ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'quadratID', headerName: 'Quadrat ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'quadratName', headerName: 'Quadrat', headerAlign: 'left', headerClassName: 'header', flex: 0.8, align: 'left', editable: true },
  { field: 'speciesID', headerName: 'Species ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'speciesCode', headerName: 'Species Code', headerAlign: 'left', headerClassName: 'header', flex: 1.2, align: 'left', editable: true },
  { field: 'treeID', headerName: 'Tree ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'treeTag', headerName: 'Tree', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemID', headerName: 'Stem ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'stemTag', headerName: 'Stem', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemLocalX', headerName: 'X', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemLocalY', headerName: 'Y', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemUnits', headerName: 'Stem Units', headerClassName: 'header', flex: 0.4, renderHeader: () => formatHeader("Stem", "Units"), align: 'center', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions },
  { field: 'personnelID', headerName: 'Personnel ID', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'personnelName', headerName: 'Recording', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  {
    field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 0.8, align: 'left', editable: true,
    valueFormatter: (params: any) => {
      const value = Number(params.value);
      return value.toFixed(2); // limit trailing decimals to 2 places
    }
  },
  { field: 'dbhUnits', headerName: 'DBH Units', headerClassName: 'header', flex: 0.4, renderHeader: () => formatHeader("DBH", "Units"), align: 'center', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions },
  {
    field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 0.5, align: 'left', editable: true,
    valueFormatter: (params: any) => {
      const value = Number(params.value);
      return value.toFixed(2); // limit trailing decimals to 2 places
    }
  },
  { field: 'homUnits', headerName: 'HOM Units', headerClassName: 'header', flex: 0.4, renderHeader: () => formatHeader("HOM", "Units"), align: 'center', editable: true, type: 'singleSelect', valueOptions: unitSelectionOptions },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', editable: true }
];

export const CensusGridColumns: GridColDef[] = [
  { field: 'censusID', headerName: 'ID', type: 'number', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'plotCensusNumber', headerName: 'PlotCensusNumber', type: 'number', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  {
    field: 'startDate', headerName: 'Starting', headerClassName: 'header', flex: 1, align: 'left', type: 'date', editable: true,
    valueFormatter: (params: any) => {
      if (params) {
        return new Date(params).toDateString();
      } else return "null";
    }
  },
  {
    field: 'endDate', headerName: 'Ending', headerClassName: 'header', type: 'date', flex: 1, align: 'left', editable: true,
    valueFormatter: (params: any) => {
      if (params) {
        return new Date(params).toDateString();
      } else return "null";
    }
  },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, type: 'string', editable: true },
];

export const ValidationErrorGridColumns: GridColDef[] = [
  { field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'validationErrorDescription', headerName: 'ValidationErrorDescription', headerClassName: 'header', flex: 1, align: 'left', },
];

export const CoreMeasurementsGridColumns: GridColDef[] = [
  { field: 'coreMeasurementID', headerName: 'CMID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'stemID', headerName: 'StemID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'isValidated', headerName: 'IsValidated', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  {
    field: 'measurementDate', headerName: 'MeasurementDate', type: "date", headerClassName: 'header', flex: 1,
    valueGetter: (params: any) => {
      if (!params.value) return null;
      return new Date(params.value);
    }, editable: true
  },
  { field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left' },
];

export const SubquadratGridColumns: GridColDef[] = [
  { field: 'ordering', headerName: 'Order', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'subquadratName', headerName: 'Name', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'quadratID', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'dimensionX', headerName: 'X-Dimension', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'dimensionY', headerName: 'Y-Dimension', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'qX', headerName: 'X', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'qY', headerName: 'Y', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'unit', headerName: 'Units', headerClassName: 'header', flex: 1, align: 'left', type: 'singleSelect', valueOptions: unitSelectionOptions, editable: true },
];

export const StemGridColumns: GridColDef[] = [
  { field: 'stemTag', headerName: 'Stem Tag', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'localX', headerName: 'Plot X', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'localY', headerName: 'Plot Y', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'coordinateUnits', headerName: 'Unit', headerClassName: 'header', flex: 1, align: 'left', type: 'singleSelect', valueOptions: unitSelectionOptions, editable: true },
  { field: 'moved', headerName: 'Moved', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  { field: 'stemDescription', headerName: 'StemDescription', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
];

export const SpeciesInventoryGridColumns: GridColDef[] = [
  { field: 'speciesInventoryID', headerName: 'SpeciesInventoryID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1, align: 'left', },
];

export const SpeciesGridColumns: GridColDef[] = [
  // { field: 'id', headerName: '#', headerClassName: 'header', flex: 1, align: 'left', maxWidth: 50},
  { field: 'speciesCode', headerName: 'SpCode', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true, maxWidth: 125 },
  // {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  // { field: 'currentTaxonFlag', headerName: 'Current?', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  // { field: 'obsoleteTaxonFlag', headerName: 'Obsolete?', headerClassName: 'header', flex: 1, align: 'left', type: 'boolean', editable: true },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subSpeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesAuthority', headerName: 'SpeciesAuth', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subspeciesAuthority', headerName: 'SubspeciesAuth', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'validCode', headerName: 'Valid Code', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  // {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
];

export const RolesGridColumns: GridColDef[] = [
  { field: 'roleID', headerName: 'RoleID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'roleName', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'roleDescription', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', editable: false },
];

export const ReferenceGridColumns: GridColDef[] = [
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'publicationTitle', headerName: 'PublicationTitle', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'fullReference', headerName: 'FullReference', headerClassName: 'header', flex: 1, align: 'left', },
  {
    field: 'dateOfPublication', headerName: 'DateOfPublication', type: "date", headerClassName: 'header', flex: 1, align: 'left',
    valueGetter: (params: any) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
];

export const PlotGridColumns: GridColDef[] = [
  { field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'plotName', headerName: 'PlotName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'locationName', headerName: 'LocationName', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'countryName', headerName: 'CountryName', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'dimensionX', headerName: 'DimX', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'dimensionY', headerName: 'DimY', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'area', headerName: 'Area', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'globalX', headerName: 'GlobalX', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'globalY', headerName: 'GlobalY', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'globalZ', headerName: 'GlobalZ', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: true },
  { field: 'unit', headerName: 'Units', headerClassName: 'header', flex: 1, align: 'left', type: 'singleSelect', valueOptions: unitSelectionOptions },
  { field: 'plotShape', headerName: 'PlotShape', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'plotDescription', headerName: 'PlotDescription', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
];

export const GenusGridColumns: GridColDef[] = [
  { field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'genus', headerName: 'GenusName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'genusAuthority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left', editable: true },
];

export const FamilyGridColumns: GridColDef[] = [
  { field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left', editable: false },
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', editable: false },
];
export const CMVErrorGridColumns: GridColDef[] = [
  { field: 'cmvErrorID', headerName: 'CMVErrorID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1, align: 'left' },
];

export const CMAttributeGridColumns: GridColDef[] = [
  { field: 'cmaID', headerName: 'CMAID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'coreMeasurementID', headerName: 'CoreMeasurementID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'code', headerName: 'Code', headerClassName: 'header', flex: 1, align: 'left' },
];

// Combine the column definitions
const combineColumns = (primary: GridColDef[], secondary: GridColDef[]): GridColDef[] => {
  const combined = [...primary];

  secondary.forEach(secondaryColumn => {
    const primaryColumnIndex = primary.findIndex(primaryColumn => primaryColumn.field === secondaryColumn.field);
    if (primaryColumnIndex === -1) {
      combined.push(secondaryColumn);
    } else {
      // Merge columns if both contain renderHeader, otherwise preserve existing properties
      combined[primaryColumnIndex] = { ...combined[primaryColumnIndex], ...secondaryColumn };
    }
  });

  return combined;
};

const rawColumns: GridColDef[] = combineColumns(msvGridColumns, StemTaxonomiesViewGridColumns);

export const ViewFullTableGridColumns = rawColumns.map(column => {
  if (column.field === 'speciesCode') {
    return { ...column, renderHeader: () => formatHeader('Species', 'Code') };
  } else if (column.field === 'genusAuthority') {
    return { ...column, renderHeader: () => formatHeader('Genus', 'Authority') };
  } else if (column.field === 'speciesAuthority') {
    return { ...column, renderHeader: () => formatHeader('Species', 'Authority') };
  } else if (column.field === 'subspeciesAuthority') {
    return { ...column, renderHeader: () => formatHeader('Subspecies', 'Authority') };
  } else if (column.field === 'speciesIDLevel') {
    return { ...column, renderHeader: () => formatHeader('Species', 'ID Level') };
  } else if (column.field === 'speciesFieldFamily') {
    return { ...column, renderHeader: () => formatHeader('Species', 'Field Family') };
  } else if (column.field === 'stemUnits') {
    return { ...column, renderHeader: () => formatHeader('Stem', 'Units') };
  } else if (column.field === 'dbhUnits') {
    return { ...column, renderHeader: () => formatHeader('DBH', 'Units') };
  } else if (column.field === 'homUnits') {
    return { ...column, renderHeader: () => formatHeader('HOM', 'Units') };
  }
  return column;
});