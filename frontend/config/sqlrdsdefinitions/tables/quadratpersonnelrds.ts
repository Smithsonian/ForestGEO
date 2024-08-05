// quadratpersonnel custom data type
import { IDataMapper } from '@/config/datamapper';
import { createInitialObject, ResultType } from '@/config/utils';

export interface QuadratPersonnelRDS {
  id?: number;
  quadratPersonnelID?: number;
  quadratID?: number;
  personnelID?: number;
  censusID?: number;
}

export const initialQuadratPersonnelRDSRow = createInitialObject<QuadratPersonnelRDS>();

export type QuadratPersonnelResult = ResultType<QuadratPersonnelRDS>;

export const quadratPersonnelFields = ['quadratPersonnelID', 'quadratID', 'personnelID', 'censusID'];
