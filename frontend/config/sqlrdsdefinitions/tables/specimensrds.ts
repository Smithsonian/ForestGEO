// specimens custom data type
import { IDataMapper, parseDate } from "@/config/datamapper";

export type SpecimensRDS = {
  id?: number;
  specimenID?: number;
  stemID?: number;
  personnelID?: number;
  specimenNumber?: number;
  speciesID?: number;
  herbarium?: string;
  voucher?: number;
  collectionDate?: Date;
  determinedBy?: string;
  description?: string;
};

export type SpecimensResult = {
  SpecimenID: any;
  StemID: any;
  PersonnelID: any;
  SpecimenNumber: any;
  SpeciesID: any;
  Herbarium: any;
  Voucher: any;
  CollectionDate: any;
  DeterminedBy: any;
  Description: any;
}

export class SpecimensMapper implements IDataMapper<SpecimensResult, SpecimensRDS> {
  mapData(results: SpecimensResult[], indexOffset?: number): SpecimensRDS[] {
    return results.map((item, index) => ({
      id: index + (indexOffset || 1),
      specimenID: item.SpecimenID != null ? Number(item.SpecimenID) : undefined,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      personnelID: item.PersonnelID != null ? Number(item.PersonnelID) : undefined,
      specimenNumber: item.SpecimenNumber != null ? Number(item.SpecimenNumber) : undefined,
      speciesID: item.SpeciesID != null ? Number(item.SpeciesID) : undefined,
      herbarium: item.Herbarium != null ? String(item.Herbarium) : undefined,
      voucher: item.Voucher != null ? Number(item.Voucher) : undefined,
      collectionDate: parseDate(item.CollectionDate),
      determinedBy: item.DeterminedBy != null ? String(item.DeterminedBy) : undefined,
      description: item.Description != null ? String(item.Description) : undefined,
    }));
  }
  demapData(results: SpecimensRDS[]): SpecimensResult[] {
    return results.map(item => ({
      SpecimenID: item.specimenID !== undefined ? String(item.specimenID) : null,
      StemID: item.stemID !== undefined ? String(item.stemID) : null,
      PersonnelID: item.personnelID !== undefined ? String(item.personnelID) : null,
      SpecimenNumber: item.specimenNumber !== undefined ? String(item.specimenNumber) : null,
      SpeciesID: item.speciesID !== undefined ? String(item.speciesID) : null,
      Herbarium: item.herbarium !== undefined ? String(item.herbarium) : null,
      Voucher: item.voucher !== undefined ? String(item.voucher) : null,
      CollectionDate: item.collectionDate !== undefined ? parseDate(item.collectionDate) : null,
      DeterminedBy: item.determinedBy !== undefined ? String(item.determinedBy) : null,
      Description: item.description !== undefined ? String(item.description) : null,
    }));
  }
}