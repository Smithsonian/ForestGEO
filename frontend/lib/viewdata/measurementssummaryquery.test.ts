import { describe, expect, it } from 'vitest';
import {
  assertViewDataFilterItemsSupported,
  buildMeasurementsSummaryPageQueries,
  type MeasurementsSummaryPageQueryInput,
  buildTreeStemStateClauseSql,
  buildViewDataOrderByClause,
  parseViewDataSortModel,
  parseViewDataStemStatusFilter,
  validateViewDataRequest,
  VIEW_DATA_REQUEST_ERRORS,
  ViewDataRequestError
} from './measurementssummaryquery';
import type { ExtendedGridFilterModel } from '@/config/datagridhelpers';
import { SUPPORTED_FILTER_OPERATORS } from '@/components/processors/processormacros';
import { VIEW_DATA_FILTER_OPERATOR_VALUES } from '@/config/viewdata';

const SCHEMA = 'forestgeo_testing';
const PLOT_ID = 3;
const PLOT_CENSUS_NUMBER = 2;
const PAGE = 1;
const PAGE_SIZE = 25;
const ALL_VISIBLE: ExtendedGridFilterModel['visible'] = ['errors', 'valid', 'pending'];
const ALL_TSS: ExtendedGridFilterModel['tss'] = ['old tree', 'multi stem', 'new recruit'];

function filterModel(overrides: Partial<ExtendedGridFilterModel> = {}): ExtendedGridFilterModel {
  return { items: [], quickFilterValues: [], visible: ALL_VISIBLE, tss: ALL_TSS, ...overrides };
}

function queryInput(): MeasurementsSummaryPageQueryInput {
  return {
    schema: SCHEMA,
    columns: ['TreeTag'],
    filterModel: filterModel(),
    sortModel: undefined,
    plotID: PLOT_ID,
    plotCensusNumber: PLOT_CENSUS_NUMBER,
    page: PAGE,
    pageSize: PAGE_SIZE
  };
}

function expectRequestError(run: () => unknown, message: string) {
  try {
    run();
  } catch (error) {
    console.log('[request error]', error instanceof Error ? error.message : String(error));
    expect(error).toBeInstanceOf(ViewDataRequestError);
    expect((error as Error).message).toBe(message);
    return;
  }
  throw new Error(`expected ViewDataRequestError(${message})`);
}

describe('parseViewDataSortModel', () => {
  it.each([[undefined], [null], [[]]])('defaults %j to measurementDate ascending', input => {
    expect(parseViewDataSortModel(input)).toEqual({ field: 'measurementDate', sort: 'asc' });
  });

  it('applies only the first item', () => {
    expect(
      parseViewDataSortModel([
        { field: 'treeTag', sort: 'desc' },
        { field: 'stemTag', sort: 'asc' }
      ])
    ).toEqual({ field: 'treeTag', sort: 'desc' });
  });

  it.each([
    ['an unknown field', [{ field: 'coreMeasurementID', sort: 'asc' }]],
    ['stem status (not sortable)', [{ field: 'stemStatus', sort: 'asc' }]],
    ['a bad direction', [{ field: 'treeTag', sort: 'sideways' }]],
    ['a null direction', [{ field: 'treeTag', sort: null }]],
    ['a non-array model', { field: 'treeTag', sort: 'asc' }],
    ['an injection attempt', [{ field: 'treeTag; DROP TABLE x', sort: 'asc' }]]
  ])('rejects %s', (_label, sortModel) => {
    expectRequestError(() => parseViewDataSortModel(sortModel), VIEW_DATA_REQUEST_ERRORS.unsupportedSortField);
  });
});

