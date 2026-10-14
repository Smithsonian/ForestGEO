/**
 * Reads `INSERT INTO sitespecificvalidations ... VALUES` seeds from SQL source the way
 * MySQL would: quoted literals honour doubled quotes and backslash escapes, and
 * comments or statement separators inside literals are data, not syntax.
 */
export interface SiteValidationSeed {
  validationID: number;
  procedureName: string;
  description: string;
  criteria: string;
  definition: string;
}

export class ValidationSeedParseError extends Error {}

const SEED_TABLE = 'sitespecificvalidations';
const REQUIRED_SEED_COLUMNS = ['ValidationID', 'ProcedureName', 'Description', 'Criteria', 'Definition'] as const;
const MYSQL_BACKSLASH_ESCAPES: Readonly<Record<string, string>> = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
const LITERAL_KEYWORDS = new Set(['true', 'false', 'null']);

type Token = { kind: 'string' | 'number' | 'word' | 'punctuation'; text: string };
type SeedValue = string | number | boolean | null;

function readQuoted(sql: string, start: number): { text: string; end: number } {
  const quote = sql[start];
  let text = '';
  let index = start + 1;
  while (index < sql.length) {
    const character = sql[index];
    if (character === '\\' && index + 1 < sql.length) {
      const escaped = sql[index + 1];
      text += MYSQL_BACKSLASH_ESCAPES[escaped] ?? escaped;
      index += 2;
    } else if (character === quote && sql[index + 1] === quote) {
      text += quote;
      index += 2;
    } else if (character === quote) {
      return { text, end: index + 1 };
    } else {
      text += character;
      index += 1;
    }
  }
  throw new ValidationSeedParseError(`Unterminated ${quote} literal starting at offset ${start}`);
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];
    if (/\s/.test(character)) {
      index += 1;
    } else if (character === '#' || (character === '-' && next === '-' && (index + 2 >= sql.length || /\s/.test(sql[index + 2])))) {
      const lineEnd = sql.indexOf('\n', index);
      index = lineEnd === -1 ? sql.length : lineEnd + 1;
    } else if (character === '/' && next === '*') {
      const commentEnd = sql.indexOf('*/', index + 2);
      if (commentEnd === -1) throw new ValidationSeedParseError(`Unterminated block comment starting at offset ${index}`);
      index = commentEnd + 2;
    } else if (character === "'" || character === '"') {
      const literal = readQuoted(sql, index);
      tokens.push({ kind: 'string', text: literal.text });
      index = literal.end;
    } else if (character === '`') {
      const identifierEnd = sql.indexOf('`', index + 1);
      if (identifierEnd === -1) throw new ValidationSeedParseError(`Unterminated identifier starting at offset ${index}`);
      tokens.push({ kind: 'word', text: sql.slice(index + 1, identifierEnd) });
      index = identifierEnd + 1;
    } else if (/[0-9]/.test(character)) {
      const number = /^[0-9]+(?:\.[0-9]+)?/.exec(sql.slice(index))![0];
      tokens.push({ kind: 'number', text: number });
      index += number.length;
    } else if (/[A-Za-z_@$]/.test(character)) {
      const word = /^[A-Za-z0-9_@$]+/.exec(sql.slice(index))![0];
      tokens.push({ kind: 'word', text: word });
      index += word.length;
    } else {
      tokens.push({ kind: 'punctuation', text: character });
      index += 1;
    }
  }
  return tokens;
}

function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [[]];
  for (const token of tokens) {
    if (token.kind === 'punctuation' && token.text === ';') statements.push([]);
    else statements[statements.length - 1].push(token);
  }
  return statements.filter(statement => statement.length > 0);
}

function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === 'word' && token.text.toLowerCase() === word.toLowerCase();
}

function isPunctuation(token: Token | undefined, text: string): boolean {
  return token?.kind === 'punctuation' && token.text === text;
}

function expectPunctuation(statement: Token[], index: number, text: string): void {
  if (!isPunctuation(statement[index], text)) {
    throw new ValidationSeedParseError(`Expected "${text}" in ${SEED_TABLE} seed but found "${statement[index]?.text ?? 'end of statement'}"`);
  }
}

function readValue(statement: Token[], index: number): SeedValue {
  const token = statement[index];
  if (token?.kind === 'string') return token.text;
  if (token?.kind === 'number') return Number(token.text);
  if (token?.kind === 'word' && LITERAL_KEYWORDS.has(token.text.toLowerCase()) && !isPunctuation(statement[index + 1], '(')) {
    const keyword = token.text.toLowerCase();
    return keyword === 'null' ? null : keyword === 'true';
  }
  throw new ValidationSeedParseError(`Unsupported value "${token?.text ?? 'end of statement'}" in ${SEED_TABLE} seed; only literals are allowed`);
}

function toSeed(columns: string[], values: SeedValue[]): SiteValidationSeed {
  const byColumn = new Map(columns.map((column, position) => [column.toLowerCase(), values[position]]));
  for (const column of REQUIRED_SEED_COLUMNS) {
    if (!byColumn.has(column.toLowerCase())) throw new ValidationSeedParseError(`${SEED_TABLE} seed is missing column ${column}`);
  }
  const text = (column: string) => String(byColumn.get(column.toLowerCase()) ?? '');
  const validationID = Number(byColumn.get('validationid'));
  if (!Number.isInteger(validationID)) throw new ValidationSeedParseError(`${SEED_TABLE} seed has a non-integer ValidationID`);
  return {
    validationID,
    procedureName: text('ProcedureName'),
    description: text('Description'),
    criteria: text('Criteria'),
    definition: text('Definition')
  };
}

function parseInsert(statement: Token[]): SiteValidationSeed[] {
  let index = 3;
  expectPunctuation(statement, index++, '(');
  const columns: string[] = [];
  while (!isPunctuation(statement[index], ')')) {
    const column = statement[index++];
    if (column?.kind !== 'word') throw new ValidationSeedParseError(`Expected a column name in ${SEED_TABLE} seed`);
    columns.push(column.text);
    if (isPunctuation(statement[index], ',')) index++;
  }
  index++;
  if (!isWord(statement[index++], 'VALUES')) throw new ValidationSeedParseError(`${SEED_TABLE} seed must use INSERT ... VALUES`);

  const seeds: SiteValidationSeed[] = [];
  do {
    expectPunctuation(statement, index++, '(');
    const values: SeedValue[] = [];
    while (!isPunctuation(statement[index], ')')) {
      if (index >= statement.length) throw new ValidationSeedParseError(`Unterminated value list in ${SEED_TABLE} seed`);
      values.push(readValue(statement, index++));
      if (isPunctuation(statement[index], ',')) index++;
    }
    index++;
    if (values.length !== columns.length) {
      throw new ValidationSeedParseError(`${SEED_TABLE} seed lists ${columns.length} columns but ${values.length} values`);
    }
    seeds.push(toSeed(columns, values));
  } while (isPunctuation(statement[index], ',') && index++);
  return seeds;
}

export function parseSiteValidationSeeds(sql: string): SiteValidationSeed[] {
  return splitStatements(tokenize(sql))
    .filter(statement => isWord(statement[0], 'INSERT') && isWord(statement[1], 'INTO') && isWord(statement[2], SEED_TABLE))
    .flatMap(parseInsert);
}
