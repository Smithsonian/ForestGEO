import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { Templates } from '@/config/datagridhelpers';
export interface PersonnelRDS {
  id: number;
  personnelID: number;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
}

export interface PersonnelResult {
  PersonnelID: any;
  FirstName: any;
  LastName: any;
  Role: any;
}
export class PersonnelMapper implements IDataMapper<PersonnelResult, PersonnelRDS> {
  mapData(results: PersonnelResult[], indexOffset: number = 1): PersonnelRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      personnelID: Number(item.PersonnelID),
      firstName: String(item.FirstName),
      lastName: String(item.LastName),
      role: String(item.Role)
    }));
  }
  demapData(results: PersonnelRDS[]): PersonnelResult[] {
    return results.map((item) => ({
      PersonnelID: Number(item.personnelID),
      FirstName: String(item.firstName),
      LastName: String(item.lastName),
      Role: String(item.role)
    }));
  }
}

export const personnelFields = ['firstName', 'lastName', 'role'];

export const PersonnelGridColumns: GridColDef[] = [
  { field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'firstName', headerName: 'FirstName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'lastName', headerName: 'LastName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'role', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', editable: true },
];