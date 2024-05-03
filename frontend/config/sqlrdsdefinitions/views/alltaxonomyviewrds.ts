import { GridColDef, GridValidRowModel } from "@mui/x-data-grid";
import { IDataMapper, parseDate } from "../../datamapper";
import { bitToBoolean } from "@/config/macros";
import { detectFieldChanges, generateUpdateQueries } from "@/components/processors/processorhelperfunctions";

export type AllTaxonomyViewRDS = {
  id: number;
  speciesID: number;
  speciesCode: string;
  familyID: number;
  family: string | null;
  genusID: number;
  genus: string | null;
  genusAuthority: string | null;
  speciesName: string | null;
  subspeciesName: string | null;
  speciesIDLevel: string | null;
  speciesAuthority: string | null;
  subspeciesAuthority: string | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  fieldFamily: string | null;
  speciesDescription: string | null;
  referenceID: number;
  publicationTitle: string | null;
  dateOfPublication: Date | null;
  citation: string | null;
}

export interface AllTaxonomyViewResult {
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

export class AllTaxonomyViewMapper implements IDataMapper<AllTaxonomyViewResult, AllTaxonomyViewRDS> {
  demapData(results: AllTaxonomyViewRDS[]): AllTaxonomyViewResult[] {
    return results.map(item => ({
      SpeciesID: item.speciesID,
      SpeciesCode: item.speciesCode,
      FamilyID: item.familyID,
      Family: item.family,
      GenusID: item.genusID,
      Genus: item.genus,
      GenusAuthority: item.genusAuthority,
      SpeciesName: item.speciesName,
      SubspeciesName: item.subspeciesName,
      SpeciesIDLevel: item.speciesIDLevel,
      SpeciesAuthority: item.speciesAuthority,
      SubspeciesAuthority: item.subspeciesAuthority,
      CurrentTaxonFlag: item.currentTaxonFlag,
      ObsoleteTaxonFlag: item.obsoleteTaxonFlag,
      FieldFamily: item.fieldFamily,
      SpeciesDescription: item.speciesDescription,
      ReferenceID: item.referenceID,
      PublicationTitle: item.publicationTitle,
      FullReference: `${item.publicationTitle} (${item.dateOfPublication?.toISOString()})`,
      DateOfPublication: item.dateOfPublication,
      Citation: item.citation
    }));
  }
  mapData(results: AllTaxonomyViewResult[], indexOffset: number = 1): AllTaxonomyViewRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      speciesID: Number(item.SpeciesID),
      speciesCode: String(item.SpeciesCode),
      familyID: Number(item.FamilyID),
      family: String(item.Family),
      genusID: Number(item.GenusID),
      genus: String(item.Genus),
      genusAuthority: String(item.GenusAuthority),
      speciesName: String(item.SpeciesName),
      subspeciesName: String(item.SubspeciesName),
      speciesIDLevel: String(item.SpeciesIDLevel),
      speciesAuthority: String(item.SpeciesAuthority),
      subspeciesAuthority: String(item.SubspeciesAuthority),
      currentTaxonFlag: bitToBoolean(item.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(item.ObsoleteTaxonFlag),
      fieldFamily: String(item.FieldFamily),
      speciesDescription: String(item.SpeciesDescription),
      referenceID: Number(item.ReferenceID),
      publicationTitle: String(item.PublicationTitle),
      dateOfPublication: parseDate(item.DateOfPublication),
      citation: String(item.Citation)
    }));
  }
}
export const AllTaxonomyViewGridColumns: GridColDef[] = [
  { field: 'speciesID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left', type: 'number', editable: false },
  { field: 'speciesCode', headerName: 'SpCode', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'subspeciesName', headerName: 'Subspecies', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'genusAuthority', headerName: 'Genus Authority', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'speciesAuthority', headerName: 'Species Authority', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'publicationTitle', headerName: 'Publication', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'dateOfPublication', headerName: 'Publish Date', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
  { field: 'citation', headerName: 'Citation', headerClassName: 'header', flex: 1, align: 'left', type: 'string', editable: true },
];

