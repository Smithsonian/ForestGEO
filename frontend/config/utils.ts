import { PoolConnection } from 'mysql2/promise';
import { runQuery } from '@/components/processors/processormacros';

export const openSidebar = () => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.setProperty('--SideNavigation-slideIn', '1');
  }
};

export const closeSidebar = () => {
  if (typeof document !== 'undefined') {
    document.documentElement.style.removeProperty('--SideNavigation-slideIn');
    document.body.style.removeProperty('overflow');
  }
};

export const toggleSidebar = () => {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const slideIn = window.getComputedStyle(document.documentElement).getPropertyValue('--SideNavigation-slideIn');
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
export type TransformSpecialCases<T extends string> = T extends `${infer Prefix}CqID${infer Suffix}`
  ? `${Prefix}CQID${Suffix}`
  : T extends `${infer Prefix}dbh${infer Suffix}`
    ? `${Prefix}DBH${Suffix}`
    : T extends `${infer Prefix}Dbh${infer Suffix}`
      ? `${Prefix}DBH${Suffix}`
      : T extends `${infer Prefix}hom${infer Suffix}`
        ? `${Prefix}HOM${Suffix}`
        : T extends `${infer Prefix}Hom${infer Suffix}`
          ? `${Prefix}HOM${Suffix}`
          : T extends `${infer Prefix}Id${infer Suffix}`
            ? `${Prefix}ID${Suffix}`
            : T extends `${infer Prefix}cma${infer Suffix}`
              ? `${Prefix}CMA${Suffix}`
              : T extends `${infer Prefix}Cma${infer Suffix}`
                ? `${Prefix}CMA${Suffix}`
                : T extends `${infer Prefix}cqID${infer Suffix}`
                  ? `${Prefix}CQID${Suffix}`
                  : T;

// Utility type to omit specific keys
export type OmitKey<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

// Utility type to create a Result type from an RDS type
export type ResultType<RDS, K extends keyof any = 'id'> = {
  [P in keyof OmitKey<RDS, K> as TransformSpecialCases<CapitalizeFirstLetter<P & string>>]: any;
};

export type InitialValue<T> = T extends string
  ? ''
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
            : T extends (...args: any[]) => any
              ? (...args: any[]) => any
              : undefined;

export function createInitialObject<T>(): { [K in keyof T]: InitialValue<T[K]> } {
  const typeMap: { [key: string]: any } = {
    string: '',
    number: 0,
    boolean: false,
    object: null,
    bigint: BigInt(0),
    function: () => {},
    symbol: Symbol()
  };

  // Create an object where each property of T is initialized based on its type
  const initializedObject = {} as { [K in keyof T]: InitialValue<T[K]> };

  // Initialize all properties of T in the proxy
  for (const prop in initializedObject) {
    const propType = typeof initializedObject[prop as keyof T];
    initializedObject[prop as keyof T] =
      prop.toLowerCase().includes('id') && true
        ? 0 // If the property name includes 'id', set it to 0
        : (typeMap[propType as keyof typeof typeMap] ?? null); // Otherwise, assign default value based on type
  }

  return new Proxy(initializedObject, {
    get: (target, prop) => {
      if (typeof prop === 'string' && prop.toLowerCase().includes('id')) {
        return 0; // Set the id field to 0
      }
      const propType = typeof target[prop as keyof T];
      return typeMap[propType as keyof typeof typeMap] ?? null;
    }
  }) as { [K in keyof T]: InitialValue<T[K]> };
}

export function createSelectQuery<Result>(schema: string, tableName: string, whereClause: Partial<Result>): string {
  const whereKeys = Object.keys(whereClause);

  if (whereKeys.length === 0) {
    throw new Error('No conditions provided for WHERE clause');
  }

  const whereConditions = whereKeys
    .map(key => `\`${key}\` = ?`) // Escaping column names with backticks
    .join(' AND ');

  return `SELECT * FROM \`${schema}\`.\`${tableName}\` WHERE ${whereConditions}`;
}

export function createInsertOrUpdateQuery<Result>(schema: string, tableName: string, data: Partial<Result>): string {
  const columns = Object.keys(data)
    .map(key => `\`${key}\``) // Escaping column names with backticks
    .join(', ');

  const values = Object.keys(data)
    .map(() => '?')
    .join(', ');

  const updates = Object.keys(data)
    .map(key => `\`${key}\` = VALUES(\`${key}\`)`)
    .join(', ');

  return `INSERT INTO \`${schema}\`.\`${tableName}\` (${columns}) VALUES (${values}) ON DUPLICATE KEY UPDATE ${updates}`;
}

export async function fetchPrimaryKey<Result>(
  schema: string,
  table: string,
  whereClause: Partial<Result>,
  connection: PoolConnection,
  primaryKeyColumn: keyof Result
): Promise<number> {
  const query = createSelectQuery<Result>(schema, table, whereClause);
  const rows: Result[] = await runQuery(connection, query, Object.values(whereClause));

  if (rows.length === 0) {
    throw new Error(`${Object.values(whereClause).join(' ')} not found in ${table}.`);
  }

  console.log(`${Object.values(whereClause).join(' ')} found in ${table}.`);

  // Retrieve and return the primary key value from the result
  return rows[0][primaryKeyColumn] as unknown as number;
}

export async function handleUpsert<Result>(
  connection: PoolConnection,
  schema: string,
  tableName: string,
  data: Partial<Result>,
  key: keyof Result
): Promise<number> {
  if (!Object.keys(data).length) {
    throw new Error(`No data provided for upsert operation on table ${tableName}`);
  }

  console.log('handleUpsert data:', data);

  const query = createInsertOrUpdateQuery<Result>(schema, tableName, data);
  console.log('handleUpsert query:', query);

  const result = await runQuery(connection, query, Object.values(data));

  let id = result.insertId;

  if (id === 0) {
    const findExisting = createSelectQuery<Result>(schema, tableName, data);
    console.log('handleUpsert findExisting query:', findExisting);
    const searchResult = await runQuery(connection, findExisting, Object.values(data));

    if (searchResult.length > 0) {
      id = searchResult[0][key as keyof Result] as unknown as number;
    } else {
      throw new Error(`Unknown error. InsertId was 0, but manually searching for ${tableName} by ${String(key)} also failed.`);
    }
  }

  return id;
}

export function createError(message: string, context: any) {
  const error = new Error(message);
  error.name = 'ProcessingError';
  console.error(message, context);
  return error;
}

export type UniqueKeys<T, U> = {
  [K in keyof (T & U)]: K extends keyof T ? (K extends keyof U ? never : K) : K;
}[keyof (T & U)];
export type Unique<T, U> = Pick<T & U, UniqueKeys<T, U>>;

export type CommonKeys<T, U> = {
  [K in keyof T & keyof U]: K;
}[keyof T & keyof U];

export type Common<T, U> = Pick<T & U, CommonKeys<T, U>>;

export function capitalizeFirstLetter(field: string): string {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

export function transformSpecialCases(field: string): string {
  // Special case for ValidCode
  if (/validcode/i.test(field)) {
    return field.replace(/validcode/gi, 'ValidCode');
  }

  // Transform DBH, HOM, and CMA cases
  if (/dbh/i.test(field)) {
    return field.replace(/dbh/gi, 'DBH');
  } else if (/hom/i.test(field)) {
    return field.replace(/hom/gi, 'HOM');
  } else if (/cma/i.test(field)) {
    return field.replace(/cma/gi, 'CMA');
  } else if (/cq/i.test(field)) {
    return field.replace(/cq/gi, 'CQ');
  }

  // General transformation for ID
  if (/id/i.test(field)) {
    return field.replace(/id/gi, 'ID');
  }

  return field;
}

// Combined function that first capitalizes and then applies the special cases
export function capitalizeAndTransformField(field: string): string {
  const capitalized = capitalizeFirstLetter(field);
  return transformSpecialCases(capitalized);
}
