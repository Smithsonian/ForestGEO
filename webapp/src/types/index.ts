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
    stemTag: number;
    spCode: string;
    dbh: number;
    codes: string[];
    comments: string;
}