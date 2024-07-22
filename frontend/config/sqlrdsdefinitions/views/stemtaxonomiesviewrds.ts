import { IDataMapper } from "@/config/datamapper";
import { ColumnStates } from "@/config/macros";

export type StemTaxonomiesViewRDS = {
  id?: number;
  stemID?: number;
  treeID?: number;
  familyID?: number;
  genusID?: number;
  speciesID?: number;
  stemTag?: string;
  treeTag?: string;
  speciesCode?: string;
  family?: string;
  genus?: string;
  speciesName?: string;
  subspeciesName?: string;
  validCode?: string;
  genusAuthority?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  speciesIDLevel?: string;
  speciesFieldFamily?: string;
};

export const initialStemTaxonomiesViewRDSRow: StemTaxonomiesViewRDS = {
  id: 0,
  stemID: 0,
  treeID: 0,
  familyID: 0,
  genusID: 0,
  speciesID: 0,
  stemTag: '',
  treeTag: '',
  speciesCode: '',
  family: '',
  genus: '',
  speciesName: '',
  subspeciesName: '',
  validCode: '',
  genusAuthority: '',
  speciesAuthority: '',
  subspeciesAuthority: '',
  speciesIDLevel: '',
  speciesFieldFamily: '',
};

export interface StemTaxonomiesViewResult {
  StemID: any;
  StemTag: any;
  TreeID: any;
  TreeTag: any;
  SpeciesID: any;
  SpeciesCode: any;
  FamilyID: any;
  Family: any;
  GenusID: any;
  Genus: any;
  SpeciesName: any;
  SubspeciesName: any;
  ValidCode: any;
  GenusAuthority: any;
  SpeciesAuthority: any;
  SubspeciesAuthority: any;
  SpeciesIDLevel: any;
  SpeciesFieldFamily: any;
}

export class StemTaxonomiesMapper implements IDataMapper<StemTaxonomiesViewResult, StemTaxonomiesViewRDS> {
  demapData(results: StemTaxonomiesViewRDS[]): StemTaxonomiesViewResult[] {
    return results.map((item) => ({
      StemID: item.stemID !== undefined ? String(item.stemID) : null,
      StemTag: item.stemTag !== undefined ? String(item.stemTag) : null,
      TreeID: item.treeID !== undefined ? String(item.treeID) : null,
      TreeTag: item.treeTag !== undefined ? String(item.treeTag) : null,
      SpeciesID: item.speciesID !== undefined ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode !== undefined ? String(item.speciesCode) : null,
      FamilyID: item.familyID !== undefined ? String(item.familyID) : null,
      Family: item.family !== undefined ? String(item.family) : null,
      GenusID: item.genusID !== undefined ? String(item.genusID) : null,
      Genus: item.genus !== undefined ? String(item.genus) : null,
      SpeciesName: item.speciesName !== undefined ? String(item.speciesName) : null,
      SubspeciesName: item.subspeciesName !== undefined ? String(item.subspeciesName) : null,
      ValidCode: item.validCode !== undefined ? String(item.validCode) : null,
      GenusAuthority: item.genusAuthority !== undefined ? String(item.genusAuthority) : null,
      SpeciesAuthority: item.speciesAuthority !== undefined ? String(item.speciesAuthority) : null,
      SubspeciesAuthority: item.subspeciesAuthority !== undefined ? String(item.subspeciesAuthority) : null,
      SpeciesIDLevel: item.speciesIDLevel !== undefined ? String(item.speciesIDLevel) : null,
      SpeciesFieldFamily: item.speciesFieldFamily !== undefined ? String(item.speciesFieldFamily) : null,
    }));
  }

  mapData(results: StemTaxonomiesViewResult[], indexOffset: number = 1): StemTaxonomiesViewRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: item.StemID != null ? Number(item.StemID) : undefined,
      stemTag: item.StemTag != null ? String(item.StemTag) : undefined,
      treeID: item.TreeID != null ? Number(item.TreeID) : undefined,
      treeTag: item.TreeTag != null ? String(item.TreeTag) : undefined,
      speciesID: item.SpeciesID != null ? Number(item.SpeciesID) : undefined,
      speciesCode: item.SpeciesCode != null ? String(item.SpeciesCode) : undefined,
      familyID: item.FamilyID != null ? Number(item.FamilyID) : undefined,
      family: item.Family != null ? String(item.Family) : undefined,
      genusID: item.GenusID != null ? Number(item.GenusID) : undefined,
      genus: item.Genus != null ? String(item.Genus) : undefined,
      speciesName: item.SpeciesName != null ? String(item.SpeciesName) : undefined,
      subspeciesName: item.SubspeciesName != null ? String(item.SubspeciesName) : undefined,
      validCode: item.ValidCode != null ? String(item.ValidCode) : undefined,
      genusAuthority: item.GenusAuthority != null ? String(item.GenusAuthority) : undefined,
      speciesAuthority: item.SpeciesAuthority != null ? String(item.SpeciesAuthority) : undefined,
      subspeciesAuthority: item.SubspeciesAuthority != null ? String(item.SubspeciesAuthority) : undefined,
      speciesIDLevel: item.SpeciesIDLevel != null ? String(item.SpeciesIDLevel) : undefined,
      speciesFieldFamily: item.SpeciesFieldFamily != null ? String(item.SpeciesFieldFamily) : undefined,
    }));
  }
}

export function getStemTaxonomiesViewHCs(): ColumnStates {
  return {
    treeID: false,
    speciesID: false,
    familyID: false,
    genusID: false,
    quadratName: false,
    plotName: false,
    locationName: false,
    countryName: false,
    quadratDimensionX: false,
    quadratDimensionY: false,
    stemQuadX: false,
    stemQuadY: false,
    stemDescription: false,
  };
}
