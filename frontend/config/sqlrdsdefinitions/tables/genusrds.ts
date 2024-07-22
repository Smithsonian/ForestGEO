// genus custom data type
import {IDataMapper} from '../../datamapper';

export type GenusRDS = {
  id?: number;
  genusID?: number;
  familyID?: number;
  genus?: string;
  referenceID?: number;
  genusAuthority?: string;
};

export interface GenusResult {
  GenusID: any;
  FamilyID: any;
  Genus: any;
  ReferenceID: any;
  GenusAuthority: any;
}

export class GenusMapper implements IDataMapper<GenusResult, GenusRDS> {
  mapData(results: GenusResult[], indexOffset: number = 1): GenusRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      genusID: item.GenusID != null ? Number(item.GenusID) : undefined,
      familyID: item.FamilyID != null ? Number(item.FamilyID) : undefined,
      genus: item.Genus != null ? String(item.Genus) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      genusAuthority: item.GenusAuthority != null ? String(item.GenusAuthority) : undefined,
    }));
  }

  demapData(results: GenusRDS[]): GenusResult[] {
    return results.map((item) => ({
      GenusID: item.genusID != undefined ? Number(item.genusID) : null,
      FamilyID: item.familyID != undefined ? Number(item.familyID) : null,
      Genus: item.genus != undefined ? String(item.genus) : null,
      ReferenceID: item.referenceID != undefined ? Number(item.referenceID) : null,
      GenusAuthority: item.genusAuthority != undefined ? String(item.genusAuthority) : null,
    }));
  }
}


