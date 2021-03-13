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
    stems: Stem[]
}

export type Stem = {
    Subquadrat: string;
    Tag: number;
    StemTag: number;
    SpCode: string;
    DBH: number;
    Codes: string;
    Comments: string;
}