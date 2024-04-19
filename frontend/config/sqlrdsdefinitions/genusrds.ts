import {GridColDef} from '@mui/x-data-grid';


export type GenusRDS = {
  id: number;
  genusID: number;
  familyID: number | null;
  genus: string | null;
  referenceID: number | null;
  authority: string | null;
};

export const GenusGridColumns: GridColDef[] = [
  {field: 'genusID', headerName: 'GenusID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'genus', headerName: 'GenusName', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'authority', headerName: 'Authority', headerClassName: 'header', flex: 1, align: 'left',},
];
