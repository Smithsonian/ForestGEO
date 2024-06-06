import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper } from "../../datamapper";
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export interface PersonnelRDS {
  id?: number;
  personnelID?: number;
  firstName?: string;
  lastName?: string;
  role?: string;
}

export interface PersonnelResult {
  PersonnelID: any;
  FirstName: any;
  LastName: any;
  Role: any;
}

// personnel table column character limits
const PERSONNEL_FIRSTNAME_LIMIT = 50;
const PERSONNEL_LASTNAME_LIMIT = 50;
const PERSONNEL_ROLE_LIMIT = 150;

export const validatePersonnelRow: ValidationFunction = (row) => {
  const errors: RowValidationErrors = {};

  if (row['firstname'] && row['firstname'].length > PERSONNEL_FIRSTNAME_LIMIT) {
    errors['firstname'] = `First name exceeds ${PERSONNEL_FIRSTNAME_LIMIT} characters.`;
  }
  if (row['lastname'] && row['lastname'].length > PERSONNEL_LASTNAME_LIMIT) {
    errors['lastname'] = `Last name exceeds ${PERSONNEL_LASTNAME_LIMIT} characters.`;
  }
  if (row['role'] && row['role'].length > PERSONNEL_ROLE_LIMIT) {
    errors['role'] = `Role exceeds ${PERSONNEL_ROLE_LIMIT} characters.`;
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

export class PersonnelMapper implements IDataMapper<PersonnelResult, PersonnelRDS> {
  mapData(results: PersonnelResult[], indexOffset: number = 1): PersonnelRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
      firstName: item.FirstName != null ? String(item.FirstName) : undefined,
      lastName: item.LastName != null ? String(item.LastName) : undefined,
      role: item.Role != null ? String(item.Role) : undefined,
    }));
  }

  demapData(results: PersonnelRDS[]): PersonnelResult[] {
    return results.map((item) => ({
      PersonnelID: item.personnelID != null ? Number(item.personnelID) : null,
      FirstName: item.firstName != null ? String(item.firstName) : null,
      LastName: item.lastName != null ? String(item.lastName) : null,
      Role: item.role != null ? String(item.role) : null,
    }));
  }
}


export const personnelFields = ['firstName', 'lastName', 'role'];

export const PersonnelGridColumns: GridColDef[] = [
  { field: 'personnelID', headerName: 'PersonnelID', headerClassName: 'header', flex: 1, align: 'left', editable: false},
  { field: 'firstName', headerName: 'FirstName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'lastName', headerName: 'LastName', headerClassName: 'header', flex: 1, align: 'left', editable: true },
  { field: 'role', headerName: 'Role', headerClassName: 'header', flex: 1, align: 'left', editable: true },
];