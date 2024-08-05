import "reflect-metadata";

export const openSidebar = () => {
  if (typeof document !== "undefined") {
    document.body.style.overflow = "hidden";
    document.documentElement.style.setProperty("--SideNavigation-slideIn", "1");
  }
};

export const closeSidebar = () => {
  if (typeof document !== "undefined") {
    document.documentElement.style.removeProperty("--SideNavigation-slideIn");
    document.body.style.removeProperty("overflow");
  }
};

export const toggleSidebar = () => {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const slideIn = window.getComputedStyle(document.documentElement).getPropertyValue("--SideNavigation-slideIn");
    if (slideIn) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }
};

// Utility type to capitalize the first letter of each key
export type CapitalizeFirstLetter<T extends string> = T extends `${infer F}${infer R}` ? `${Uppercase<F>}${R}` : T;

// Utility type to transform 'dbh' and 'hom' to uppercase
export type TransformSpecialCases<T extends string> = T extends `${infer Prefix}dbh${infer Suffix}`
  ? `${Prefix}DBH${Suffix}`
  : T extends `${infer Prefix}Dbh${infer Suffix}`
    ? `${Prefix}DBH${Suffix}`
    : T extends `${infer Prefix}hom${infer Suffix}`
      ? `${Prefix}HOM${Suffix}`
      : T extends `${infer Prefix}Hom${infer Suffix}`
        ? `${Prefix}HOM${Suffix}`
        : T extends `${infer Prefix}Id${infer Suffix}`
          ? `${Prefix}ID${Suffix}`
          : T;

// Utility type to omit specific keys
export type OmitKey<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

// Utility type to create a Result type from an RDS type
export type ResultType<RDS, K extends keyof any = "id"> = {
  [P in keyof OmitKey<RDS, K> as TransformSpecialCases<CapitalizeFirstLetter<P & string>>]: any;
};

export type InitialValue<T> = T extends string
  ? ""
  : T extends number
    ? 0
    : T extends boolean
      ? false
      : T extends Date
        ? null
        : T extends bigint
          ? bigint
          : T extends symbol
            ? symbol
            : T extends Function
              ? Function
              : undefined;

export function createInitialObject<T>(): { [K in keyof T]: InitialValue<T[K]> } {
  return new Proxy(
    {},
    {
      get: (target, prop) => {
        if (typeof prop === "string" && prop.toLowerCase().includes("id")) {
          return 0; // Set the id field to 0
        }
        const typeMap: { [key: string]: any } = {
          string: "",
          number: 0,
          boolean: false,
          object: null,
          bigint: BigInt(0),
          function: () => {},
          symbol: Symbol()
        };
        const propType = typeof ({} as T)[prop as keyof T];
        return typeMap[propType as keyof typeof typeMap] ?? null;
      }
    }
  ) as { [K in keyof T]: InitialValue<T[K]> };
}

export type UniqueKeys<T, U> = {
  [K in keyof (T & U)]: K extends keyof T ? (K extends keyof U ? never : K) : K;
}[keyof (T & U)];
export type Unique<T, U> = Pick<T & U, UniqueKeys<T, U>>;

export type CommonKeys<T, U> = {
  [K in keyof T & keyof U]: K;
}[keyof T & keyof U];

export type Common<T, U> = Pick<T & U, CommonKeys<T, U>>;

export function getColumnMappings<RDS, Result extends ResultType<RDS>>(): { [key in keyof Result]: string } {
  const mappings: { [key in keyof Result]: string } = {} as { [key in keyof Result]: string };

  for (const key in mappings) {
    mappings[key] = key;
  }

  return mappings;
}

export function createSelectQuery<RDS, Result extends ResultType<RDS>>(schema: string, tableName: string, whereClause: Partial<Result>): string {
  const columnMappings = getColumnMappings<RDS, Result>();
  const whereConditions = Object.keys(whereClause)
    .map(key => `${columnMappings[key as keyof Result]} = ?`)
    .join(" AND ");

  return `SELECT * FROM ${schema}.${tableName} WHERE ${whereConditions}`;
}

export function createInsertOrUpdateQuery<RDS, Result extends ResultType<RDS>>(schema: string, tableName: string, data: Partial<Result>): string {
  const columnMappings = getColumnMappings<RDS, Result>();
  const columns = Object.keys(data)
    .map(key => columnMappings[key as keyof Result])
    .join(", ");
  const values = Object.keys(data)
    .map(() => "?")
    .join(", ");
  const updates = Object.keys(data)
    .map(key => `${columnMappings[key as keyof Result]} = VALUES(${columnMappings[key as keyof Result]})`)
    .join(", ");

  return `INSERT INTO ${schema}.${tableName} (${columns}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updates}`;
}
