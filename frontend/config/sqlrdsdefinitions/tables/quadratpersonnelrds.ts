import { IDataMapper } from "@/config/datamapper";
import { GridColDef } from "@mui/x-data-grid";

export interface QuadratPersonnelRDS {
  id: number;
  quadratPersonnelID: number;
  quadratID: number;
  personnelID: number;
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
      quadratPersonnelID: item.QuadratPersonnelID,
      quadratID: item.QuadratID,
      personnelID: item.PersonnelID,
    }));
  }

  demapData(results: QuadratPersonnelRDS[]): QuadratPersonnelResult[] {
    return results.map((item) => ({
      QuadratPersonnelID: item.quadratPersonnelID,
      QuadratID: item.quadratID,
      PersonnelID: item.personnelID,
    }));
  }
}

export const quadratPersonnelFields = ['quadratPersonnelID', 'quadratID', 'personnelID'];