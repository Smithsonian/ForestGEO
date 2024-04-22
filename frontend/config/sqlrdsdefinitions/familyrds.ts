import {GridColDef} from '@mui/x-data-grid';

export type FamilyRDS = {
  id: number;
  familyID: number;
  family: string | null;
  referenceID: number | null;
};

export const FamilyGridColumns: GridColDef[] = [
  {field: 'familyID', headerName: 'FamilyID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface FamilyResult {
  FamilyID: any;
  Family: any;
  ReferenceID: any;
}