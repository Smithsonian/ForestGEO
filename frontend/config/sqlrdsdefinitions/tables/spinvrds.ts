// species inventory custom data type

export type SpeciesInventoryRDS = {
  id: number;
  speciesInventoryID: number;
  censusID: number | null;
  plotID: number | null;
  speciesID: number | null;
  subSpeciesID: number | null;
};

export interface SpeciesInventoryResult {
  SpeciesInventoryID: any;
  CensusID: any;
  PlotID: any;
  SpeciesID: any;
  SubSpeciesID: any;
}