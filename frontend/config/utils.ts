import ConnectionManager from '@/config/connectionmanager';
import ailogger from '@/ailogger';

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
  : T extends `${infer Prefix}defaultUOMDBH${infer Suffix}`
    ? `${Prefix}DefaultUOMDBH${Suffix}`
    : T extends `${infer Prefix}defaultUOMHOM${infer Suffix}`
      ? `${Prefix}DefaultUOMHOM${Suffix}`
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
                      : T extends `${infer Prefix}caID${infer Suffix}`
                        ? `${Prefix}CAID${Suffix}`
                        : T extends `${infer Prefix}CaID${infer Suffix}`
                          ? `${Prefix}CAID${Suffix}`
                          : T extends `${infer Prefix}cpID${infer Suffix}`
                            ? `${Prefix}CPID${Suffix}`
                            : T extends `${infer Prefix}CpID${infer Suffix}`
                              ? `${Prefix}CPID${Suffix}`
                              : T extends `${infer Prefix}csID${infer Suffix}`
                                ? `${Prefix}CSID${Suffix}`
                                : T extends `${infer Prefix}CsID${infer Suffix}`
                                  ? `${Prefix}CSID${Suffix}`
                                  : T extends `${infer Prefix}sqDimX${infer Suffix}`
                                    ? `${Prefix}SQDimX${Suffix}`
                                    : T extends `${infer Prefix}SqDimX${infer Suffix}`
                                      ? `${Prefix}SQDimX${Suffix}`
                                      : T extends `${infer Prefix}sqDimY${infer Suffix}`
                                        ? `${Prefix}SQDimY${Suffix}`
                                        : T extends `${infer Prefix}SqDimY${infer Suffix}`
                                          ? `${Prefix}SQDimY${Suffix}`
                                          : T;

// Utility type to omit specific keys
export type OmitKey<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;

// Utility type to create a Result type from an RDS type
export type ResultType<RDS, K extends keyof any = 'id' | '_pk'> = {
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
  const typeMap: Record<string, any> = {
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

export function buildBulkUpsertQuery<T extends Record<string, any>>(schema: string, table: string, rows: Partial<T>[], key: keyof T) {
  if (!rows.length) {
    throw new Error('No rows provided for bulk upsert');
  }

  // 1) All the columns we're inserting/updating (assume every row has the same set)
  const columns = Object.keys(rows[0]);

  // 2) Build placeholders: "(?,?),(?,?),(?,?)…"
  const group = `(${columns.map(() => '?').join(',')})`;
  const placeholders = rows.map(() => group).join(',');

  // 3) flatten values: [ row0.col0, row0.col1, …, row1.col0, row1.col1, …, … ]
  const params: any[] = [];
  for (const row of rows) {
    for (const col of columns) {
      params.push(row[col]);
    }
  }

  // 4) ON DUPLICATE KEY UPDATE clause (skip the primary key itself)
  const updates = columns
    .filter(c => c !== String(key))
    .map(c => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(',');

  // 5) assemble
  const sql =
    `INSERT INTO \`${schema}\`.\`${table}\` (` + columns.map(c => `\`${c}\``).join(',') + `) VALUES ${placeholders}` + ` ON DUPLICATE KEY UPDATE ${updates};`;

  return { sql, params };
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
  let id = 0;

  const trimmed = Object.fromEntries(Object.entries(data).filter(([_, value]) => value)) as unknown as Partial<Result>;

  try {
    const query = createInsertOrUpdateQuery<Result>(schema, tableName, trimmed);
    const result = await connectionManager.executeQuery(query, Object.values(trimmed));
    id = result.insertId;

    if (id === 0) {
      // console.log('existing record found, updating...');
      const fieldsToSearch = Object.keys(trimmed).filter(field => field !== 'UserDefinedFields' && trimmed[field as keyof Result] !== null);

      const whereConditions = fieldsToSearch
        .map(field => {
          const value = trimmed[field as keyof Result];
          if (value === null) {
            return `\`${field}\` IS NULL`;
          } else {
            return `\`${field}\` = ?`;
          }
        })
        .join(' AND ');

      const values = fieldsToSearch.map(field => {
        const value = trimmed[field as keyof Result];
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

      if (searchResult.length > 0) {
        id = searchResult[0][key as keyof Result] as unknown as number;
        return { id, operation: 'updated' };
      } else {
        ailogger.error(`Record not found after update. Data: ${JSON.stringify(trimmed)}, Query: ${findExistingQuery}, Values: ${values}`);
        throw new Error(`Upsert failed: Record in ${tableName} could not be found after update.`);
      }
    }

    return { id, operation: 'inserted' };
  } catch (e: any) {
    ailogger.error(`Error in handleUpsert: ${e.message} | Stack: ${e.stack}`);
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
