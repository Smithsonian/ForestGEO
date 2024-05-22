import {GridColDef, GridValidRowModel} from "@mui/x-data-grid";
import {IDataMapper, parseDate} from "../../datamapper";
import {bitToBoolean} from "@/config/macros";

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
  currentTaxonFlag?: boolean;
  obsoleteTaxonFlag?: boolean;
  fieldFamily?: string;
  speciesDescription?: string;
  referenceID?: number;
  publicationTitle?: string;
  dateOfPublication?: Date;
  citation?: string;
}

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
  CurrentTaxonFlag: any;
  ObsoleteTaxonFlag: any;
  FieldFamily: any;
  SpeciesDescription: any;
  ReferenceID: any;
  PublicationTitle: any;
  FullReference: any;
  DateOfPublication: any;
  Citation: any;
}

export class AllTaxonomiesViewMapper implements IDataMapper<AllTaxonomiesViewResult, AllTaxonomiesViewRDS> {
  demapData(results: AllTaxonomiesViewRDS[]): AllTaxonomiesViewResult[] {
    return results.map(item => ({
      SpeciesID: item.speciesID != null ? String(item.speciesID) : null,
      SpeciesCode: item.speciesCode != null ? String(item.speciesCode) : null,
      FamilyID: item.familyID != null ? String(item.familyID) : null,
      Family: item.family != null ? String(item.family) : null,
      GenusID: item.genusID != null ? String(item.genusID) : null,
      Genus: item.genus != null ? String(item.genus) : null,
      GenusAuthority: item.genusAuthority != null ? String(item.genusAuthority) : null,
      SpeciesName: item.speciesName != null ? String(item.speciesName) : null,
      SubspeciesName: item.subspeciesName != null ? String(item.subspeciesName) : null,
      SpeciesIDLevel: item.speciesIDLevel != null ? String(item.speciesIDLevel) : null,
      SpeciesAuthority: item.speciesAuthority != null ? String(item.speciesAuthority) : null,
      SubspeciesAuthority: item.subspeciesAuthority != null ? String(item.subspeciesAuthority) : null,
      CurrentTaxonFlag: item.currentTaxonFlag != null ? item.currentTaxonFlag : null,
      ObsoleteTaxonFlag: item.obsoleteTaxonFlag != null ? item.obsoleteTaxonFlag : null,
      FieldFamily: item.fieldFamily != null ? String(item.fieldFamily) : null,
      SpeciesDescription: item.speciesDescription != null ? String(item.speciesDescription) : null,
      ReferenceID: item.referenceID != null ? String(item.referenceID) : null,
      PublicationTitle: item.publicationTitle != null ? String(item.publicationTitle) : null,
      FullReference: `${item.publicationTitle} (${item.dateOfPublication?.toISOString()})`,
      DateOfPublication: item.dateOfPublication != null ? item.dateOfPublication.toISOString() : null,
      Citation: item.citation != null ? String(item.citation) : null,
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
      currentTaxonFlag: item.CurrentTaxonFlag != null ? bitToBoolean(item.CurrentTaxonFlag) : undefined,
      obsoleteTaxonFlag: item.ObsoleteTaxonFlag != null ? bitToBoolean(item.ObsoleteTaxonFlag) : undefined,
      fieldFamily: item.FieldFamily != null ? String(item.FieldFamily) : undefined,
      speciesDescription: item.SpeciesDescription != null ? String(item.SpeciesDescription) : undefined,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      publicationTitle: item.PublicationTitle != null ? String(item.PublicationTitle) : undefined,
      dateOfPublication: item.DateOfPublication != null ? parseDate(item.DateOfPublication) : undefined,
      citation: item.Citation != null ? String(item.Citation) : undefined,
    }));
  }
}

export const AllTaxonomiesViewGridColumns: GridColDef[] = [
  {
    field: 'speciesID',
    headerName: '#',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'number',
    editable: false
  },
  {
    field: 'speciesCode',
    headerName: 'SpCode',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'family',
    headerName: 'Family',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'genus',
    headerName: 'Genus',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'speciesName',
    headerName: 'Species',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'subspeciesName',
    headerName: 'Subspecies',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'genusAuthority',
    headerName: 'Genus Auth',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'speciesAuthority',
    headerName: 'Species Auth',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'publicationTitle',
    headerName: 'Publication',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'dateOfPublication',
    headerName: 'Publish Date',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
  {
    field: 'citation',
    headerName: 'Citation',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'string',
    editable: true
  },
];

