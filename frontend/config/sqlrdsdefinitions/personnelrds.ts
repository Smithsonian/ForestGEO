import {GridColDef} from '@mui/x-data-grid';


export interface PersonnelRDS {
  id: number;
  personnelID: number;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

export const PersonnelGridColumns: GridColDef[] = [
  {field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'firstName', headerName: 'FirstName', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'lastName', headerName: 'LastName', headerClassName: 'header', flex: 1, align: 'left', editable: true},
  {field: 'role', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', editable: true},
];

export interface PersonnelResult {
  PersonnelID: any;
  FirstName: any;
  LastName: any;
  Role: any;
}

