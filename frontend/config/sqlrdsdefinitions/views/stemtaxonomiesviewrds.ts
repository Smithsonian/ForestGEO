import { IDataMapper } from "@/config/datamapper";
import { ColumnStates } from "@/config/macros";
import { createInitialObject, ResultType } from "@/config/utils";

export const initialStemTaxonomiesViewRDSRow = createInitialObject<StemTaxonomiesViewRDS>();

export type StemTaxonomiesViewRDS = {
  id?: number;
  stemID?: number;
  treeID?: number;
  speciesID?: number;
  genusID?: number;
  familyID?: number;
  quadratID?: number;
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

export type StemTaxonomiesViewResult = ResultType<StemTaxonomiesViewRDS>;

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