describe('buildViewDataOrderByClause', () => {
  it.each([
    [{ field: 'treeTag', sort: 'asc' }, "ORDER BY (NULLIF(vft.TreeTag, '') IS NULL), vft.TreeTag ASC, vft.CoreMeasurementID ASC"],
    [{ field: 'measuredDBH', sort: 'desc' }, 'ORDER BY (vft.MeasuredDBH IS NULL), vft.MeasuredDBH DESC, vft.CoreMeasurementID ASC'],
    [{ field: 'measurementDate', sort: 'asc' }, 'ORDER BY (vft.MeasurementDate IS NULL), vft.MeasurementDate ASC, vft.CoreMeasurementID ASC'],
    [{ field: 'measurementStatus', sort: 'desc' }, 'ORDER BY MeasurementStatusRank DESC, vft.CoreMeasurementID ASC'],
    [
      { field: 'stemState', sort: 'asc' },
      "ORDER BY (NULLIF(JSON_UNQUOTE(JSON_EXTRACT(vft.UserDefinedFields, '$.treestemstate')), '') IS NULL), JSON_UNQUOTE(JSON_EXTRACT(vft.UserDefinedFields, '$.treestemstate')) ASC, vft.CoreMeasurementID ASC"
    ]
  ])('orders by %j', (item, expected) => {
    expect(buildViewDataOrderByClause(item as never)).toBe(expected);
  });
});

describe('filter fields and stem statuses', () => {
  it('accepts data columns', () => {
    expect(() => assertViewDataFilterItemsSupported([{ field: 'speciesCode', operator: 'equals', value: 'ACRU' }])).not.toThrow();
    expect(() => assertViewDataFilterItemsSupported(undefined)).not.toThrow();
  });

  it.each(['stemState', 'stemStatus', 'measurementStatus', 'coreMeasurementID', 'Errors', ''])('rejects an untranslated or unknown filter field %j', field => {
    expectRequestError(() => assertViewDataFilterItemsSupported([{ field, operator: 'is', value: 'x' }]), VIEW_DATA_REQUEST_ERRORS.unsupportedFilterField);
  });

  it.each(['matches', '', 'equals) OR (1=1', 'constructor'])('rejects an operator buildFilterModelStub would silently drop: %j', operator => {
    expectRequestError(
      () => assertViewDataFilterItemsSupported([{ field: 'speciesCode', operator, value: 'ACRU' }]),
      VIEW_DATA_REQUEST_ERRORS.unsupportedFilterOperator
    );
  });

  it.each([[') OR (1=1) OR ('], ['xor'], [42], [{ toUpperCase: 'x' }]])('rejects logicOperator %j before any SQL is built', logicOperator => {
    const filterModel = { items: [{ field: 'speciesCode', operator: 'equals', value: 'ACRU' }], logicOperator } as unknown as ExtendedGridFilterModel;
    expectRequestError(() => validateViewDataRequest(filterModel, undefined), VIEW_DATA_REQUEST_ERRORS.unsupportedLogicOperator);
  });

  it('offers on the client only operators the server implements (drift between config/viewdata and processormacros)', () => {
    const unsupported = [...VIEW_DATA_FILTER_OPERATOR_VALUES].filter(operator => !SUPPORTED_FILTER_OPERATORS.has(operator));
    console.log('[operators] client-offered but not server-supported', JSON.stringify(unsupported));
    expect(unsupported).toEqual([]);
  });

  it.each([['and'], ['OR'], [undefined]])('accepts logicOperator %j', logicOperator => {
    const filterModel = { items: [{ field: 'speciesCode', operator: 'equals', value: 'ACRU' }], logicOperator } as unknown as ExtendedGridFilterModel;
    expect(() => validateViewDataRequest(filterModel, undefined)).not.toThrow();
  });

  it('accepts known statuses once each and rejects anything else', () => {
    expect(parseViewDataStemStatusFilter(['dead', 'dead', 'alive'])).toEqual(['dead', 'alive']);
    expect(parseViewDataStemStatusFilter(undefined)).toEqual([]);
    expectRequestError(() => parseViewDataStemStatusFilter(['zombie']), VIEW_DATA_REQUEST_ERRORS.unsupportedStemStatus);
    expectRequestError(() => parseViewDataStemStatusFilter('dead'), VIEW_DATA_REQUEST_ERRORS.unsupportedStemStatus);
  });

  it.each([
    ['visible is a string', { visible: 'errors' }, VIEW_DATA_REQUEST_ERRORS.unsupportedVisibleFilter],
    ['visible holds an unknown entry', { visible: ['errors', 'bogus'] }, VIEW_DATA_REQUEST_ERRORS.unsupportedVisibleFilter],
    ['visible holds a non-string', { visible: [1] }, VIEW_DATA_REQUEST_ERRORS.unsupportedVisibleFilter],
    ['visible is an object', { visible: { 0: 'errors' } }, VIEW_DATA_REQUEST_ERRORS.unsupportedVisibleFilter],
    ['tss is a string', { tss: 'old tree' }, VIEW_DATA_REQUEST_ERRORS.unsupportedStemStateFilter],
    ['tss holds an unknown entry', { tss: ['old tree', "x') OR 1=1 --"] }, VIEW_DATA_REQUEST_ERRORS.unsupportedStemStateFilter],
    ['quickFilterValues is a string', { quickFilterValues: 'abc' }, VIEW_DATA_REQUEST_ERRORS.unsupportedQuickFilter],
    ['quickFilterValues holds a number', { quickFilterValues: ['abc', 7] }, VIEW_DATA_REQUEST_ERRORS.unsupportedQuickFilter],
    ['quickFilterValues holds an object', { quickFilterValues: [{ toString: 'x' }] }, VIEW_DATA_REQUEST_ERRORS.unsupportedQuickFilter]
  ])('rejects a malformed filter model where %s', (_label, overrides, message) => {
    const malformed = { ...filterModel(), ...overrides } as unknown as ExtendedGridFilterModel;
    console.log('[malformed filter model]', JSON.stringify(malformed));
    expectRequestError(() => validateViewDataRequest(malformed, undefined), message);
  });

  it('accepts an empty visible list (shows nothing) and an absent visible, tss or quickFilterValues (no restriction), as before', () => {
    const absent = { items: [] } as unknown as ExtendedGridFilterModel;
    expect(() => validateViewDataRequest(filterModel({ visible: [] }), undefined)).not.toThrow();
    expect(() => validateViewDataRequest(absent, undefined)).not.toThrow();
  });

  it('counts three copies of one state as one distinct state, not as every state selected', () => {
    const clause = buildTreeStemStateClauseSql(['old tree', 'old tree', 'old tree']);
    console.log('[tss] three copies of one state', clause);
    expect(clause).toBe(" AND (JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('old tree'), '$.treestemstate') = 1)");
  });

  it('skips the tree-stem-state clause when every state is selected, as today', () => {
    expect(buildTreeStemStateClauseSql(ALL_TSS)).toBe('');
    expect(buildTreeStemStateClauseSql(['old tree'])).toBe(" AND (JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('old tree'), '$.treestemstate') = 1)");
  });
});

