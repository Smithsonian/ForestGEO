import {GridColDef} from '@mui/x-data-grid';


export type SpeciesInventoryRDS = {
  id: number;
  speciesInventoryID: number;
  censusID: number | null;
  plotID: number | null;
  speciesID: number | null;
  subSpeciesID: number | null;
};

export const SpeciesInventoryGridColumns: GridColDef[] = [
  {field: 'speciesInventoryID', headerName: 'SpeciesInventoryID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'censusID', headerName: 'CensusID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'plotID', headerName: 'PlotID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesID', headerName: 'SpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'subSpeciesID', headerName: 'SubSpeciesID', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface SpeciesInventoryResult {
  SpeciesInventoryID: any;
  CensusID: any;
  PlotID: any;
  SpeciesID: any;
  SubSpeciesID: any;
}