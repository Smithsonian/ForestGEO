import ConnectionManager from '@/config/connectionmanager';

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

export function createSelectQuery<Result>(schema: string, tableName: string, whereClause: Partial<Result>, limiter?: number): string {
  const whereKeys = Object.keys(whereClause);

  if (whereKeys.length === 0) {
    throw new Error('No conditions provided for WHERE clause');
  }

  const whereConditions = whereKeys
    .map(key => `\`${key}\` = ?`) // Escaping column names with backticks
    .join(' AND ');

  return `SELECT *
          FROM \`${schema}\`.\`${tableName}\`
          WHERE ${whereConditions} ${limiter ? `LIMIT ${limiter}` : ``}`;
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

  return `INSERT INTO \`${schema}\`.\`${tableName}\` (${columns})
          VALUES (${values})
          ON DUPLICATE KEY UPDATE ${updates}`;
}

export async function fetchPrimaryKey<Result>(
  schema: string,
  table: string,
  whereClause: Partial<Result>,
  connectionManager: ConnectionManager,
  primaryKeyColumn: keyof Result
): Promise<number> {
  const query = createSelectQuery<Result>(schema, table, whereClause);
  const rows: Result[] = await connectionManager.executeQuery(query, Object.values(whereClause));

  if (rows.length === 0) {
    throw new Error(`${Object.values(whereClause).join(' ')} not found in ${table}.`);
  }

  // Retrieve and return the primary key value from the result
  return rows[0][primaryKeyColumn] as unknown as number;
}

export async function handleUpsert<Result>(
  connectionManager: ConnectionManager,
  schema: string,
  tableName: string,
  data: Partial<Result>,
  key: keyof Result
): Promise<{ id: number; operation?: string }> {
  if (!Object.keys(data).length) {
    throw new Error(`No data provided for upsert operation on table ${tableName}`);
  }
  let id: number = 0;

  try {
    const query = createInsertOrUpdateQuery<Result>(schema, tableName, data);
    const result = await connectionManager.executeQuery(query, Object.values(data));
    id = result.insertId;

    if (id === 0) {
      // console.log('existing record found, updating...');
      const fieldsToSearch = Object.keys(data).filter(field => field !== 'UserDefinedFields' && data[field as keyof Result] !== null);

      const whereConditions = fieldsToSearch
        .map(field => {
          const value = data[field as keyof Result];
          if (value === null) {
            return `\`${field}\` IS NULL`;
          } else {
            return `\`${field}\` = ?`;
          }
        })
        .join(' AND ');

      const values = fieldsToSearch.map(field => {
        const value = data[field as keyof Result];
        if (typeof value === 'string' && /^[+-]?\d*\.\d+$/.test(value)) {
          return parseFloat(value); // Convert to number
        }
        return value;
      });

      if (Buffer.byteLength(JSON.stringify(values)) > 4194304) {
        // 4MB
        throw new Error('Query exceeds MySQL max_allowed_packet size.');
      }

      const findExistingQuery = `SELECT *
                                 FROM \`${schema}\`.\`${tableName}\`
                                 WHERE ${whereConditions}`;
      // console.log('find existing query: ', findExistingQuery, 'values: ', values);

      const searchResult = await connectionManager.executeQuery(findExistingQuery, values);
      // console.log('find existing query search result: ', searchResult);

      if (searchResult.length > 0) {
        id = searchResult[0][key as keyof Result] as unknown as number;
        return { id, operation: 'updated' };
      } else {
        console.error(`Record not found after update. Data: ${JSON.stringify(data)}, Query: ${findExistingQuery}, Values: ${values}`);
        throw new Error(`Upsert failed: Record in ${tableName} could not be found after update.`);
      }
    }

    return { id, operation: 'inserted' };
  } catch (e: any) {
    console.error('Error in handleUpsert:', e.message, 'Stack:', e.stack);
    throw createError(e.message, e);
  }
}

export function createError(message: string, context: any): Error {
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

export function capitalizeAndTransformField(field: string): string {
  const capitalized = capitalizeFirstLetter(field);
  return transformSpecialCases(capitalized);
}

export type TransformedKeys<T> = keyof ResultType<T>;

export function getTransformedKeys<T>(): string[] {
  const exampleObject: ResultType<T> = {} as ResultType<T>;
  return Object.keys(exampleObject) as string[];
}

export function getUpdatedValues<T extends Record<string, any>>(original: T, updated: T): Partial<T> {
  const changes: Partial<T> = {};

  Object.keys(original).forEach(key => {
    const typedKey = key as keyof T;
    if (original[typedKey] !== updated[typedKey]) {
      changes[typedKey] = updated[typedKey];
    }
  });

  return changes;
}

export function mysqlEscape(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  throw new Error('Unsupported value type');
}

export function formatQuery(query: string, values: any[]): string {
  let valueIndex = 0; // Pointer for values
  return query
    .replace(/\?\?/g, () => {
      const identifier = values[valueIndex++];
      if (Array.isArray(identifier) && identifier.length === 2) {
        // If identifier is [schema, table], format it as `schema`.`table`
        const [schema, table] = identifier;
        return `\`${schema.replace(/`/g, '``')}\`.\`${table.replace(/`/g, '``')}\``;
      } else if (typeof identifier === 'string') {
        // Single string identifier
        return `\`${identifier.replace(/`/g, '``')}\``;
      } else {
        throw new Error(`Invalid identifier for ?? placeholder: ${JSON.stringify(identifier)}`);
      }
    })
    .replace(/\?/g, () => {
      const value = values[valueIndex++];
      if (value === null || value === undefined) return 'NULL';
      if (typeof value === 'number') return value.toString();
      if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
      if (typeof value === 'object' && !Array.isArray(value)) {
        return Object.entries(value)
          .map(([key, val]) => `\`${key}\` = ${mysqlEscape(val)}`)
          .join(', ');
      }
      if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
      throw new Error(`Unsupported value type: ${typeof value}`);
    });
}
