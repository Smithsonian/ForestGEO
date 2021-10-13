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
    siteId: number;
    subquadrat: string;
    tag: number;
    stemTag: number;
    spCode: string;
    dbh: number;
    codes: string;
    comments: string;
};
