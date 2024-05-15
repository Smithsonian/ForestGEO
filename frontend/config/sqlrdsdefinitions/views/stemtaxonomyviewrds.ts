import {IDataMapper} from "@/config/datamapper";
import {bitToBoolean} from "@/config/macros";
import {GridColDef, GridValidRowModel} from "@mui/x-data-grid";

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

export type StemTaxonomiesViewRDS = {
  id: number;
  stemID: number;
  stemTag: string;
  treeID: number;
  treeTag: string;
  speciesID: number | null;
  speciesCode: string | null;
  familyID: number | null;
  family: string | null;
  genusID: number | null;
  genus: string | null;
  speciesName: string | null;
  subspeciesName: string | null;
  currentTaxonFlag: boolean | null;
  obsoleteTaxonFlag: boolean | null;
  genusAuthority: string | null;
  speciesAuthority: string | null;
  subspeciesAuthority: string | null;
  speciesIDLevel: string | null;
  speciesFieldFamily: string | null;
}

export class StemTaxonomiesMapper implements IDataMapper<StemTaxonomiesViewResult, StemTaxonomiesViewRDS> {
  demapData(results: StemTaxonomiesViewRDS[]): StemTaxonomiesViewResult[] {
    return results.map((item) => ({
      StemID: item.stemID,
      StemTag: item.stemTag,
      TreeID: item.treeID,
      TreeTag: item.treeTag,
      SpeciesID: item.speciesID,
      SpeciesCode: item.speciesCode,
      FamilyID: item.familyID,
      Family: item.family,
      GenusID: item.genusID,
      Genus: item.genus,
      SpeciesName: item.speciesName,
      SubspeciesName: item.subspeciesName,
      CurrentTaxonFlag: item.currentTaxonFlag,
      ObsoleteTaxonFlag: item.obsoleteTaxonFlag,
      GenusAuthority: item.genusAuthority,
      SpeciesAuthority: item.speciesAuthority,
      SubspeciesAuthority: item.subspeciesAuthority,
      SpeciesIDLevel: item.speciesIDLevel,
      SpeciesFieldFamily: item.speciesFieldFamily
    }));
  }

  mapData(results: StemTaxonomiesViewResult[], indexOffset: number = 1): StemTaxonomiesViewRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      stemID: Number(item.StemID),
      stemTag: String(item.StemTag),
      treeID: Number(item.TreeID),
      treeTag: String(item.TreeTag),
      speciesID: Number(item.SpeciesID),
      speciesCode: String(item.SpeciesCode),
      familyID: Number(item.FamilyID),
      family: String(item.Family),
      genusID: Number(item.GenusID),
      genus: String(item.Genus),
      speciesName: String(item.SpeciesName),
      subspeciesName: String(item.SubspeciesName),
      currentTaxonFlag: bitToBoolean(item.CurrentTaxonFlag),
      obsoleteTaxonFlag: bitToBoolean(item.ObsoleteTaxonFlag),
      genusAuthority: String(item.GenusAuthority),
      speciesAuthority: String(item.SpeciesAuthority),
      subspeciesAuthority: String(item.SubspeciesAuthority),
      speciesIDLevel: String(item.SpeciesIDLevel),
      speciesFieldFamily: String(item.SpeciesFieldFamily)
    }));
  }
}

export const StemTaxonomiesViewGridColumns: GridColDef[] = [
  {field: 'stemID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'treeTag', headerName: 'Tree', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratName', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'plotName', headerName: 'Plot', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'locationName', headerName: 'Location', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'countryName', headerName: 'Country', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionX', headerName: 'QDimX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'quadratDimensionY', headerName: 'QDimY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemQuadX', headerName: 'SQuadX', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemQuadY', headerName: 'SQuadY', headerClassName: 'header', flex: 1, align: 'left'},
  {field: 'stemDescription', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left'},
];