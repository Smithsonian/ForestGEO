export type Subquadrat = {
    id: string;
    quadratId: string;
};

export type Quadrat = {
    id: string;
    label: string;
};

export type Tree = {
    subquadratId: string;
    tag: number;
}

export type Stem = {
    stemTag: number;
    tree: Tree;
    spCode: string;
    dbh: number;
    codes: string[];
    comments: string;
}