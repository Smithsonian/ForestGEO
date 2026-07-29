/**
 * Layer A (no database) unit tests for the schema-contract module.
 *
 * These exercise the pure DDL parser and the contract-diff logic against small
 * fixture strings and programmatically mutated contracts. They must fail if the
 * parser stops normalizing a type/collation/generated dimension, or if the diff
 * stops distinguishing a missing column, a type/collation drift, or a missing
 * required index from an exact match. No live schema is touched here — the
 * database-backed parity check lives in the integration suite.
 */

import { describe, it, expect } from 'vitest';
import {
  CONTRACT_READ_TABLES,
  CRITICAL_TABLES,
  loadCanonicalSchemaContract,
  REQUIRED_COLUMNS_BY_TABLE,
  parseCanonicalSchemaContract,
  compareSchemaContracts,
  REQUIRED_INDEXES_BY_TABLE,
  normalizeTypeSignature,
  normalizeDefaultValue,
  normalizeExtraMetadata,
  formatContractFailures,
  type SchemaContract,
  type CompareOptions
} from './schema-contract';

const TARGET_COLLATION = 'utf8mb4_0900_ai_ci';

const FIXTURE_DDL = `
-- leading comment that must be ignored
ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

create table if not exists widgets
(
    WidgetID    int auto_increment
        primary key,
    Code        varchar(25)                          null, -- trailing comment
    Severity    enum ('info', 'warning', 'critical') not null default 'warning',
    Ratio       decimal(12, 6)                       null,
    IsActive    tinyint(1) default 1                 not null,
    Toggle      bit                                  null,
    CreatedAt   datetime default CURRENT_TIMESTAMP   null,
    Sig         varchar(500) as (concat_ws(_utf8mb4'#', coalesce(\`Code\`, _utf8mb4''))) stored invisible,
    constraint uq_widgets_code_active
        unique (Code, IsActive)
);

create index idx_widgets_code on widgets (Code);

create unique index ux_widgets_ratio on widgets (Ratio);
`;

const WIDGET_COMPARE_OPTIONS: CompareOptions = {
  tables: ['widgets'],
  requiredIndexesByTable: { widgets: ['uq_widgets_code_active', 'ux_widgets_ratio'] }
};

function clone(contract: SchemaContract): SchemaContract {
  return JSON.parse(JSON.stringify(contract));
}

describe('normalization helpers', () => {
  it('normalizes type signatures consistently with information_schema', () => {
    expect(normalizeTypeSignature('decimal(12, 6)')).toBe('decimal(12,6)');
    expect(normalizeTypeSignature('int unsigned')).toBe('int unsigned');
    expect(normalizeTypeSignature('bit')).toBe('bit(1)');
    expect(normalizeTypeSignature('bit(1)')).toBe('bit(1)');
    expect(normalizeTypeSignature("enum ('info', 'warning', 'stem dead')")).toBe("enum('info','warning','stem dead')");
    expect(normalizeTypeSignature('VARCHAR(25)')).toBe('varchar(25)');
  });

  it('normalizes DDL and information_schema defaults to a single form', () => {
    expect(normalizeDefaultValue("'csv'")).toBe('csv');
    expect(normalizeDefaultValue('csv')).toBe('csv');
    expect(normalizeDefaultValue('CURRENT_TIMESTAMP')).toBe('CURRENT_TIMESTAMP');
    expect(normalizeDefaultValue('current_timestamp')).toBe('CURRENT_TIMESTAMP');
    expect(normalizeDefaultValue('1')).toBe('1');
    expect(normalizeDefaultValue("''")).toBe('');
    expect(normalizeDefaultValue('null')).toBeNull();
    expect(normalizeDefaultValue(null)).toBeNull();
  });

  it('reduces extra metadata to load-bearing flags and drops noise', () => {
    expect(normalizeExtraMetadata('auto_increment')).toBe('auto_increment');
    expect(normalizeExtraMetadata('STORED GENERATED')).toBe('stored_generated');
    expect(normalizeExtraMetadata('STORED GENERATED INVISIBLE')).toBe('stored_generated');
    expect(normalizeExtraMetadata('DEFAULT_GENERATED')).toBe('');
    expect(normalizeExtraMetadata('DEFAULT_GENERATED on update CURRENT_TIMESTAMP')).toBe('on_update_current_timestamp');
    expect(normalizeExtraMetadata('')).toBe('');
  });
});

