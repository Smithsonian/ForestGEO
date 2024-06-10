import {IDataMapper} from "@/config/datamapper";

export interface QuadratPersonnelRDS {
  id?: number;
  quadratPersonnelID?: number;
  quadratID?: number;
  personnelID?: number;
}

export interface QuadratPersonnelResult {
  QuadratPersonnelID: any;
  QuadratID: any;
  PersonnelID: any;
}

export class QuadratPersonnelMapper implements IDataMapper<QuadratPersonnelResult, QuadratPersonnelRDS> {
  mapData(results: QuadratPersonnelResult[], indexOffset: number = 1): QuadratPersonnelRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      quadratPersonnelID: item.QuadratPersonnelID != null ? Number(item.QuadratPersonnelID) : undefined,
      quadratID: item.QuadratID != null ? Number(item.QuadratID) : undefined,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
    }));
  }

  demapData(results: QuadratPersonnelRDS[]): QuadratPersonnelResult[] {
    return results.map((item) => ({
      QuadratPersonnelID: item.quadratPersonnelID != null ? String(item.quadratPersonnelID) : null,
      QuadratID: item.quadratID != null ? String(item.quadratID) : null,
      PersonnelID: item.personnelID != null ? String(item.personnelID) : null,
    }));
  }
}

export const quadratPersonnelFields = ['quadratPersonnelID', 'quadratID', 'personnelID'];