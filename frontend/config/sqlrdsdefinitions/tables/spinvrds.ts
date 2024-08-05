// species inventory custom data type

import { ResultType } from "@/config/utils";

export type SpeciesInventoryRDS = {
  id: number;
  speciesInventoryID: number;
  censusID: number | null;
  plotID: number | null;
  speciesID: number | null;
  subSpeciesID: number | null;
};

export type SpeciesInventoryResult = ResultType<SpeciesInventoryRDS>;
