// personnel custom data type
import { createInitialObject, ResultType } from '@/config/utils';
import { IDataMapper } from '../../datamapper';
import { ValidationFunction, RowValidationErrors } from '@/config/macros/formdetails';

export interface PersonnelRDS {
  id?: number;
  personnelID?: number;
  censusID?: number;
  firstName?: string;
  lastName?: string;
  roleID?: number;
}

export type PersonnelResult = ResultType<PersonnelRDS>;

export const initialPersonnelRDSRow = createInitialObject<PersonnelRDS>();

// personnel table column character limits
const PERSONNEL_FIRSTNAME_LIMIT = 50;
const PERSONNEL_LASTNAME_LIMIT = 50;
const PERSONNEL_ROLE_LIMIT = 150;

export const validatePersonnelRow: ValidationFunction = row => {
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

export const personnelFields = ['firstName', 'lastName'];
