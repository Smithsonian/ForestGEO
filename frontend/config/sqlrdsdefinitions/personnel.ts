import { RowValidationErrors, ValidationFunction } from '@/config/macros/formdetails';
import { ResultType } from '@/config/utils';
import { ColumnStates } from '@/config/macros';

export interface PersonnelRDS {
  id?: number;
  personnelID?: number;
  firstName?: string;
  lastName?: string;
  roleID?: number;
  censusActive?: boolean;
}

export type PersonnelResult = ResultType<PersonnelRDS>;
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

export function getPersonnelHCs(): ColumnStates {
  return {
    censusID: false,
    personnelID: false
  };
}

export interface QuadratPersonnelRDS {
  id?: number;
  quadratPersonnelID?: number;
  quadratID?: number;
  personnelID?: number;
  censusID?: number;
}

export type QuadratPersonnelResult = ResultType<QuadratPersonnelRDS>;

export interface RoleRDS {
  id?: number;
  roleID?: number;
  roleName?: string;
  roleDescription?: string;
}

export type RoleResult = ResultType<RoleRDS>;
