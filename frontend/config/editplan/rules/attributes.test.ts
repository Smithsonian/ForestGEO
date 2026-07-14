import { describe, it, expect } from 'vitest';
import { applyAttributeRules, parseAttributeCodes, ATTRIBUTE_CODE_DELIMITER } from './attributes';

function makeCtx(overrides: Partial<Parameters<typeof applyAttributeRules>[0]> = {}) {
  return {
    cm: {} as any,
    schema: 's',
    dataType: 'measurementssummary' as const,
    plotID: 1,
    censusID: 1,
    oldRow: { Attributes: 'A;B' },
    newRow: { Attributes: 'A;B' },
    changedFields: new Set(['Attributes']),
    ...overrides
  };
}

describe('applyAttributeRules', () => {
  it('no effect when Attributes not in changedFields', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B' },
      newRow: { Attributes: 'A;B;C' },
      changedFields: new Set()
    });
    expect(await applyAttributeRules(ctx)).toEqual([]);
  });

  it('no effect when old and new code sets are identical (same order)', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B' },
      newRow: { Attributes: 'A;B' }
    });
    expect(await applyAttributeRules(ctx)).toEqual([]);
  });

  it('no effect when old and new code sets are identical (reordered)', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B;C' },
      newRow: { Attributes: 'C;A;B' }
    });
    expect(await applyAttributeRules(ctx)).toEqual([]);
  });

  it('emits info R5 when new set is a superset of old', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B' },
      newRow: { Attributes: 'A;B;C' }
    });
    const effects = await applyAttributeRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R5');
    expect(effects[0].severity).toBe('info');
    expect(effects[0].category).toBe('field');
    expect(effects[0].affectedTable).toBe('cmattributes');
    expect(effects[0].affectedRowCount).toBe(3);
  });

  it('emits info R5 when adding a single code to empty set', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: null },
      newRow: { Attributes: 'A' }
    });
    const effects = await applyAttributeRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].severity).toBe('info');
    expect(effects[0].affectedRowCount).toBe(1);
  });

  it('emits destructive R5 when a code is dropped', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B;C' },
      newRow: { Attributes: 'A;B' }
    });
    const effects = await applyAttributeRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R5');
    expect(effects[0].severity).toBe('destructive');
    expect(effects[0].category).toBe('destructive');
    expect(effects[0].title).toContain('C');
    expect(effects[0].affectedRowCount).toBe(3);
  });

  it('emits destructive R5 when codes are replaced (drop + add)', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B' },
      newRow: { Attributes: 'C;D' }
    });
    const effects = await applyAttributeRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].severity).toBe('destructive');
    expect(effects[0].category).toBe('destructive');
    expect(effects[0].title).toMatch(/A/);
    expect(effects[0].title).toMatch(/B/);
  });

  it('emits destructive R5 when new set is empty and old had codes', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A' },
      newRow: { Attributes: '' }
    });
    const effects = await applyAttributeRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].severity).toBe('destructive');
    expect(effects[0].affectedRowCount).toBe(1);
  });

  it('treats a comma as part of the code, NOT a delimiter (matches bulkingestionprocess STAGE 9)', async () => {
    // ";" is the only attribute-code delimiter. "A,B" is a SINGLE code containing a
    // comma — distinct from the two-code set {A, B}. Changing "A;B" -> "A,B" therefore
    // drops A and B and adds the single code "A,B", so the analyzer must flag a change,
    // not treat the two forms as equal. This is the comma-vs-semicolon regression the
    // ingestion incidents surfaced.
    const ctx = makeCtx({
      oldRow: { Attributes: 'A;B' },
      newRow: { Attributes: 'A,B' }
    });
    const effects = await applyAttributeRules(ctx);
    expect(effects).toHaveLength(1);
    expect(effects[0].severity).toBe('destructive');
    expect(effects[0].title).toMatch(/A/);
    expect(effects[0].title).toMatch(/B/);
  });

  it('trims whitespace around codes', async () => {
    const ctx = makeCtx({
      oldRow: { Attributes: 'A; B' },
      newRow: { Attributes: 'A ;B' }
    });
    expect(await applyAttributeRules(ctx)).toEqual([]);
  });
});

describe('parseAttributeCodes (shared production tokenizer)', () => {
  it('exposes ";" as the sole delimiter', () => {
    expect(ATTRIBUTE_CODE_DELIMITER).toBe(';');
  });

  it('splits on semicolons, trims, and drops empty segments', () => {
    expect(parseAttributeCodes(' A ; B ;; C ')).toEqual(['A', 'B', 'C']);
  });

  it('keeps a comma inside a code (a comma list is ONE code, not many)', () => {
    expect(parseAttributeCodes('A,B')).toEqual(['A,B']);
  });

  it('returns [] for null, undefined, and empty/whitespace input', () => {
    expect(parseAttributeCodes(null)).toEqual([]);
    expect(parseAttributeCodes(undefined)).toEqual([]);
    expect(parseAttributeCodes('')).toEqual([]);
    expect(parseAttributeCodes('   ')).toEqual([]);
    expect(parseAttributeCodes(' ; ; ')).toEqual([]);
  });
});
