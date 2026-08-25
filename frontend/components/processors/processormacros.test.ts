import { beforeEach, describe, expect, it, vi } from 'vitest';
import { escape } from 'mysql2';
import type { GridFilterModel } from '@mui/x-data-grid';
import { buildFilterModelStub } from './processormacros';

const { getPoolMonitorInstanceMock, poolMonitorMock, loggerMock } = vi.hoisted(() => ({
  getPoolMonitorInstanceMock: vi.fn(),
  poolMonitorMock: {
    getConnection: vi.fn(),
    signalActivity: vi.fn()
  },
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock('@/lib/db/poolmonitorsingleton', () => ({
  getPoolMonitorInstance: getPoolMonitorInstanceMock
}));

vi.mock('@/ailogger', () => ({
  default: loggerMock
}));

describe('db primitives connection acquisition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPoolMonitorInstanceMock.mockReturnValue(poolMonitorMock);
  });

  it('does not ping every acquired connection before returning it', async () => {
    const connection = {
      ping: vi.fn(),
      release: vi.fn()
    };
    poolMonitorMock.getConnection.mockResolvedValueOnce(connection);

    const { getConn } = await import('@/lib/db/primitives');
    const result = await getConn();

    expect(result).toBe(connection);
    expect(poolMonitorMock.getConnection).toHaveBeenCalledTimes(1);
    expect(connection.ping).not.toHaveBeenCalled();
  });
});

describe('buildFilterModelStub SQL escaping', () => {
  // Fields transform via capitalizeAndTransformField, then get backtick-quoted by safeEscapeId.
  const SPECIES_FIELD = 'speciesName';
  const SPECIES_COLUMN = '`SpeciesName`';
  const NUMERIC_FIELD = 'stemDiameter';
  const NUMERIC_COLUMN = '`StemDiameter`';
  // Emitted LIKE escape clause: the JS template `ESCAPE '\\\\'` renders to the literal two-char `\\`.
  const LIKE_ESCAPE_CLAUSE = "ESCAPE '\\\\'";
  // A single literal backslash and a doubled (mysql2-escaped) backslash, spelled out for readability.
  const ONE_BACKSLASH = '\\';
  const TWO_BACKSLASHES = '\\\\';

  const singleItemModel = (operator: string, value: unknown, field: string = SPECIES_FIELD): GridFilterModel => ({
    items: [{ field, operator, value }]
  });

  it('emits a plain quoted literal for a benign equals value', () => {
    const sql = buildFilterModelStub(singleItemModel('equals', 'Quercus'));
    expect(sql).toBe(`${SPECIES_COLUMN} = 'Quercus'`);
  });

  it('leaves numeric equals values unquoted (preserves existing behavior)', () => {
    const sql = buildFilterModelStub(singleItemModel('=', 5, NUMERIC_FIELD));
    expect(sql).toBe(`${NUMERIC_COLUMN} = 5`);
  });

  it('neutralizes single-quote injection by escaping every interior quote', () => {
    const QUOTE_INJECTION = "' OR '1'='1";
    const sql = buildFilterModelStub(singleItemModel('equals', QUOTE_INJECTION));

    // The value must be contained as one fully-escaped mysql2 literal.
    expect(sql).toBe(`${SPECIES_COLUMN} = ${escape(QUOTE_INJECTION)}`);
    // Every interior quote is backslash-escaped, so no bare `' OR '` can break out of the literal.
    expect(sql).toContain("\\' OR \\'1\\'=\\'1");
    // The dangerous executable break-out must NOT appear.
    expect(sql).not.toContain(`${SPECIES_COLUMN} = '' OR '1'='1'`);
  });

  it('neutralizes backslash injection by doubling the backslash (key regression vs old escapeSql)', () => {
    // Old escapeSql only doubled quotes; the backslash escaped the following quote and broke out.
    const BACKSLASH_INJECTION = "\\' OR 1=1 -- ";
    const sql = buildFilterModelStub(singleItemModel('equals', BACKSLASH_INJECTION));

    // mysql2 escape produces the safe literal; the leading backslash is doubled.
    expect(sql).toBe(`${SPECIES_COLUMN} = ${escape(BACKSLASH_INJECTION)}`);
    // The emitted SQL must contain a doubled backslash (proof the backslash is escaped, not live).
    expect(sql).toContain(TWO_BACKSLASHES);
    // The old vulnerable form `'\'' ...` had a single, un-doubled backslash escaping the quote.
    const OLD_VULNERABLE_FRAGMENT = `${SPECIES_COLUMN} = '${ONE_BACKSLASH}'' OR 1=1 -- '`;
    expect(sql).not.toBe(OLD_VULNERABLE_FRAGMENT);
  });

  it('escapes the LIKE % wildcard so contains treats it as a literal percent', () => {
    const PERCENT_VALUE = '50%';
    // escapeLikeWildcards turns % into \% (literal percent under ESCAPE '\'),
    // then mysql2 wraps and doubles the backslash.
    const PERCENT_WILDCARD_ESCAPED = '50\\%';
    const sql = buildFilterModelStub(singleItemModel('contains', PERCENT_VALUE));

    const expectedLiteral = escape(`%${PERCENT_WILDCARD_ESCAPED}%`);
    expect(sql).toBe(`${SPECIES_COLUMN} LIKE ${expectedLiteral} ${LIKE_ESCAPE_CLAUSE}`);
    // The ESCAPE clause must be present so the escaped wildcard is honored.
    expect(sql).toContain(LIKE_ESCAPE_CLAUSE);
    // The literal is quote-wrapped by mysql2 (no manual quotes).
    expect(sql).toContain(`LIKE '%50`);
  });

  it('escapes the LIKE _ wildcard so contains treats it as a literal underscore', () => {
    const UNDERSCORE_VALUE = 'a_b';
    const UNDERSCORE_WILDCARD_ESCAPED = 'a\\_b';
    const sql = buildFilterModelStub(singleItemModel('contains', UNDERSCORE_VALUE));

    const expectedLiteral = escape(`%${UNDERSCORE_WILDCARD_ESCAPED}%`);
    expect(sql).toBe(`${SPECIES_COLUMN} LIKE ${expectedLiteral} ${LIKE_ESCAPE_CLAUSE}`);
    expect(sql).toContain(LIKE_ESCAPE_CLAUSE);
  });

  it('safely escapes every element of an isAnyOf list inside IN (...)', () => {
    const ANY_OF_VALUES = ["a'b", 'c'];
    const sql = buildFilterModelStub(singleItemModel('isAnyOf', ANY_OF_VALUES));

    const expectedList = ANY_OF_VALUES.map(v => escape(v)).join(', ');
    expect(sql).toBe(`${SPECIES_COLUMN} IN (${expectedList})`);
    // The quote inside the first element must be escaped, not doubled.
    expect(sql).toContain("'a\\'b'");
  });
});
