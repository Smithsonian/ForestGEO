export type Tree = {
  Type: string;
  CensusId: number;
  PlotId: number;
  SiteId: 0;
  Tag: string;
  Subquadrat: number;
  SpCode: string;
  StemTag: string;
  DBH: number | undefined; // undefined is for prun N-1 data that is populated in old tree form.
  Htmeas: number | undefined; // undefined is for prun N-1 data that is populated in old tree form.
  Codes: string;
  Comments: string;
  Errors?: CloudValidationError[]; // Errors resulting from cloud-side validation when POST'ing the tree.
};

export type CloudValidationError = {
  ErrorCode: number
  Column: string
  Message: string
}
