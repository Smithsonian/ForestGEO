// alltaxonomiesview custom data type
import {IDataMapper, parseDate} from "../../datamapper";
import {ColumnStates} from "@/config/macros";

export type AllTaxonomiesViewRDS = {
  id?: number;
  speciesID?: number;
  speciesCode?: string;
  familyID?: number;
  family?: string;
  genusID?: number;
  genus?: string;
  genusAuthority?: string;
  speciesName?: string;
  subspeciesName?: string;
  speciesIDLevel?: string;
  speciesAuthority?: string;
  subspeciesAuthority?: string;
  fieldFamily?: string;
  speciesDescription?: string;
  referenceID?: number;
  publicationTitle?: string;
  dateOfPublication?: Date;
  citation?: string;
};

export interface AllTaxonomiesViewResult {
  SpeciesID: any;
  SpeciesCode: any;
  FamilyID: any;
  Family: any;
  GenusID: any;
  Genus: any;
  GenusAuthority: any;
  SpeciesName: any;
  SubspeciesName: any;
  SpeciesIDLevel: any;
  SpeciesAuthority: any;
  SubspeciesAuthority: any;
  FieldFamily: any;
  SpeciesDescription: any;
  ReferenceID: any;
  PublicationTitle: any;
  FullReference: any;
  DateOfPublication: any;
  Citation: any;
};

export const initialAllTaxonomiesViewRDSRow = {
  id: 0,
  speciesID: 0,
  speciesCode: '',
  familyID: 0,
  family: '',
  genusID: 0,
  genus: '',
  genusAuthority: '',
  speciesName: '',
  subspeciesName: '',
  speciesIDLevel: '',
  speciesAuthority: '',
  subspeciesAuthority: '',
  fieldFamily: '',
  speciesDescription: '',
  referenceID: 0,
  publicationTitle: '',
  dateOfPublication: undefined,
  citation: '',
};

export class AllTaxonomiesViewMapper implements IDataMapper<AllTaxonomiesViewResult, AllTaxonomiesViewRDS> {
  demapData(results: AllTaxonomiesViewRDS[]): AllTaxonomiesViewResult[] {
    return results.map(item => ({
      SpeciesID: item.speciesID !== undefined ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode !== undefined ? String(item.speciesCode) : null,
      FamilyID: item.familyID !== undefined ? String(item.familyID) : null,
      Family: item.family !== undefined ? String(item.family) : null,
      GenusID: item.genusID !== undefined ? String(item.genusID) : null,
      Genus: item.genus !== undefined ? String(item.genus) : null,
      GenusAuthority: item.genusAuthority !== undefined ? String(item.genusAuthority) : null,
      SpeciesName: item.speciesName !== undefined ? String(item.speciesName) : null,
      SubspeciesName: item.subspeciesName !== undefined ? String(item.subspeciesName) : null,
      SpeciesIDLevel: item.speciesIDLevel !== undefined ? String(item.speciesIDLevel) : null,
      SpeciesAuthority: item.speciesAuthority !== undefined ? String(item.speciesAuthority) : null,
      SubspeciesAuthority: item.subspeciesAuthority !== undefined ? String(item.subspeciesAuthority) : null,
      FieldFamily: item.fieldFamily !== undefined ? String(item.fieldFamily) : null,
      SpeciesDescription: item.speciesDescription !== undefined ? String(item.speciesDescription) : null,
      ReferenceID: item.referenceID !== undefined ? String(item.referenceID) : null,
      PublicationTitle: item.publicationTitle !== undefined ? String(item.publicationTitle) : null,
      FullReference: `${item.publicationTitle} (${item.dateOfPublication?.toISOString()})`,
      DateOfPublication: item.dateOfPublication !== undefined ? item.dateOfPublication.toISOString() : null,
      Citation: item.citation !== undefined ? String(item.citation) : null,
    }));
  }

  mapData(results: AllTaxonomiesViewResult[], indexOffset: number = 1): AllTaxonomiesViewRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      speciesID: item.SpeciesID != null ? Number(item.SpeciesID) : undefined,
      speciesCode: item.SpeciesCode != null ? String(item.SpeciesCode) : undefined,
      familyID: item.FamilyID != null ? Number(item.FamilyID) : undefined,
      family: item.Family != null ? String(item.Family) : undefined,
      genusID: item.GenusID != null ? Number(item.GenusID) : undefined,
      genus: item.Genus != null ? String(item.Genus) : undefined,
      genusAuthority: item.GenusAuthority != null ? String(item.GenusAuthority) : undefined,
      speciesName: item.SpeciesName != null ? String(item.SpeciesName) : undefined,
      subspeciesName: item.SubspeciesName != null ? String(item.SubspeciesName) : undefined,
      speciesIDLevel: item.SpeciesIDLevel != null ? String(item.SpeciesIDLevel) : undefined,
      speciesAuthority: item.SpeciesAuthority != null ? String(item.SpeciesAuthority) : undefined,
      subspeciesAuthority: item.SubspeciesAuthority != null ? String(item.SubspeciesAuthority) : undefined,
      fieldFamily: item.FieldFamily != null ? String(item.FieldFamily) : undefined,
      speciesDescription: item.SpeciesDescription != null ? String(item.SpeciesDescription) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      publicationTitle: item.PublicationTitle != null ? String(item.PublicationTitle) : undefined,
      dateOfPublication: item.DateOfPublication != null ? parseDate(item.DateOfPublication) : undefined,
      citation: item.Citation != null ? String(item.Citation) : undefined,
    }));
  }
};

export function getAllTaxonomiesViewHCs(): ColumnStates {
  return {
    familyID: false,
    genusID: false,
    referenceID: false,
  };
};