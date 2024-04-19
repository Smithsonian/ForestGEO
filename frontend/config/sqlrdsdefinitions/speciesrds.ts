import {GridColDef} from '@mui/x-data-grid';


export type SpeciesRDS = {
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
  defaultDBHMin: number | null;
  defaultDBHMax: number | null;
  defaultHOMMin: number | null;
  defaultHOMMax: number | null;
};


export const SpeciesGridColumns: GridColDef[] = [
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesCode', headerName: 'Code', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'defaultDBHMin', headerName: 'Min DBH', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'defaultDBHMax', headerName: 'Max DBH', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'defaultHOMMin', headerName: 'Min HOM', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'defaultHOMMax', headerName: 'Max HOM', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'idLevel', headerName: 'IDLevel', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'fieldFamily', headerName: 'FieldFamily', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface SpeciesResult {
  SpeciesID: any;
  GenusID: any;
  CurrentTaxonFlag: any;
  ObsoleteTaxonFlag: any;
  SpeciesName: any;
  SpeciesCode: any;
  IDLevel: any;
  Authority: any;
  FieldFamily: any;
  Description: any;
  ReferenceID: any;
  DefaultDBHMin: any;
  DefaultDBHMax: any;
  DefaultHOMMin: any;
  DefaultHOMMax: any;
}