describe('parseCanonicalSchemaContract', () => {
  const contract = parseCanonicalSchemaContract(FIXTURE_DDL);
  const widgets = contract.tables['widgets'];

  it('captures the database default collation from ALTER DATABASE', () => {
    expect(contract.defaultCollation).toBe(TARGET_COLLATION);
  });

  it('parses an auto-increment primary key as a non-null, non-text int', () => {
    const col = widgets.columns['widgetid'];
    expect(col.typeSignature).toBe('int');
    expect(col.nullable).toBe(false);
    expect(col.extra).toBe('auto_increment');
    expect(col.isText).toBe(false);
    expect(col.collation).toBeNull();
    expect(col.defaultValue).toBeNull();
  });

  it('assigns the schema default collation to text columns without an explicit COLLATE', () => {
    const col = widgets.columns['code'];
    expect(col.typeSignature).toBe('varchar(25)');
    expect(col.nullable).toBe(true);
    expect(col.isText).toBe(true);
    expect(col.collation).toBe(TARGET_COLLATION);
  });

  it('parses an enum column with its value list, default, and text collation', () => {
    const col = widgets.columns['severity'];
    expect(col.typeSignature).toBe("enum('info','warning','critical')");
    expect(col.nullable).toBe(false);
    expect(col.defaultValue).toBe('warning');
    expect(col.collation).toBe(TARGET_COLLATION);
  });

  it('parses decimal precision, tinyint default, and bit widening', () => {
    expect(widgets.columns['ratio'].typeSignature).toBe('decimal(12,6)');
    expect(widgets.columns['ratio'].collation).toBeNull();
    expect(widgets.columns['isactive'].typeSignature).toBe('tinyint(1)');
    expect(widgets.columns['isactive'].defaultValue).toBe('1');
    expect(widgets.columns['isactive'].nullable).toBe(false);
    expect(widgets.columns['toggle'].typeSignature).toBe('bit(1)');
  });

  it('parses a CURRENT_TIMESTAMP default without inventing extra metadata', () => {
    const col = widgets.columns['createdat'];
    expect(col.defaultValue).toBe('CURRENT_TIMESTAMP');
    expect(col.extra).toBe('');
  });

  it('parses a stored generated column as generated, nullable, defaultless', () => {
    const col = widgets.columns['sig'];
    expect(col.typeSignature).toBe('varchar(500)');
    expect(col.extra).toBe('stored_generated');
    expect(col.defaultValue).toBeNull();
    expect(col.collation).toBe(TARGET_COLLATION);
  });

  it('parses inline named unique constraints and standalone create index statements', () => {
    expect(widgets.indexes['uq_widgets_code_active']).toEqual({ name: 'uq_widgets_code_active', unique: true, columns: ['Code', 'IsActive'] });
    expect(widgets.indexes['idx_widgets_code']).toEqual({ name: 'idx_widgets_code', unique: false, columns: ['Code'] });
    expect(widgets.indexes['ux_widgets_ratio']).toEqual({ name: 'ux_widgets_ratio', unique: true, columns: ['Ratio'] });
  });
});

