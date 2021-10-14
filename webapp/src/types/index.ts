export type Subquadrat = {
  id: string;
  trees: Tree[];
};

export type Quadrat = {
  id: string;
  subquadrats: Subquadrat[];
};

export type Tree = {
  tag: number;
  stems: Stem[];
};

export type Stem = {
  Type: string;
  CensusId: number;
  SiteId: 0;
  Tag: number;
  Subquadrat: number;
  SpCode: string;
  StemTag:number;
  DBH: number;
  Codes: string;
  Comments: string;
};
