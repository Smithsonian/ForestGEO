import {IDataMapper} from "@/config/datamapper";

export interface QuadratPersonnelRDS {
  id?: number;
  quadratPersonnelID?: number;
  quadratID?: number;
  personnelID?: number;
  censusID?: number;
}

export const initialQuadratPersonnelRDSRow: QuadratPersonnelRDS = {
  id: 0,
  quadratPersonnelID: 0,
  quadratID: 0,
  personnelID: 0,
  censusID: 0
};

export interface QuadratPersonnelResult {
  QuadratPersonnelID: any;
  QuadratID: any;
  PersonnelID: any;
  CensusID: any;
}

export class QuadratPersonnelMapper implements IDataMapper<QuadratPersonnelResult, QuadratPersonnelRDS> {
  mapData(results: QuadratPersonnelResult[], indexOffset: number = 1): QuadratPersonnelRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      quadratPersonnelID: item.QuadratPersonnelID != null ? Number(item.QuadratPersonnelID) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
    }));
  }

  demapData(results: QuadratPersonnelRDS[]): QuadratPersonnelResult[] {
    return results.map((item) => ({
      QuadratPersonnelID: item.quadratPersonnelID != undefined ? String(item.quadratPersonnelID) : null,
      QuadratID: item.quadratID != undefined ? String(item.quadratID) : null,
      PersonnelID: item.personnelID != undefined ? String(item.personnelID) : null,
      CensusID: item.censusID != undefined ? String(item.censusID) : null,
    }));
  }
}

export const quadratPersonnelFields = ['quadratPersonnelID', 'quadratID', 'personnelID', 'censusID'];