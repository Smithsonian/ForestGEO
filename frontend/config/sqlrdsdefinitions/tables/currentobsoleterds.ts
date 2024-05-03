import {GridColDef} from '@mui/x-data-grid';


export type CurrentObsoleteRDS = {
  id: number;
  speciesID: number;
  obsoleteSpeciesID: number;
  changeDate: Date | null;
  changeCodeID: number | null;
  changeNote: string | null;
};


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
    valueGetter: (params: any) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
  {field: 'changeCodeID', headerName: 'ChangeCodeID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'changeNote', headerName: 'ChangeNote', headerClassName: 'header', flex: 1, align: 'left',},
];