describe('compareSchemaContracts', () => {
  const expected = parseCanonicalSchemaContract(FIXTURE_DDL);

  it('reports no failures and no extras when the contracts match exactly', () => {
    const result = compareSchemaContracts(expected, clone(expected), WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toEqual([]);
    expect(result.extras).toEqual([]);
  });

  it('detects a missing required column', () => {
    const actual = clone(expected);
    delete actual.tables['widgets'].columns['code'];
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(expect.objectContaining({ table: 'widgets', object: 'Code', category: 'column', kind: 'missing' }));
  });

  it('detects a column type/width mismatch', () => {
    const actual = clone(expected);
    actual.tables['widgets'].columns['ratio'].typeSignature = 'decimal(10,2)';
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(expect.objectContaining({ object: 'Ratio', kind: 'type', expected: 'decimal(12,6)', actual: 'decimal(10,2)' }));
  });

  it('detects a nullability mismatch', () => {
    const actual = clone(expected);
    actual.tables['widgets'].columns['code'].nullable = false;
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(expect.objectContaining({ object: 'Code', kind: 'nullability' }));
  });

  it('detects a collation drift on a text column', () => {
    const actual = clone(expected);
    actual.tables['widgets'].columns['code'].collation = 'utf8mb4_general_ci';
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ object: 'Code', kind: 'collation', expected: TARGET_COLLATION, actual: 'utf8mb4_general_ci' })
    );
  });

  it('detects a missing required index', () => {
    const actual = clone(expected);
    delete actual.tables['widgets'].indexes['ux_widgets_ratio'];
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(expect.objectContaining({ object: 'ux_widgets_ratio', category: 'index', kind: 'missing' }));
  });

  it('detects a required index whose column list drifted', () => {
    const actual = clone(expected);
    actual.tables['widgets'].indexes['uq_widgets_code_active'].columns = ['Code'];
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(expect.objectContaining({ object: 'uq_widgets_code_active', category: 'index', kind: 'columns' }));
  });

  it('reports an extra live column as informational, not a failure', () => {
    const actual = clone(expected);
    actual.tables['widgets'].columns['surprise'] = {
      name: 'Surprise',
      typeSignature: 'int',
      dataType: 'int',
      nullable: true,
      defaultValue: null,
      extra: '',
      collation: null,
      isText: false
    };
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toEqual([]);
    expect(result.extras).toContainEqual(expect.objectContaining({ object: 'Surprise', category: 'column' }));
  });

  it('fails when a critical table is entirely absent from the live schema', () => {
    const actual = clone(expected);
    delete actual.tables['widgets'];
    const result = compareSchemaContracts(expected, actual, WIDGET_COMPARE_OPTIONS);
    expect(result.failures).toContainEqual(expect.objectContaining({ table: 'widgets', kind: 'missing' }));
  });
});

describe('formatContractFailures', () => {
  it('renders each failure with table, object, kind, and both values for debugging', () => {
    const rendered = formatContractFailures([{ table: 'widgets', object: 'Code', category: 'column', kind: 'missing', expected: 'varchar(25)', actual: null }]);
    expect(rendered).toContain('widgets');
    expect(rendered).toContain('Code');
    expect(rendered).toContain('missing');
    expect(rendered).toContain('varchar(25)');
  });
});

// Regression guards for two false-failure sources that would only surface when
// schema-contract.ts runs as a LIVE production audit across many schemas.
describe('robustness regressions', () => {
  it('does not mistag a plain column as generated when its remainder contains the word "as"', () => {
    const ddl = `
      ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
      create table if not exists notes
      (
          NoteID   int auto_increment primary key,
          Body     varchar(64)  null comment 'measured as diameter',
          Label    varchar(32)  not null default 'flagged as bad'
      );
    `;
    const contract = parseCanonicalSchemaContract(ddl);
    const columns = contract.tables['notes'].columns;

    // The word "as" in a comment/default must not trip generated-column detection.
    expect(columns['body'].extra).toBe('');
    expect(columns['label'].extra).toBe('');
    // And the surrounding metadata must still parse correctly.
    expect(columns['label'].defaultValue).toBe('flagged as bad');
    expect(columns['body'].collation).toBe(TARGET_COLLATION);

    // A self-comparison must therefore produce no spurious diff.
    const { failures } = compareSchemaContracts(contract, JSON.parse(JSON.stringify(contract)), {
      tables: ['notes'],
      requiredIndexesByTable: { notes: [] }
    });
    expect(failures).toEqual([]);
  });

  it('still detects a genuine stored generated column via the explicit AS (...) marker', () => {
    const ddl = `
      ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
      create table if not exists sums
      (
          A     int null,
          B     int null,
          Total int as (A + B) stored
      );
    `;
    const contract = parseCanonicalSchemaContract(ddl);
    expect(contract.tables['sums'].columns['total'].extra).toBe('stored_generated');
  });

  it('throws a descriptive error when a DDL has text columns but no ALTER DATABASE COLLATE clause', () => {
    const ddl = `
      create table if not exists people
      (
          PersonID int auto_increment primary key,
          Name     varchar(64) not null
      );
    `;
    expect(() => parseCanonicalSchemaContract(ddl)).toThrowError(/people\.Name[\s\S]*ALTER DATABASE[\s\S]*COLLATE/i);
  });

  it('does not throw for a DDL with no text columns and no ALTER DATABASE COLLATE clause', () => {
    const ddl = `
      create table if not exists counters
      (
          CounterID int auto_increment primary key,
          Value     int not null default 0
      );
    `;
    const contract = parseCanonicalSchemaContract(ddl);
    expect(contract.defaultCollation).toBeNull();
    expect(contract.tables['counters'].columns['value'].collation).toBeNull();
  });
});

