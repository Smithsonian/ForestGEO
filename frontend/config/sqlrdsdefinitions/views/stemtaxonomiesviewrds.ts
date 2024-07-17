import {IDataMapper} from "@/config/datamapper";
import {bitToBoolean, ColumnStates} from "@/config/macros";

export type StemTaxonomiesViewRDS = {
  id?: number;
  stemID?: number;
  stemTag?: string;
  treeID?: number;
  treeTag?: string;
  speciesID?: number;
  speciesCode?: string;
  familyID?: number;
  family?: string;
  genusID?: number;
  genus?: string;
  speciesName?: string;
  subspeciesName?: string;
  currentTaxonFlag?: boolean;
  obsoleteTaxonFlag?: boolean;
  genusAuthority?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  speciesIDLevel?: string;
  speciesFieldFamily?: string;
}
export const initialStemTaxonomiesViewRDSRow: StemTaxonomiesViewRDS = {
  id: 0,
  stemID: 0,
  stemTag: '',
  treeID: 0,
  treeTag: '',
  speciesID: 0,
  speciesCode: '',
  familyID: 0,
  family: '',
  genusID: 0,
  genus: '',
  speciesName: '',
  subspeciesName: '',
  currentTaxonFlag: undefined,
  obsoleteTaxonFlag: undefined,
  genusAuthority: '',
  speciesAuthority: '',
  subspeciesAuthority: '',
  speciesIDLevel: '',
  speciesFieldFamily: ''
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
  CurrentTaxonFlag: any;
  ObsoleteTaxonFlag: any;
  GenusAuthority: any;
  SpeciesAuthority: any;
  SubspeciesAuthority: any;
  SpeciesIDLevel: any;
  SpeciesFieldFamily: any;
}

export class StemTaxonomiesMapper implements IDataMapper<StemTaxonomiesViewResult, StemTaxonomiesViewRDS> {
  demapData(results: StemTaxonomiesViewRDS[]): StemTaxonomiesViewResult[] {
    return results.map((item) => ({
      StemID: item.stemID != null ? String(item.stemID) : null,
      StemTag: item.stemTag != null ? String(item.stemTag) : null,
      TreeID: item.treeID != null ? String(item.treeID) : null,
      TreeTag: item.treeTag != null ? String(item.treeTag) : null,
      SpeciesID: item.speciesID != null ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode != null ? String(item.speciesCode) : null,
      FamilyID: item.familyID != null ? String(item.familyID) : null,
      Family: item.family != null ? String(item.family) : null,
      GenusID: item.genusID != null ? String(item.genusID) : null,
      Genus: item.genus != null ? String(item.genus) : null,
      SpeciesName: item.speciesName != null ? String(item.speciesName) : null,
      SubspeciesName: item.subspeciesName != null ? String(item.subspeciesName) : null,
      CurrentTaxonFlag: item.currentTaxonFlag != null ? item.currentTaxonFlag : null,
      ObsoleteTaxonFlag: item.obsoleteTaxonFlag != null ? item.obsoleteTaxonFlag : null,
      GenusAuthority: item.genusAuthority != null ? String(item.genusAuthority) : null,
      SpeciesAuthority: item.speciesAuthority != null ? String(item.speciesAuthority) : null,
      SubspeciesAuthority: item.subspeciesAuthority != null ? String(item.subspeciesAuthority) : null,
      SpeciesIDLevel: item.speciesIDLevel != null ? String(item.speciesIDLevel) : null,
      SpeciesFieldFamily: item.speciesFieldFamily != null ? String(item.speciesFieldFamily) : null,
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
      currentTaxonFlag: item.CurrentTaxonFlag != null ? bitToBoolean(item.CurrentTaxonFlag) : undefined,
      obsoleteTaxonFlag: item.ObsoleteTaxonFlag != null ? bitToBoolean(item.ObsoleteTaxonFlag) : undefined,
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

