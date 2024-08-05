// alltaxonomiesview custom data type
import { createInitialObject, ResultType } from "@/config/utils";
import { ColumnStates } from "@/config/macros";

export const initialAllTaxonomiesViewRDSRow = createInitialObject<AllTaxonomiesViewRDS>();

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
};

export type AllTaxonomiesViewResult = ResultType<AllTaxonomiesViewRDS>;

export function getAllTaxonomiesViewHCs(): ColumnStates {
  return {
    familyID: false,
    genusID: false
  };
}