/**
 * The three lookups the collision check depends on.
 *
 * STRAIGHT_JOIN (storedprocedures.sql STAGE 8,
 * existing_tag_stemtag_collision_failures) pins the JOIN ORDER so the optimizer
 * cannot flip to the trees x coremeasurements pair explosion that took Harvard's
 * sub-batches from 8s to 1500s+. It does NOT pin the ACCESS PATH: with the order
 * fixed and one of these indexes gone, each batch row degrades to a scan and
 * there is no optimizer escape left. A schema missing one is therefore slower
 * than it was before the STRAIGHT_JOIN, which is exactly why presence and shape
 * are contract-required rather than assumed.
 */
const COLLISION_CHECK_INDEXES = [
  { table: 'trees', index: 'idx_trees_tag_census_active' },
  { table: 'stems', index: 'ux_stems_treeid_stemtag_census' },
  { table: 'coremeasurements', index: 'ux_measure_unique' }
] as const;

describe('collision-check index contract', () => {
  const canonical = loadCanonicalSchemaContract();

  function compareAgainstCanonical(live: SchemaContract) {
    return compareSchemaContracts(canonical, live, { tables: CRITICAL_TABLES, requiredIndexesByTable: REQUIRED_INDEXES_BY_TABLE });
  }

  it('lists every collision-check index as required', () => {
    for (const { table, index } of COLLISION_CHECK_INDEXES) {
      expect(REQUIRED_INDEXES_BY_TABLE[table], `${table} has no required-index list`).toBeDefined();
      expect(REQUIRED_INDEXES_BY_TABLE[table], `${index} is not contract-required`).toContain(index);
    }
  });

  it('defines every collision-check index in the canonical DDL', () => {
    for (const { table, index } of COLLISION_CHECK_INDEXES) {
      expect(canonical.tables[table].indexes[index.toLowerCase()], `${table}.${index} missing from tablestructures.sql`).toBeDefined();
    }
  });

  it('matches a live schema that carries all of them unchanged', () => {
    expect(compareAgainstCanonical(clone(canonical)).failures).toEqual([]);
  });

  it.each(COLLISION_CHECK_INDEXES)('fails when $table.$index is absent', ({ table, index }) => {
    const live = clone(canonical);
    delete live.tables[table].indexes[index.toLowerCase()];

    const { failures } = compareAgainstCanonical(live);

    expect(failures).toContainEqual(expect.objectContaining({ table, object: index, category: 'index', kind: 'missing' }));
  });

  it.each(COLLISION_CHECK_INDEXES)('fails when $table.$index has lost a key column', ({ table, index }) => {
    const live = clone(canonical);
    const liveIndex = live.tables[table].indexes[index.toLowerCase()];
    expect(liveIndex.columns.length, `${index} needs >1 column for this mutation to be meaningful`).toBeGreaterThan(1);
    liveIndex.columns = liveIndex.columns.slice(0, -1);

    const { failures } = compareAgainstCanonical(live);

    expect(failures).toContainEqual(expect.objectContaining({ table, object: index, category: 'index', kind: 'columns' }));
  });

  it.each(COLLISION_CHECK_INDEXES)('fails when $table.$index has the wrong key-column ORDER', ({ table, index }) => {
    // Same columns, different order: the leftmost-prefix rule means a reordered
    // index cannot serve the same lookup, so a set comparison would wave this
    // through while the optimizer still falls back to a scan.
    const live = clone(canonical);
    const liveIndex = live.tables[table].indexes[index.toLowerCase()];
    liveIndex.columns = [...liveIndex.columns].reverse();

    const { failures } = compareAgainstCanonical(live);

    expect(failures).toContainEqual(expect.objectContaining({ table, object: index, category: 'index', kind: 'columns' }));
  });

  it.each(COLLISION_CHECK_INDEXES)('fails when $table.$index uniqueness flips', ({ table, index }) => {
    const live = clone(canonical);
    const liveIndex = live.tables[table].indexes[index.toLowerCase()];
    liveIndex.unique = !liveIndex.unique;

    const { failures } = compareAgainstCanonical(live);

    expect(failures).toContainEqual(expect.objectContaining({ table, object: index, category: 'index', kind: 'uniqueness' }));
  });
});