describe('buildMeasurementsSummaryPageQueries', () => {
  const queries = buildMeasurementsSummaryPageQueries({
    schema: SCHEMA,
    columns: ['TreeTag'],
    filterModel: filterModel({
      quickFilterValues: ['T01'],
      items: [{ field: 'speciesCode', operator: 'equals', value: 'ACRU' }],
      stemStatus: ['dead']
    }),
    sortModel: [{ field: 'measurementStatus', sort: 'asc' }],
    plotID: PLOT_ID,
    plotCensusNumber: PLOT_CENSUS_NUMBER,
    page: PAGE,
    pageSize: PAGE_SIZE
  });

  it('ANDs search and filter, never ORs them', () => {
    console.log('[page queries] paginated', queries.paginatedQuery);
    expect(queries.paginatedQuery).toMatch(/AND \(\(`vft`\.`TreeTag` = 'T01' OR `vft`\.`TreeTag` LIKE '%T01%'\)\)\s+AND \(`vft`\.`SpeciesCode` = 'ACRU'\)/);
    expect(queries.paginatedQuery).not.toMatch(/T01%'\)\) OR/);
  });

  it('puts the projection, the Stem status clause and the status ORDER BY in the paginated query only', () => {
    expect(queries.paginatedQuery).toContain('AS MeasurementStatusRank');
    expect(queries.paginatedQuery).toContain("sf_attr.Status IN ('dead')");
    expect(queries.paginatedQuery).toContain('ORDER BY MeasurementStatusRank ASC, vft.CoreMeasurementID ASC LIMIT 25, 25;');
    expect(queries.countQuery).not.toContain('MeasurementStatusRank');
    expect(queries.countQuery).toContain("sf_attr.Status IN ('dead')");
    expect(queries.exportQuery).not.toContain('MeasurementStatusRank');
    expect(queries.exportQuery).toContain('ORDER BY vft.MeasurementDate ASC LIMIT 25, 25;');
  });

  it('binds plot, plot, census number, offset and page size, leaving no placeholder behind', () => {
    const unboundPlaceholders = (sql: string) => (sql.match(/\?/g) ?? []).length;
    console.log(
      '[page queries] bound tails',
      JSON.stringify({
        paginated: queries.paginatedQuery.slice(-90),
        export: queries.exportQuery.slice(-60),
        unbound: [queries.paginatedQuery, queries.countQuery, queries.exportQuery].map(unboundPlaceholders)
      })
    );
    expect(queries.paginatedQuery).toContain(
      `vft.PlotID = ${PLOT_ID}\n              AND c.PlotID = ${PLOT_ID}\n              AND c.PlotCensusNumber = ${PLOT_CENSUS_NUMBER}`
    );
    expect(queries.countQuery).toContain(`AND c.PlotCensusNumber = ${PLOT_CENSUS_NUMBER}`);
    expect(queries.paginatedQuery.trim().endsWith(`vft.CoreMeasurementID ASC LIMIT ${PAGE * PAGE_SIZE}, ${PAGE_SIZE};`)).toBe(true);
    expect(queries.exportQuery.trim().endsWith(`ORDER BY vft.MeasurementDate ASC LIMIT ${PAGE * PAGE_SIZE}, ${PAGE_SIZE};`)).toBe(true);
    expect(queries.countQuery).not.toContain('LIMIT');
    expect([queries.paginatedQuery, queries.countQuery, queries.exportQuery].map(unboundPlaceholders)).toEqual([0, 0, 0]);
  });

  it('formats the schema identifier itself, escaped', () => {
    expect(queries.paginatedQuery).toContain(`FROM \`${SCHEMA}\`.measurementssummary vft`);
    expect(queries.paginatedQuery).toContain(`JOIN \`${SCHEMA}\`.census c`);
    expect(queries.paginatedQuery).not.toContain('??');
  });

  it('refuses a schema that is not a ForestGEO schema', () => {
    expect(() => buildMeasurementsSummaryPageQueries({ ...queryInput(), schema: 'mysql`; DROP TABLE x; --' })).toThrow(/Invalid or unauthorized schema/);
  });
});

describe('a literal ? or ?? in a search or filter value', () => {
  const FILTER_VALUE = 'a?b';
  const SEARCH_VALUE = 'x?y??z';

  const queries = buildMeasurementsSummaryPageQueries({
    ...queryInput(),
    filterModel: filterModel({
      quickFilterValues: [SEARCH_VALUE],
      items: [{ field: 'speciesCode', operator: 'equals', value: FILTER_VALUE }]
    })
  });

  it.each([
    ['paginatedQuery', queries.paginatedQuery],
    ['countQuery', queries.countQuery],
    ['exportQuery', queries.exportQuery]
  ])('%s keeps the escaped values intact and binds the real numbers', (name, sql) => {
    const whereStart = sql.indexOf('WHERE');
    console.log(`[literal ?] ${name}`, JSON.stringify({ where: sql.slice(whereStart).replace(/\s+/g, ' ').slice(-520) }));
    expect(sql).toContain("`vft`.`SpeciesCode` = 'a?b'");
    expect(sql).toContain("LIKE '%x?y??z%'");
    expect(sql).toContain(`vft.PlotID = ${PLOT_ID}`);
    expect(sql).toContain(`c.PlotCensusNumber = ${PLOT_CENSUS_NUMBER}`);
    expect(sql).not.toContain('??.');
  });

  it('puts the real LIMIT numbers on the queries that page', () => {
    expect(queries.paginatedQuery.trim().endsWith(`LIMIT ${PAGE * PAGE_SIZE}, ${PAGE_SIZE};`)).toBe(true);
    expect(queries.exportQuery.trim().endsWith(`LIMIT ${PAGE * PAGE_SIZE}, ${PAGE_SIZE};`)).toBe(true);
  });
});
