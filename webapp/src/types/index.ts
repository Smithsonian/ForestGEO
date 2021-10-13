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
    Tag: number;
    Subquadrat: number;
    SpCode: string;
    DBH: number;
    Htmeas: number;
    Codes: string;
    Comments: string;
}
