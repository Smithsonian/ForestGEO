import {GridColDef} from '@mui/x-data-grid';


export type SubSpeciesRDS = {
  id: number;
  subSpeciesID: number;
  speciesID: number | null;
  subSpeciesName: string | null;
  subSpeciesCode: string | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  authority: string | null;
  infraSpecificLevel: string | null;
};


export const SubSpeciesGridColumns: GridColDef[] = [
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesName', headerName: 'SubSpeciesName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesCode', headerName: 'SubSpeciesCode', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'currentTaxonFlag', headerName: 'CurrentTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'obsoleteTaxonFlag', headerName: 'ObsoleteTaxonFlag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'authority', headerName: 'authority', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'infraSpecificLevel', headerName: 'InfraSpecificLevel', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface SubSpeciesResult {
  SubSpeciesID: any;
  SpeciesID: any;
  CurrentTaxonFlag: any;
  ObsoleteTaxonFlag: any;
  SubSpeciesName: any;
  SubSpeciesCode: any;
  Authority: any;
  InfraSpecificLevel: any;
}

