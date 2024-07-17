import {IDataMapper} from "../../datamapper";
import {ValidationFunction, RowValidationErrors} from '@/config/macros/formdetails';

export interface PersonnelRDS {
  id?: number;
  personnelID?: number;
  censusID?: number;
  firstName?: string;
  lastName?: string;
  roleID?: number;
}

export interface PersonnelResult {
  PersonnelID: any;
  CensusID: any;
  FirstName: any;
  LastName: any;
  RoleID: any;
}

export const initialPersonnelRDSRow = {
  id: 0,
  personnelID: 0,
  censusID: null,
  firstName: '',
  lastName: '',
  roleID: null,
};

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
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      firstName: item.FirstName != null ? String(item.FirstName) : undefined,
      lastName: item.LastName != null ? String(item.LastName) : undefined,
      roleID: item.RoleID != null ? Number(item.RoleID) : undefined,
    }));
  }

  demapData(results: PersonnelRDS[]): PersonnelResult[] {
    return results.map((item) => ({
      PersonnelID: item.personnelID != undefined ? Number(item.personnelID) : null,
      CensusID: item.censusID != undefined ? Number(item.censusID) : null,
      FirstName: item.firstName != undefined ? String(item.firstName) : null,
      LastName: item.lastName != undefined ? String(item.lastName) : null,
      RoleID: item.roleID != undefined ? Number(item.roleID) : null,
    }));
  }
}

export const personnelFields = ['firstName', 'lastName'];