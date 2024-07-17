import { unitSelectionOptions, areaSelectionOptions } from "@/config/macros";
import { AttributeStatusOptions } from "@/config/sqlrdsdefinitions/tables/attributerds";
import { Stack, Tooltip, Typography } from "@mui/joy";
import { GridColDef } from "@mui/x-data-grid";

export const quadratGridColumns: GridColDef[] = [
  { field: 'quadratID', headerName: '#', headerClassName: 'header', flex: 0.3, align: 'right', headerAlign: 'right', editable: false },
  {
    field: 'quadratName',
    headerName: 'Quadrat Name',
    headerClassName: 'header',
    renderHeader: () => <Tooltip title="Quadrat Name">
      <Typography>Name</Typography>
    </Tooltip>,
    flex: 0.75,
    align: 'right',
    headerAlign: 'right',
    type: 'string',
    editable: true
  },
  {
    field: 'startX',
    headerName: 'X',
    headerClassName: 'header',
    flex: 0.5,
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    editable: true
  },
  {
    field: 'startY',
    headerName: 'Y',
    headerClassName: 'header',
    flex: 0.5,
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    editable: true
  },
  {
    field: 'coordinateUnits',
    headerName: 'Unit',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => <Tooltip title="Coordinate Units">
      <Typography>Units</Typography>
    </Tooltip>,
    align: 'right',
    headerAlign: 'right',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  {
    field: 'area',
    headerName: 'Area',
    headerClassName: 'header',
    flex: 0.75,
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    editable: true
  },
  {
    field: 'areaUnits',
    headerName: 'Unit',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => <Tooltip title="Area Units">
      <Typography>Units</Typography>
    </Tooltip>,
    align: 'right',
    headerAlign: 'right',
    editable: true,
    type: 'singleSelect',
    valueOptions: areaSelectionOptions
  },
  {
    field: 'dimensionX',
    headerName: 'DimX',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => <Tooltip title="Dimension X">
      <Typography>DX</Typography>
    </Tooltip>,
    align: 'right',
    type: 'number',
    editable: true
  },
  {
    field: 'dimensionY',
    headerName: 'DimY',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => <Tooltip title="Dimension Y">
      <Typography>DY</Typography>
    </Tooltip>,
    align: 'right',
    headerAlign: 'right',
    type: 'number',
    editable: true
  },
  {
    field: 'dimensionUnits',
    headerName: 'Unit',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => <Tooltip title="Dimension Units">
      <Typography>Units</Typography>
    </Tooltip>,
    align: 'right',
    headerAlign: 'right',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  {
    field: 'quadratShape',
    headerName: 'Quadrat Shape',
    headerClassName: 'header',
    flex: 1,
    renderHeader: () => <Tooltip title="Quadrat Shape">
      <Typography>Shape</Typography>
    </Tooltip>,
    align: 'right',
    headerAlign: 'right',
    type: 'string',
    editable: true
  },
];

export const AllTaxonomiesViewGridColumns: GridColDef[] = [
  {
    field: 'speciesID',
    headerName: '#',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'number',
    editable: false
  },
  {
    field: 'speciesCode',
    headerName: 'Species Code',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'familyID',
    headerName: 'Family ID',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'family',
    headerName: 'Family',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'genusID',
    headerName: 'Genus ID',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'genus',
    headerName: 'Genus',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'genusAuthority',
    headerName: 'Genus Auth',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'speciesName',
    headerName: 'Species',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'subspeciesName',
    headerName: 'Subspecies',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'speciesIDLevel',
    headerName: 'Species ID Level',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'speciesAuthority',
    headerName: 'Species Auth',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'subspeciesAuthority',
    headerName: 'Subspecies Auth',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'currentTaxonFlag',
    headerName: 'Current Taxon Flag',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'boolean',
    editable: true
  },
  {
    field: 'obsoleteTaxonFlag',
    headerName: 'Obsolete Taxon Flag',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'boolean',
    editable: true
  },
  {
    field: 'fieldFamily',
    headerName: 'Field Family',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'speciesDescription',
    headerName: 'Species Description',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'referenceID',
    headerName: 'Reference ID',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'number',
    editable: true
  },
  {
    field: 'publicationTitle',
    headerName: 'Publication',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'dateOfPublication',
    headerName: 'Publish Date',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'citation',
    headerName: 'Citation',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
];

export const AttributeGridColumns: GridColDef[] = [
  { field: 'code', headerName: 'Code', headerClassName: 'header', minWidth: 150, flex: 1, editable: true }, // all unique ID columns need to be tagged 'id'
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
  { field: 'speciesCode', headerName: 'Species Code', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'familyID', headerName: 'Family ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genusID', headerName: 'Genus ID', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'subspeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'currentTaxonFlag', headerName: 'CTF', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'obsoleteTaxonFlag', headerName: 'OTF', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'genusAuthority', headerName: 'Genus Authority', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesAuthority', headerName: 'Species Authority', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'subspeciesAuthority', headerName: 'Subspecies Authority', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesIDLevel', headerName: 'Species ID Level', headerClassName: 'header', flex: 1, align: 'left' },
  { field: 'speciesFieldFamily', headerName: 'Species Field Family', headerClassName: 'header', flex: 1, align: 'left' },
];

// note --> originally attempted to use GridValueFormatterParams, but this isn't exported by MUI X DataGrid anymore. replaced with <any> for now. 
export const msvGridColumns: GridColDef[] = [
  { field: 'coreMeasurementID', headerName: '#', headerAlign: 'left', headerClassName: 'header', flex: 0.25, align: 'left' },
  { field: 'plotID', headerName: 'Plot ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'plotName', headerName: 'Plot Name', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'censusID', headerName: 'Census ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'quadratID', headerName: 'Quadrat ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'quadratName', headerName: 'Quadrat', headerAlign: 'left', headerClassName: 'header', flex: 0.8, align: 'left', editable: true },
  {
    field: 'subquadratID',
    headerName: 'Subquadrat ID', headerAlign: 'left',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'subquadratName',
    headerName: 'Subquadrat', headerAlign: 'left',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  { field: 'speciesID', headerName: 'Species ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  {
    field: 'speciesCode',
    headerName: 'Species Code', headerAlign: 'left',
    headerClassName: 'header',
    flex: 1.2,
    align: 'left',
    editable: true
  },
  { field: 'treeID', headerName: 'Tree ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'treeTag', headerName: 'Tree', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemID', headerName: 'Stem ID', headerAlign: 'left', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'stemTag', headerName: 'Stem', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemLocalX', headerName: 'X', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  { field: 'stemLocalY', headerName: 'Y', headerAlign: 'left', headerClassName: 'header', flex: 0.7, align: 'left', editable: true },
  {
    field: 'stemUnits',
    headerName: 'Stem Units',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <Typography level='body-sm' fontWeight={'xl'}>Stem</Typography>
      <Typography level='body-xs'>Units</Typography>
    </Stack>,
    align: 'center',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  { field: 'personnelID', headerName: 'Personnel ID', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'personnelName', headerName: 'Recording', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  {
    field: 'measuredDBH',
    headerName: 'DBH',
    headerClassName: 'header',
    flex: 0.8,
    align: 'left',
    editable: true,
    valueFormatter: (params: any) => {
      const value = Number(params.value);
      return value.toFixed(2); // limit trailing decimals to 2 places
    }
  },
  {
    field: 'dbhUnits',
    headerName: 'DBH Units',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <Typography level='body-sm' fontWeight={'xl'}>DBH</Typography>
      <Typography level='body-xs'>Units</Typography>
    </Stack>,
    align: 'center',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  {
    field: 'measuredHOM',
    headerName: 'HOM',
    headerClassName: 'header',
    flex: 0.5,
    align: 'left',
    editable: true,
    valueFormatter: (params: any) => {
      const value = Number(params.value);
      return value.toFixed(2); // limit trailing decimals to 2 places
    }
  },
  {
    field: 'homUnits',
    headerName: 'HOM Units',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <Typography level='body-sm' fontWeight={'xl'}>HOM</Typography>
      <Typography level='body-xs'>Units</Typography>
    </Stack>,
    align: 'center',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  },
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left', editable: true }
];