describe('presence-only required columns', () => {
  const canonical = loadCanonicalSchemaContract();

  function liveContractWith(tableName: string, columns: Record<string, unknown>): SchemaContract {
    return {
      defaultCollation: TARGET_COLLATION,
      tables: { [tableName]: { name: tableName, columns: columns as never, indexes: {} } }
    };
  }

  it('declares every required column in the canonical DDL', () => {
    for (const [table, columnNames] of Object.entries(REQUIRED_COLUMNS_BY_TABLE)) {
      const canonicalTable = canonical.tables[table];
      expect(canonicalTable, `${table} is not defined in tablestructures.sql`).toBeDefined();
      for (const columnName of columnNames) {
        expect(canonicalTable.columns[columnName.toLowerCase()], `${table}.${columnName} missing from tablestructures.sql`).toBeDefined();
      }
    }
  });

  it('includes required-column tables in the set a contract read must fetch', () => {
    // Reading only CRITICAL_TABLES would leave these tables absent from the live
    // contract, and the requirement silently unenforceable.
    for (const table of Object.keys(REQUIRED_COLUMNS_BY_TABLE)) {
      expect(CONTRACT_READ_TABLES).toContain(table);
    }
  });

  it('fails when the table exists but the required column does not', () => {
    const live = liveContractWith('upload_sessions', {
      session_id: {
        name: 'session_id',
        typeSignature: 'varchar(64)',
        dataType: 'varchar',
        nullable: false,
        defaultValue: null,
        extra: '',
        collation: TARGET_COLLATION,
        isText: true
      }
    });

    const { failures } = compareSchemaContracts(canonical, live, { tables: [], requiredIndexesByTable: {} });

    expect(failures).toContainEqual(
      expect.objectContaining({ table: 'upload_sessions', object: 'census_replacement_completed_at', category: 'column', kind: 'missing' })
    );
  });

  it('passes when the table exists and carries the column', () => {
    const live = liveContractWith('upload_sessions', {
      census_replacement_completed_at: {
        name: 'census_replacement_completed_at',
        typeSignature: 'timestamp',
        dataType: 'timestamp',
        nullable: true,
        defaultValue: null,
        extra: '',
        collation: null,
        isText: false
      }
    });

    expect(compareSchemaContracts(canonical, live, { tables: [], requiredIndexesByTable: {} }).failures).toEqual([]);
  });

  it('treats an entirely absent table as not-yet-provisioned, not a violation', () => {
    // upload_sessions is created on demand by ensureUploadSessionsTable, and
    // readLiveSchemaContract reports a non-existent table as one with zero
    // columns. A schema that has never run an upload must not fail the gate.
    const live = liveContractWith('upload_sessions', {});

    expect(compareSchemaContracts(canonical, live, { tables: [], requiredIndexesByTable: {} }).failures).toEqual([]);
  });
});
