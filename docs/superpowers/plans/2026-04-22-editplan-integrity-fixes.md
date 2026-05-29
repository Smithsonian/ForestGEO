# Editplan Integrity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three integrity gaps in the shared editplan layer — bulk plan-hash tampering, preview/apply mismatch for tree/stem resolver conflicts, and clearable-field writes silently keeping stale values.

**Architecture:** A new shared `canonicalrow.ts` module gives both the match and apply endpoints one canonicalizer with distinct `revision-update` and `revision-insert` modes, so the bulk plan hash can attest to new-row content and duplicate survivor/deletion pairs. The `treestem` rule gains an error-emission channel and the read-only planner's conflict reasons become blocking `PreviewError`s. Mutating resolver throws become a typed `MeasurementResolutionError` the apply route maps to 422. The `coremeasurements` writer replaces `??` fallbacks with a `changedFields`-gated helper for clearable fields.

**Tech Stack:** TypeScript, Next.js App Router, mysql2, vitest (unit + integration), existing editplan test harness at `frontend/tests/integration/*.integration.test.ts`.

**Spec:** `docs/superpowers/specs/2026-04-22-editplan-integrity-fixes-design.md`

---

## File Structure

**New files:**

- `frontend/config/editplan/canonicalrow.ts` — shared canonicalizer with `revision-update` / `revision-insert` modes.
- `frontend/config/editplan/canonicalrow.test.ts` — unit tests.
- `frontend/tests/integration/editplan-integrity.integration.test.ts` — end-to-end coverage.

**Modified files:**

- `frontend/config/editplan/types.ts` — new types: `DuplicateDeletion`, `TreeStemResolutionPreviewError`, extended `RowPlan`, extended `BulkEditPlan`, renamed union variants.
- `frontend/config/editplan/bulkanalyzer.ts` — populate `canonicalNewRow` + `duplicateDeletions`; error-aware `maxSeverity`; split `assertBulkPlanCanApply`; new thrown `BulkPlanUnapplicableError`.
- `frontend/config/editplan/analyzer.ts` — error-aware `maxSeverity`; split `assertEditPlanCanApply`; collect treestem errors; new thrown `EditPlanUnapplicableError`.
- `frontend/config/editplan/planhash.ts` — canonicalize `duplicateDeletions` into the bulk plan hash.
- `frontend/config/editplan/rules/treestem.ts` — return `{ effects, errors }`; emit seven `TreeStemResolutionPreviewError` cases.
- `frontend/config/editplan/rules/duplicates.ts` — accept structured duplicates (signature change; behavior unchanged — still sums count).
- `frontend/config/editplan/resolvers.ts` — no change (already returns `conflictReason`).
- `frontend/config/editplan/writers/resolvers-mutating.ts` — replace 7 `throw new Error(...)` with `MeasurementResolutionError`.
- `frontend/config/editplan/writers/measurementssummary.ts` — `effective()` helper for clearable fields.
- `frontend/app/api/revisionupload/route.ts` — retire `buildAnalyzerNewRow`; build `DuplicateDeletion[]` from matched rows.
- `frontend/app/api/revisionupload/apply/route.ts` — retire `buildCanonicalNewRow`; use structured duplicates; map new errors to 422.
- `frontend/app/api/edits/apply/route.ts` — map `EditPlanUnapplicableError` and `MeasurementResolutionError` to 422.

**Existing tests to update:**

- `frontend/config/editplan/analyzer.test.ts`, `bulkanalyzer.test.ts` (if present), `planhash.test.ts` — new assertions for error-aware maxSeverity, split asserts, duplicateDeletions hash, canonicalNewRow.
- `frontend/config/editplan/writers/measurementssummary.test.ts` (or equivalent) — explicit-null coverage.
- `frontend/app/api/revisionupload/route.test.ts`, `apply/route.test.ts` — structured duplicate payload, 422 mappings.
- `frontend/config/editplan/rules/treestem.test.ts` (create if absent) — 7 emission points + fixtures for `cannot_create`.

---

## Task 1: Shared canonicalrow module

**Goal:** Introduce `canonicalrow.ts` that normalizes a CSV row into the stable, hashable shape the analyzer and apply path both consume, with distinct modes for matched updates and new inserts.

**Files:**
- Create: `frontend/config/editplan/canonicalrow.ts`
- Create: `frontend/config/editplan/canonicalrow.test.ts`

**Acceptance Criteria:**
- [ ] `canonicalizeRowForHash(row, 'revision-update')` returns only `MeasuredDBH`, `MeasuredHOM`, `MeasurementDate`, `Attributes`, `Description` keys (any of those present in input, normalized).
- [ ] `canonicalizeRowForHash(row, 'revision-insert')` additionally includes `TreeTag`, `StemTag`, `SpeciesCode`, `QuadratName`, `StemLocalX`, `StemLocalY`.
- [ ] Accepts CSV lowercase aliases (`dbh`, `hom`, `date`, `codes`, `comments`, `tag`, `stemtag`, `spcode`, `quadrat`, `lx`, `ly`) and canonical keys (`MeasuredDBH`, `TreeTag`, ...) interchangeably.
- [ ] Trims strings; collapses empty-string and case-insensitive `'NULL'` to `null`.
- [ ] Date values canonicalize to `YYYY-MM-DD`.
- [ ] Decimal values round to `PER_COLUMN_DECIMAL_PRECISION[field]` for the numeric fields (`MeasuredDBH`, `MeasuredHOM`, `StemLocalX`, `StemLocalY`).
- [ ] Unknown/off-list keys are dropped silently.
- [ ] Idempotent: `canonicalizeRowForHash(canonicalizeRowForHash(x, mode), mode)` deep-equals `canonicalizeRowForHash(x, mode)`.

**Verify:** `cd frontend && npx vitest run config/editplan/canonicalrow.test.ts` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing unit tests**

Create `frontend/config/editplan/canonicalrow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canonicalizeRowForHash } from './canonicalrow';

describe('canonicalizeRowForHash', () => {
  describe('revision-update mode', () => {
    it('keeps only updatable fields and drops identity keys', () => {
      const out = canonicalizeRowForHash(
        { dbh: '10', tag: 'T1', spcode: 'ABC', codes: 'M' },
        'revision-update'
      );
      expect(out).toEqual({ MeasuredDBH: 10, Attributes: 'M' });
      expect(out).not.toHaveProperty('TreeTag');
      expect(out).not.toHaveProperty('SpeciesCode');
    });
    it('accepts canonical keys as input', () => {
      const out = canonicalizeRowForHash({ MeasuredDBH: 10, Attributes: 'M' }, 'revision-update');
      expect(out).toEqual({ MeasuredDBH: 10, Attributes: 'M' });
    });
  });

  describe('revision-insert mode', () => {
    it('keeps updatable + identity fields', () => {
      const out = canonicalizeRowForHash(
        { tag: 'T1', stemtag: 'S1', spcode: 'abc', quadrat: 'Q1', lx: '1.23456', ly: '2', dbh: '10', date: '2026-04-22' },
        'revision-insert'
      );
      expect(out.TreeTag).toBe('T1');
      expect(out.StemTag).toBe('S1');
      expect(out.SpeciesCode).toBe('abc');
      expect(out.QuadratName).toBe('Q1');
      expect(out.StemLocalX).toBeCloseTo(1.23456);
      expect(out.StemLocalY).toBe(2);
      expect(out.MeasuredDBH).toBe(10);
      expect(out.MeasurementDate).toBe('2026-04-22');
    });
  });

  describe('normalization', () => {
    it('trims strings', () => {
      const out = canonicalizeRowForHash({ comments: '  hello  ' }, 'revision-update');
      expect(out.Description).toBe('hello');
    });
    it('collapses empty string to null', () => {
      const out = canonicalizeRowForHash({ comments: '' }, 'revision-update');
      expect(out.Description).toBeNull();
    });
    it("collapses 'NULL' placeholder (case-insensitive) to null", () => {
      const upper = canonicalizeRowForHash({ comments: 'NULL' }, 'revision-update');
      const lower = canonicalizeRowForHash({ comments: 'null' }, 'revision-update');
      expect(upper.Description).toBeNull();
      expect(lower.Description).toBeNull();
    });
    it('coerces ISO date strings to YYYY-MM-DD', () => {
      const out = canonicalizeRowForHash({ date: '2026-04-22T00:00:00.000Z' }, 'revision-update');
      expect(out.MeasurementDate).toBe('2026-04-22');
    });
    it('rounds decimals per PER_COLUMN_DECIMAL_PRECISION', () => {
      const out = canonicalizeRowForHash({ dbh: '1.23456789' }, 'revision-update');
      expect(typeof out.MeasuredDBH).toBe('number');
      expect(Number.isFinite(out.MeasuredDBH as number)).toBe(true);
    });
    it('drops unknown keys', () => {
      const out = canonicalizeRowForHash({ dbh: '10', bogus: 'x' }, 'revision-update');
      expect(out).not.toHaveProperty('bogus');
    });
    it('is idempotent', () => {
      const first = canonicalizeRowForHash({ dbh: '10', comments: '  note ' }, 'revision-update');
      const second = canonicalizeRowForHash(first, 'revision-update');
      expect(second).toEqual(first);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run config/editplan/canonicalrow.test.ts`
Expected: FAIL with "Cannot find module './canonicalrow'".

- [ ] **Step 3: Implement the module**

Create `frontend/config/editplan/canonicalrow.ts`:

```ts
import { PER_COLUMN_DECIMAL_PRECISION, isDateField } from './fieldpolicy';

export type RowMode = 'revision-update' | 'revision-insert';

type CanonicalField =
  | 'TreeTag' | 'StemTag' | 'SpeciesCode' | 'QuadratName'
  | 'StemLocalX' | 'StemLocalY'
  | 'MeasuredDBH' | 'MeasuredHOM' | 'MeasurementDate'
  | 'Attributes' | 'Description';

const UPDATE_FIELDS: readonly CanonicalField[] = [
  'MeasuredDBH', 'MeasuredHOM', 'MeasurementDate', 'Attributes', 'Description'
];

const INSERT_FIELDS: readonly CanonicalField[] = [
  ...UPDATE_FIELDS,
  'TreeTag', 'StemTag', 'SpeciesCode', 'QuadratName', 'StemLocalX', 'StemLocalY'
];

const CSV_ALIAS_TO_CANONICAL: Record<string, CanonicalField> = {
  tag: 'TreeTag',
  stemtag: 'StemTag',
  spcode: 'SpeciesCode',
  quadrat: 'QuadratName',
  lx: 'StemLocalX',
  ly: 'StemLocalY',
  dbh: 'MeasuredDBH',
  hom: 'MeasuredHOM',
  date: 'MeasurementDate',
  codes: 'Attributes',
  comments: 'Description'
};

function toCanonicalKey(key: string): CanonicalField | null {
  if (key in CSV_ALIAS_TO_CANONICAL) return CSV_ALIAS_TO_CANONICAL[key];
  if ((UPDATE_FIELDS as readonly string[]).includes(key) || (INSERT_FIELDS as readonly string[]).includes(key)) {
    return key as CanonicalField;
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null;
  return trimmed;
}

function normalizeDate(value: unknown): string | null {
  const trimmed = normalizeString(value);
  if (trimmed === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10);
}

function normalizeDecimal(value: unknown, precision: number): number | null {
  const trimmed = normalizeString(value);
  if (trimmed === null) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(precision));
}

export function canonicalizeRowForHash(
  row: Record<string, unknown>,
  mode: RowMode
): Record<string, unknown> {
  const allowed = new Set<CanonicalField>(mode === 'revision-insert' ? INSERT_FIELDS : UPDATE_FIELDS);
  const out: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(row)) {
    const canonical = toCanonicalKey(rawKey);
    if (canonical === null || !allowed.has(canonical)) continue;

    if (isDateField(canonical)) {
      out[canonical] = normalizeDate(rawValue);
      continue;
    }
    const precision = PER_COLUMN_DECIMAL_PRECISION[canonical];
    if (precision !== undefined) {
      out[canonical] = normalizeDecimal(rawValue, precision);
      continue;
    }
    out[canonical] = normalizeString(rawValue);
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run config/editplan/canonicalrow.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/mason/dev/ForestGEO
git add frontend/config/editplan/canonicalrow.ts frontend/config/editplan/canonicalrow.test.ts
git commit -m "Add shared canonicalrow module for editplan hash parity"
```

---

## Task 2: P1 types + planhash canonicalization

**Goal:** Introduce `DuplicateDeletion`, attach `canonicalNewRow?` to `RowPlan`, add `duplicateDeletions` to `BulkEditPlan`, and canonicalize the new field into the bulk plan hash. No behavior change yet — scaffolding for Task 3.

**Files:**
- Modify: `frontend/config/editplan/types.ts`
- Modify: `frontend/config/editplan/planhash.ts`
- Modify: `frontend/config/editplan/planhash.test.ts`

**Acceptance Criteria:**
- [ ] `DuplicateDeletion` exported from `types.ts` with `{ coreMeasurementID: number; survivorCoreMeasurementID: number }`.
- [ ] `RowPlan.canonicalNewRow?: Record<string, unknown>` present.
- [ ] `BulkEditPlan.duplicateDeletions: DuplicateDeletion[]` present (required, empty array when absent).
- [ ] `planhash.canonicalizePlan` includes `duplicateDeletions` sorted by `coreMeasurementID` then `survivorCoreMeasurementID`.
- [ ] No dedupe of duplicate pairs prior to hashing.
- [ ] Existing planhash tests still pass with empty `duplicateDeletions`.

**Verify:** `cd frontend && npx vitest run config/editplan/planhash.test.ts` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Add to `frontend/config/editplan/planhash.test.ts`:

```ts
import { hashPlan } from './planhash';
import type { BulkEditPlan } from './types';

function buildBulkPlanShell(overrides: Partial<BulkEditPlan> = {}): BulkEditPlan {
  return {
    dataType: 'measurementssummary',
    rowCount: 0,
    rowPlans: [],
    aggregateEffects: [],
    errors: [],
    canApply: true,
    maxSeverity: 'info',
    planHash: '',
    generatedAt: '2026-04-22T00:00:00.000Z',
    duplicateDeletions: [],
    ...overrides
  };
}

describe('planhash - bulk duplicateDeletions', () => {
  it('hashes same pairs regardless of input order', () => {
    const a = hashPlan(buildBulkPlanShell({
      duplicateDeletions: [
        { coreMeasurementID: 10, survivorCoreMeasurementID: 1 },
        { coreMeasurementID: 20, survivorCoreMeasurementID: 2 }
      ]
    }));
    const b = hashPlan(buildBulkPlanShell({
      duplicateDeletions: [
        { coreMeasurementID: 20, survivorCoreMeasurementID: 2 },
        { coreMeasurementID: 10, survivorCoreMeasurementID: 1 }
      ]
    }));
    expect(a).toBe(b);
  });

  it('changes hash when survivor ID swaps', () => {
    const a = hashPlan(buildBulkPlanShell({
      duplicateDeletions: [{ coreMeasurementID: 10, survivorCoreMeasurementID: 1 }]
    }));
    const b = hashPlan(buildBulkPlanShell({
      duplicateDeletions: [{ coreMeasurementID: 10, survivorCoreMeasurementID: 2 }]
    }));
    expect(a).not.toBe(b);
  });

  it('changes hash when a pair is duplicated (no dedupe)', () => {
    const single = hashPlan(buildBulkPlanShell({
      duplicateDeletions: [{ coreMeasurementID: 10, survivorCoreMeasurementID: 1 }]
    }));
    const doubled = hashPlan(buildBulkPlanShell({
      duplicateDeletions: [
        { coreMeasurementID: 10, survivorCoreMeasurementID: 1 },
        { coreMeasurementID: 10, survivorCoreMeasurementID: 1 }
      ]
    }));
    expect(single).not.toBe(doubled);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run config/editplan/planhash.test.ts`
Expected: FAIL (either `BulkEditPlan` missing `duplicateDeletions` field → type error, or hash does not include pairs).

- [ ] **Step 3: Update `types.ts`**

Add `DuplicateDeletion` and extend `RowPlan` / `BulkEditPlan`:

```ts
export interface DuplicateDeletion {
  coreMeasurementID: number;
  survivorCoreMeasurementID: number;
}

export interface RowPlan {
  rowIndex: number;
  targetID?: number;
  plan?: EditPlan;
  status: 'matched' | 'new' | 'invalid' | 'unchanged';
  reason?: string;
  canonicalNewRow?: Record<string, unknown>;
}

export interface BulkEditPlan {
  dataType: EditPlanDataType;
  rowCount: number;
  rowPlans: RowPlan[];
  aggregateEffects: Effect[];
  errors?: PreviewError[];
  canApply?: boolean;
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
  duplicateDeletions: DuplicateDeletion[];
}
```

- [ ] **Step 4: Update `planhash.ts::canonicalizePlan`**

Replace the `BulkEditPlan` branch of `canonicalizePlan`:

```ts
export function canonicalizePlan(plan: EditPlan | BulkEditPlan): unknown {
  if ('rowPlans' in plan) {
    const { planHash: _planHash, generatedAt: _generatedAt, ...rest } = plan;
    const sortedDuplicates = [...plan.duplicateDeletions].sort((a, b) =>
      a.coreMeasurementID - b.coreMeasurementID ||
      a.survivorCoreMeasurementID - b.survivorCoreMeasurementID
    );
    return sortKeys({
      ...rest,
      rowPlans: plan.rowPlans
        .map(canonicalizeRowPlan)
        .sort((a, b) => Number((a as { rowIndex: number }).rowIndex) - Number((b as { rowIndex: number }).rowIndex)),
      aggregateEffects: sortEffects(plan.aggregateEffects).map(effect => sortKeys(effect)),
      duplicateDeletions: sortedDuplicates
    });
  }
  return canonicalizeEditPlan(plan);
}
```

- [ ] **Step 5: Fix existing plan construction call sites**

Search the codebase for `BulkEditPlan` construction and add `duplicateDeletions: []` where absent (likely only `bulkanalyzer.ts` and test fixtures).

```bash
cd frontend && grep -rn "rowPlans:" --include='*.ts' --include='*.tsx' config/editplan app/api tests | head -20
```

Add `duplicateDeletions: []` to any `BulkEditPlan` literal that does not set it. Task 3 will replace this stub with real data in `bulkanalyzer.ts`.

- [ ] **Step 6: Run tests**

Run: `cd frontend && npx vitest run config/editplan/planhash.test.ts config/editplan/bulkanalyzer.test.ts config/editplan/analyzer.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/config/editplan/types.ts frontend/config/editplan/planhash.ts frontend/config/editplan/planhash.test.ts frontend/config/editplan/bulkanalyzer.ts
git commit -m "Extend editplan types for structured duplicate pairs and canonical new rows"
```

---

## Task 3: bulkanalyzer populates canonicalNewRow and duplicateDeletions

**Goal:** `analyzeBulk` canonicalizes new rows via the shared module (insert mode) onto each `RowPlan`, and emits concrete `DuplicateDeletion[]` onto the plan. `BulkInput.duplicateMeasurementIDsToDelete` becomes a structured array.

**Files:**
- Modify: `frontend/config/editplan/bulkanalyzer.ts`
- Modify: `frontend/config/editplan/rules/duplicates.ts`
- Modify: `frontend/config/editplan/analyzer.test.ts` (or co-located bulkanalyzer tests — update existing fixtures).

**Acceptance Criteria:**
- [ ] `BulkInput.duplicateMeasurementIDsToDelete` is `DuplicateDeletion[]`.
- [ ] Each `RowPlan` with `status: 'new'` has `canonicalNewRow` populated from `canonicalizeRowForHash(input.newRow, 'revision-insert')`.
- [ ] `BulkEditPlan.duplicateDeletions` contains the sorted pairs.
- [ ] `applyDuplicateRules` accepts the structured array and still returns the same count-based effect (affectedRowCount == pairs.length).
- [ ] Existing analyzer tests continue to pass after fixture updates.

**Verify:** `cd frontend && npx vitest run config/editplan/` → all tests pass.

**Steps:**

- [ ] **Step 1: Update the rule signature**

Edit `frontend/config/editplan/rules/duplicates.ts`:

```ts
import { DuplicateDeletion, Effect } from '../types';

export function applyDuplicateRules(duplicates: readonly DuplicateDeletion[]): Effect[] {
  if (duplicates.length === 0) return [];
  return [{
    id: 'R6',
    severity: 'destructive',
    category: 'destructive',
    title: 'Duplicate measurements will be deleted',
    detail: `${duplicates.length} duplicate measurement(s) scheduled for deletion`,
    affectedTable: 'coremeasurements',
    affectedRowCount: duplicates.length
  }];
}
```

(Match the exact title/detail wording in the current implementation — open `duplicates.ts` first and preserve any existing copy.)

- [ ] **Step 2: Update `bulkanalyzer.ts`**

Update `BulkInput` and the analyzer body:

```ts
import { canonicalizeRowForHash } from './canonicalrow';
import { BulkEditPlan, DuplicateDeletion, EditPlanDataType, Effect, PreviewError, RowPlan, SEVERITY_RANK, Severity } from './types';

export interface BulkInput {
  matched: Array<{ rowIndex: number; targetID: number; newRow: Record<string, unknown> }>;
  newRows: Array<{ rowIndex: number; newRow: Record<string, unknown> }>;
  invalid: Array<{ rowIndex: number; reason: string }>;
  duplicateMeasurementIDsToDelete: DuplicateDeletion[];
}
```

Replace the new-row loop:

```ts
for (const newRow of input.newRows) {
  rowPlans.push({
    rowIndex: newRow.rowIndex,
    status: 'new',
    canonicalNewRow: canonicalizeRowForHash(newRow.newRow, 'revision-insert')
  });
}
```

Replace the duplicate-rule call:

```ts
surfacedEffects.push(...applyDuplicateRules(input.duplicateMeasurementIDsToDelete));
```

Add `duplicateDeletions` to the returned plan:

```ts
const plan: BulkEditPlan = {
  dataType,
  rowCount: rowPlans.length,
  rowPlans,
  aggregateEffects,
  errors,
  canApply: errors.length === 0,
  maxSeverity,
  planHash: '',
  generatedAt: new Date().toISOString(),
  duplicateDeletions: [...input.duplicateMeasurementIDsToDelete]
};
plan.planHash = hashPlan(plan);
return plan;
```

- [ ] **Step 3: Update analyzer tests**

Existing `analyzer.test.ts` cases build `BulkInput` with `duplicateMeasurementIDsToDelete: [101, 102]` etc. Convert to structured pairs. Example:

```ts
// Before:
// duplicateMeasurementIDsToDelete: [101, 102]
// After (each duplicate pairs with a matched row's survivor):
duplicateMeasurementIDsToDelete: [
  { coreMeasurementID: 101, survivorCoreMeasurementID: MATCHED_ID },
  { coreMeasurementID: 102, survivorCoreMeasurementID: MATCHED_ID }
]
```

Add one new test: a `status: 'new'` row plan has `canonicalNewRow` populated.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run config/editplan/analyzer.test.ts config/editplan/planhash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/config/editplan/bulkanalyzer.ts frontend/config/editplan/rules/duplicates.ts frontend/config/editplan/analyzer.test.ts
git commit -m "Populate canonicalNewRow and structured duplicate pairs in bulk plan"
```

---

## Task 4: Match route uses shared canonicalizer and structured duplicates

**Goal:** `app/api/revisionupload/route.ts` retires `buildAnalyzerNewRow` in favor of the shared module (update mode for matched, insert mode for new) and emits `DuplicateDeletion[]` with per-matched-row survivor pairing.

**Files:**
- Modify: `frontend/app/api/revisionupload/route.ts`
- Modify: `frontend/app/api/revisionupload/route.test.ts`

**Acceptance Criteria:**
- [ ] `buildBulkInput` calls `canonicalizeRowForHash(row.csvRow, 'revision-update')` for matched, `'revision-insert'` for new rows.
- [ ] `buildBulkInput` returns `DuplicateDeletion[]` pairing each duplicate ID with its matched survivor's `coreMeasurementID`.
- [ ] `buildAnalyzerNewRow` is removed.
- [ ] Match endpoint response still includes `bulkPlanHash` (no contract change on return shape).
- [ ] Existing route tests still pass after minor fixture updates (duplicates now structured).

**Verify:** `cd frontend && npx vitest run app/api/revisionupload/route.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Update `buildBulkInput`**

Replace in `frontend/app/api/revisionupload/route.ts` around line 566:

```ts
import { canonicalizeRowForHash } from '@/config/editplan/canonicalrow';
import type { DuplicateDeletion } from '@/config/editplan/types';

function buildBulkInput(
  matchedRows: RevisionMatchedRow[],
  newRows: RevisionNewRowCandidate[],
  invalidRows: RevisionInvalidRow[]
): BulkInput {
  const duplicatePairs: DuplicateDeletion[] = [];
  for (const row of matchedRows) {
    for (const duplicateID of row.duplicateMeasurementIDsToDelete ?? []) {
      duplicatePairs.push({
        coreMeasurementID: duplicateID,
        survivorCoreMeasurementID: row.coreMeasurementID
      });
    }
  }

  return {
    matched: matchedRows.map((row, index) => ({
      rowIndex: index,
      targetID: row.coreMeasurementID,
      newRow: canonicalizeRowForHash(row.csvRow, 'revision-update')
    })),
    newRows: newRows.map(row => ({
      rowIndex: row.csvIndex,
      newRow: canonicalizeRowForHash(row.csvRow, 'revision-insert')
    })),
    invalid: invalidRows.map(row => ({
      rowIndex: row.csvIndex,
      reason: row.reason
    })),
    duplicateMeasurementIDsToDelete: duplicatePairs
  };
}
```

- [ ] **Step 2: Delete `buildAnalyzerNewRow`**

Remove the function at line 544-564. Search for any remaining references; there should be none after Step 1.

```bash
cd frontend && grep -n "buildAnalyzerNewRow" app/api/revisionupload/route.ts
# Expected: no matches after deletion
```

- [ ] **Step 3: Update route tests**

`route.test.ts` currently asserts `bulkInput.duplicateMeasurementIDsToDelete` shape. Expect the structured array:

```ts
expect(bulkInput.duplicateMeasurementIDsToDelete).toEqual([
  { coreMeasurementID: 600, survivorCoreMeasurementID: <matched survivor ID> }
]);
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run app/api/revisionupload/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/revisionupload/route.ts frontend/app/api/revisionupload/route.test.ts
git commit -m "Migrate revision match route to shared canonicalizer and structured duplicate pairs"
```

---

## Task 5: Apply route uses shared canonicalizer and structured duplicates

**Goal:** `apply/route.ts` retires `buildCanonicalNewRow` in favor of `canonicalizeRowForHash`, consumes structured `DuplicateDeletion[]` from the client payload, and rebuilds `bulkInputForHashCheck` from the structured pairs.

**Files:**
- Modify: `frontend/app/api/revisionupload/apply/route.ts`
- Modify: `frontend/app/api/revisionupload/apply/route.test.ts`

**Acceptance Criteria:**
- [ ] `buildCanonicalNewRow` is removed; `hasAnyCanonicalField` references the shared canonicalizer in update mode.
- [ ] `bulkInputForHashCheck` uses the shared canonicalizer with `revision-update` for matched rows and `revision-insert` for new rows.
- [ ] `duplicateMeasurementIDsToDelete` in the rebuilt `BulkInput` carries the `DuplicateDeletion[]` pairs currently held by `duplicates` (from `rowDuplicateHints` or normalized client input).
- [ ] `duplicatesMatch` still guards against payload drift between `matchedRows[].duplicateMeasurementIDsToDelete` and the top-level `duplicateMeasurementIDsToDelete`.
- [ ] Existing apply-route tests pass after fixture updates.

**Verify:** `cd frontend && npx vitest run app/api/revisionupload/apply/route.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Replace `buildCanonicalNewRow`**

In `frontend/app/api/revisionupload/apply/route.ts`:

```ts
import { canonicalizeRowForHash } from '@/config/editplan/canonicalrow';
```

Delete the local `buildCanonicalNewRow` (lines ~396-417). Update the three existing call sites:

- Line 837 (matched): `newRow: canonicalizeRowForHash(row.csvRow, 'revision-update')`
- Line 841 (new rows): `newRow: canonicalizeRowForHash(row.csvRow, 'revision-insert')`
- Line 905 (inside matched-row apply loop): `const canonicalNewRow = canonicalizeRowForHash(row.csvRow, 'revision-update');`
- `hasAnyCanonicalField`: `return Object.keys(canonicalizeRowForHash(csvRow, 'revision-update')).length > 0;`

- [ ] **Step 2: Hand the structured duplicates to `analyzeBulk`**

Replace the `duplicateMeasurementIDsToDelete` line in `bulkInputForHashCheck`:

```ts
duplicateMeasurementIDsToDelete: duplicates   // `duplicates` is already DuplicateDeletion[]
```

Remove `.map(d => d.coreMeasurementID)`.

- [ ] **Step 3: Update route tests**

`apply/route.test.ts` already uses the pair shape at lines ~288, ~332, ~565. Only ensure the rebuilt `bulkInputForHashCheck` assertions match the new structure. The existing helpers likely cover this — run the suite and adjust fixtures for any failing expectations.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run app/api/revisionupload/apply/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/revisionupload/apply/route.ts frontend/app/api/revisionupload/apply/route.test.ts
git commit -m "Migrate revision apply route to shared canonicalizer"
```

---

## Task 6: P1 integration test — hash drift

**Goal:** End-to-end coverage that tampering with new-row content or swapping a duplicate survivor between match and apply surfaces as a 409 plan-hash drift.

**Files:**
- Create: `frontend/tests/integration/editplan-integrity.integration.test.ts`

**Acceptance Criteria:**
- [ ] One test submits a CSV that produces a matched row + a new row, records `bulkPlanHash`, tampers with `newRows[0].csvRow.tag`, and POSTs apply → 409 with `freshPlan` in body.
- [ ] One test submits a CSV that produces two duplicates for the same matched survivor, records `bulkPlanHash`, swaps `duplicateMeasurementIDsToDelete[0].coreMeasurementID` to the other duplicate, POSTs apply → 409.
- [ ] Integration test uses the local Docker MySQL and the existing `setupTestDatabase`/seed helpers under `frontend/tests/setup/local-db-setup.ts`.

**Verify:** `cd frontend && npm run test:integration -- tests/integration/editplan-integrity.integration.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Scaffold the integration test file**

Create `frontend/tests/integration/editplan-integrity.integration.test.ts` using the existing integration-suite conventions (see a neighbor like `cross-census-validations.integration.test.ts` for the test-database lifecycle pattern). Import the match and apply route handlers directly:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, teardownTestDatabase, seedTreeWithStemAndMeasurement /* add helpers as needed */ } from '../setup/local-db-setup';
import { POST as matchHandler } from '@/app/api/revisionupload/route';
import { POST as applyHandler } from '@/app/api/revisionupload/apply/route';
```

- [ ] **Step 2: Add the tampered-new-row test**

```ts
it('returns 409 when a new row\'s tag is tampered between match and apply', async () => {
  const { schema, plotID, censusID } = await setupTestDatabase(/* ... */);
  // Seed a matched row target + ensure a new row candidate has all required insert fields.

  const matchRequest = buildMatchRequest({ /* one matched row + one fresh-insert row */ });
  const matchResponse = await matchHandler(matchRequest);
  expect(matchResponse.status).toBe(200);
  const matchBody = await matchResponse.json();
  const originalHash = matchBody.bulkPlanHash;

  // Tamper: change the tag on the new-row candidate
  const applyPayload = buildApplyPayloadFromMatch(matchBody);
  applyPayload.newRows[0].csvRow.tag = 'TAMPERED';

  const applyResponse = await applyHandler(buildApplyRequest(applyPayload, originalHash));
  expect(applyResponse.status).toBe(409);
  const applyBody = await applyResponse.json();
  expect(applyBody.error).toBe('plan hash mismatch');
  expect(applyBody.freshPlan.planHash).not.toBe(originalHash);
});
```

(Use concrete row/field shapes from `route.test.ts` as a template; the test should not reach the network — it invokes the route handlers directly.)

- [ ] **Step 3: Add the swapped-duplicate test**

Seed two active measurements under the same stem so the match endpoint produces one survivor + two duplicates for one matched row. Record the plan hash. On apply, swap `duplicateMeasurementIDsToDelete[0].coreMeasurementID` from the first duplicate to the second.

Tests:
```ts
// Expect 409 because duplicateDeletions pair differs → hash differs
expect(applyResponse.status).toBe(409);
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npm run test:integration -- tests/integration/editplan-integrity.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/tests/integration/editplan-integrity.integration.test.ts
git commit -m "Add P1 integration coverage for bulk hash drift on tampered payload"
```

---

## Task 7: P2 types and error classes

**Goal:** Add the `TreeStemResolutionPreviewError` PreviewError variant, rename the existing variant to `RoleForbiddenFieldPreviewError`, and introduce three new thrown error classes: `EditPlanUnapplicableError`, `BulkPlanUnapplicableError`, `MeasurementResolutionError`.

**Files:**
- Modify: `frontend/config/editplan/types.ts`
- Modify: `frontend/config/editplan/analyzer.ts`
- Modify: `frontend/config/editplan/bulkanalyzer.ts`
- Modify: `frontend/config/editplan/writers/resolvers-mutating.ts`

**Acceptance Criteria:**
- [ ] `PreviewError` is a discriminated union of `RoleForbiddenFieldPreviewError | TreeStemResolutionPreviewError`.
- [ ] Discriminant literal values (`'RoleForbiddenField' | 'TreeStemResolution'`) unchanged / new.
- [ ] `EditPlanUnapplicableError` exported from `analyzer.ts`; carries `public readonly blockingErrors: PreviewError[]`.
- [ ] `BulkPlanUnapplicableError` exported from `bulkanalyzer.ts`; same shape.
- [ ] `MeasurementResolutionError` exported from `resolvers-mutating.ts` with `subject`/`reason`/`message` fields.
- [ ] Code compiles; existing suite still passes (no behavior change yet, just type + class definitions).

**Verify:** `cd frontend && npx vitest run config/editplan/` → PASS, and `npx tsc -p .` compiles.

**Steps:**

- [ ] **Step 1: Extend `types.ts`**

Replace the `PreviewError` interface with a union:

```ts
import type { UserAuthRoles } from '@/config/macros';

export interface RoleForbiddenFieldPreviewError {
  kind: 'RoleForbiddenField';
  field: string;
  role: UserAuthRoles | 'unknown';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

export interface TreeStemResolutionPreviewError {
  kind: 'TreeStemResolution';
  subject: 'species' | 'quadrat' | 'tree' | 'stem';
  reason: 'missing' | 'inactive' | 'different_quadrat' | 'cannot_create';
  field: 'SpeciesCode' | 'QuadratName' | 'TreeTag' | 'StemTag';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

export type PreviewError = RoleForbiddenFieldPreviewError | TreeStemResolutionPreviewError;
```

- [ ] **Step 2: Add `EditPlanUnapplicableError` to `analyzer.ts`**

```ts
import type { PreviewError } from './types';

export class EditPlanUnapplicableError extends Error {
  constructor(public readonly blockingErrors: PreviewError[]) {
    super(`edit plan not applicable: ${blockingErrors.map(e => e.kind).join(',')}`);
    this.name = 'EditPlanUnapplicableError';
  }
}
```

- [ ] **Step 3: Add `BulkPlanUnapplicableError` to `bulkanalyzer.ts`**

```ts
import type { PreviewError } from './types';

export class BulkPlanUnapplicableError extends Error {
  constructor(public readonly blockingErrors: PreviewError[]) {
    super(`bulk plan not applicable: ${blockingErrors.map(e => e.kind).join(',')}`);
    this.name = 'BulkPlanUnapplicableError';
  }
}
```

- [ ] **Step 4: Add `MeasurementResolutionError` to `resolvers-mutating.ts`**

At the top of `frontend/config/editplan/writers/resolvers-mutating.ts`:

```ts
export class MeasurementResolutionError extends Error {
  constructor(
    public readonly subject: 'species' | 'quadrat' | 'tree' | 'stem',
    public readonly reason: 'missing' | 'inactive' | 'different_quadrat',
    message: string
  ) {
    super(message);
    this.name = 'MeasurementResolutionError';
  }
}
```

- [ ] **Step 5: Compile and run suite**

Run:
```bash
cd frontend && npx tsc --noEmit
cd frontend && npx vitest run config/editplan/
```
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/config/editplan/types.ts frontend/config/editplan/analyzer.ts frontend/config/editplan/bulkanalyzer.ts frontend/config/editplan/writers/resolvers-mutating.ts
git commit -m "Introduce TreeStemResolution preview error and typed apply error classes"
```

---

## Task 8: treestem rule emits errors

**Goal:** `applyTreeStemRules` returns `{ effects, errors }`. Each of the 7 emission points pushes a correctly-typed `TreeStemResolutionPreviewError`. Analyzer hooks the new return shape and collects the errors onto the `EditPlan`.

**Files:**
- Modify: `frontend/config/editplan/rules/treestem.ts`
- Modify: `frontend/config/editplan/analyzer.ts`
- Create/Modify: `frontend/config/editplan/rules/treestem.test.ts`

**Acceptance Criteria:**
- [ ] `applyTreeStemRules` returns `Promise<{ effects: Effect[]; errors: PreviewError[] }>`.
- [ ] Emits errors for the 7 cases enumerated in the spec, each with correct `(subject, reason, field)` tuple.
- [ ] No error emitted when the planner finds a clean destination (existing behavior).
- [ ] No error emitted for fields not in `changedFields` (e.g., don't report missing SpeciesCode if SpeciesCode wasn't edited).
- [ ] `analyzer.ts` calls `applyTreeStemRules(ctx)` and appends both its `effects` and `errors` onto the plan. Other rules (`applySpeciesRules`, `applyCoordinateRules`, `applyAttributeRules`) keep their `Effect[]` return shape.
- [ ] `EditPlan.canApply` becomes false when treestem errors are present.

**Verify:** `cd frontend && npx vitest run config/editplan/rules/treestem.test.ts config/editplan/analyzer.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Create `frontend/config/editplan/rules/treestem.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyTreeStemRules } from './treestem';
import * as resolvers from '../resolvers';

function buildCtx(overrides = {}) {
  return {
    cm: {} as any,
    schema: 'test',
    transactionID: 'tx',
    dataType: 'measurementssummary' as const,
    plotID: 1,
    censusID: 1,
    oldRow: { TreeID: 10, SpeciesCode: 'OLD', TreeTag: 'OLD-TAG', StemTag: 'OLD-STEM', QuadratName: 'OLD-Q', StemGUID: 100, ...overrides.oldRow },
    newRow: { ...overrides.newRow },
    changedFields: overrides.changedFields ?? new Set<string>()
  } as any;
}

describe('applyTreeStemRules', () => {
  it('emits UnresolvableSpecies when species code not found', async () => {
    vi.spyOn(resolvers, 'resolveSpeciesByCode').mockResolvedValue({ speciesID: null });
    const ctx = buildCtx({
      newRow: { SpeciesCode: 'ZZZZ' },
      changedFields: new Set(['SpeciesCode'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      kind: 'TreeStemResolution',
      subject: 'species', reason: 'missing', field: 'SpeciesCode'
    }));
  });

  it('emits inactive tree conflict', async () => {
    vi.spyOn(resolvers, 'resolveSpeciesByCode').mockResolvedValue({ speciesID: 7 });
    vi.spyOn(resolvers, 'planTreeResolution').mockResolvedValue({
      existingTreeID: null, wouldCreate: false,
      sourceTreeID: 10, sourceTreeRemainingStems: 0,
      conflictReason: 'matching tree is inactive'
    });
    const ctx = buildCtx({
      newRow: { SpeciesCode: 'ABC', TreeTag: 'NEW' },
      changedFields: new Set(['TreeTag', 'SpeciesCode'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      subject: 'tree', reason: 'inactive', field: 'TreeTag'
    }));
  });

  it('emits cannot_create when planner reports wouldCreate=false with no conflict', async () => {
    vi.spyOn(resolvers, 'resolveSpeciesByCode').mockResolvedValue({ speciesID: 7 });
    vi.spyOn(resolvers, 'planTreeResolution').mockResolvedValue({
      existingTreeID: null, wouldCreate: false,
      sourceTreeID: 10, sourceTreeRemainingStems: 0
    });
    const ctx = buildCtx({
      newRow: { SpeciesCode: 'ABC', TreeTag: 'NEW' },
      changedFields: new Set(['TreeTag', 'SpeciesCode'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      subject: 'tree', reason: 'cannot_create', field: 'TreeTag'
    }));
  });

  it('emits missing quadrat when quadrat name not resolvable', async () => {
    vi.spyOn(resolvers, 'planQuadratResolution').mockResolvedValue({ quadratID: null });
    const ctx = buildCtx({
      newRow: { QuadratName: 'BOGUS', StemTag: 'NEW' },
      changedFields: new Set(['QuadratName', 'StemTag']),
      oldRow: { TreeID: 10 /* kept */ }
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      subject: 'quadrat', reason: 'missing', field: 'QuadratName'
    }));
  });

  it('emits inactive stem conflict', async () => {
    vi.spyOn(resolvers, 'planQuadratResolution').mockResolvedValue({ quadratID: 77 });
    vi.spyOn(resolvers, 'planStemResolution').mockResolvedValue({
      existingStemGUID: null, wouldCreate: false,
      sourceStemGUID: 100, sourceStemRemainingMeasurements: 0,
      conflictReason: 'matching stem is inactive'
    });
    const ctx = buildCtx({
      newRow: { StemTag: 'NEW', QuadratName: 'Q1' },
      changedFields: new Set(['StemTag', 'QuadratName'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      subject: 'stem', reason: 'inactive', field: 'StemTag'
    }));
  });

  it('emits different_quadrat stem conflict', async () => {
    vi.spyOn(resolvers, 'planQuadratResolution').mockResolvedValue({ quadratID: 77 });
    vi.spyOn(resolvers, 'planStemResolution').mockResolvedValue({
      existingStemGUID: null, wouldCreate: false,
      sourceStemGUID: 100, sourceStemRemainingMeasurements: 0,
      conflictReason: 'stem exists in a different quadrat'
    });
    const ctx = buildCtx({
      newRow: { StemTag: 'ALT', QuadratName: 'Q2' },
      changedFields: new Set(['StemTag', 'QuadratName'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      subject: 'stem', reason: 'different_quadrat', field: 'QuadratName'
    }));
  });

  it('emits stem cannot_create when planner reports wouldCreate=false with no conflict', async () => {
    vi.spyOn(resolvers, 'planQuadratResolution').mockResolvedValue({ quadratID: 77 });
    vi.spyOn(resolvers, 'planStemResolution').mockResolvedValue({
      existingStemGUID: null, wouldCreate: false,
      sourceStemGUID: 100, sourceStemRemainingMeasurements: 0
    });
    const ctx = buildCtx({
      newRow: { StemTag: 'NEW', QuadratName: 'Q1' },
      changedFields: new Set(['StemTag', 'QuadratName'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toContainEqual(expect.objectContaining({
      subject: 'stem', reason: 'cannot_create', field: 'StemTag'
    }));
  });

  it('emits no errors when planner returns clean destination', async () => {
    vi.spyOn(resolvers, 'resolveSpeciesByCode').mockResolvedValue({ speciesID: 7 });
    vi.spyOn(resolvers, 'planTreeResolution').mockResolvedValue({
      existingTreeID: 20, wouldCreate: false,
      sourceTreeID: 10, sourceTreeRemainingStems: 3
    });
    const ctx = buildCtx({
      newRow: { SpeciesCode: 'ABC', TreeTag: 'NEW' },
      changedFields: new Set(['TreeTag', 'SpeciesCode'])
    });
    const { errors } = await applyTreeStemRules(ctx);
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run config/editplan/rules/treestem.test.ts`
Expected: FAIL (current `applyTreeStemRules` returns `Effect[]`, no `errors` property).

- [ ] **Step 3: Rewrite `treestem.ts`**

Change the function signature and emit errors alongside effects:

```ts
import { Effect, PreviewError, TreeStemResolutionPreviewError } from '../types';
import { RuleContext } from './context';
import {
  planTreeResolution, planStemResolution, planQuadratResolution, resolveSpeciesByCode,
  CONFLICT_REASON_INACTIVE_TREE, CONFLICT_REASON_INACTIVE_STEM, CONFLICT_REASON_DIFFERENT_QUADRAT
} from '../resolvers';

type TreeStemError = TreeStemResolutionPreviewError;

function buildError(
  subject: TreeStemError['subject'],
  reason: TreeStemError['reason'],
  field: TreeStemError['field'],
  message: string
): TreeStemError {
  return { kind: 'TreeStemResolution', subject, reason, field, message, severity: 'destructive', blocking: true };
}

export async function applyTreeStemRules(ctx: RuleContext): Promise<{ effects: Effect[]; errors: PreviewError[] }> {
  const effects: Effect[] = [];
  const errors: PreviewError[] = [];

  const treeIdentityChanged = ctx.changedFields.has('TreeTag') || ctx.changedFields.has('SpeciesCode');
  const stemIdentityChanged = ctx.changedFields.has('StemTag') || ctx.changedFields.has('QuadratName');

  let destinationTreeID: number | null = Number(ctx.oldRow.TreeID) || null;

  if (treeIdentityChanged) {
    const newCode = String(ctx.newRow.SpeciesCode ?? ctx.oldRow.SpeciesCode ?? '').trim();
    const { speciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);
    if (speciesID === null) {
      errors.push(buildError('species', 'missing', 'SpeciesCode', `Species code "${newCode}" not found in this schema`));
    } else {
      const planned = await planTreeResolution(ctx.cm, ctx.schema, {
        TreeTag: String(ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag),
        SpeciesID: speciesID,
        CensusID: ctx.censusID,
        currentTreeID: Number(ctx.oldRow.TreeID) || null
      }, ctx.transactionID);

      if (planned.conflictReason === CONFLICT_REASON_INACTIVE_TREE) {
        errors.push(buildError('tree', 'inactive', 'TreeTag', `Matching tree for TreeTag "${ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag}" exists but is inactive`));
      } else if (!planned.existingTreeID && !planned.wouldCreate) {
        errors.push(buildError('tree', 'cannot_create', 'TreeTag', `Cannot resolve or create tree for TreeTag "${ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag}"`));
      } else {
        destinationTreeID = planned.existingTreeID;
        const currentTreeID = Number(ctx.oldRow.TreeID);
        const movedAway = planned.sourceTreeID !== null && planned.sourceTreeID !== planned.existingTreeID;
        if (movedAway) {
          const destLabel = planned.existingTreeID
            ? `tree T#${planned.existingTreeID}`
            : planned.wouldCreate ? 'a new tree' : 'unresolved tree';
          const severity = planned.sourceTreeRemainingStems === 0 ? 'destructive' : 'warn';
          effects.push({
            id: 'R2',
            severity,
            category: 'identity',
            title: 'Measurement will be reassigned to a different tree',
            detail: `Moving from tree T#${currentTreeID} to ${destLabel}. Source tree will have ${planned.sourceTreeRemainingStems} active stem(s) after the move.`,
            affectedTable: 'trees',
            affectedRowCount: 1,
            references: { treeIDs: planned.existingTreeID ? [planned.existingTreeID, currentTreeID] : [currentTreeID] }
          });
        }
      }
    }
  }

  if (stemIdentityChanged && destinationTreeID !== null) {
    const { quadratID } = await planQuadratResolution(ctx.cm, ctx.schema, {
      QuadratName: String(ctx.newRow.QuadratName ?? ctx.oldRow.QuadratName),
      PlotID: ctx.plotID
    }, ctx.transactionID);

    if (quadratID === null) {
      errors.push(buildError('quadrat', 'missing', 'QuadratName', `Quadrat "${ctx.newRow.QuadratName ?? ctx.oldRow.QuadratName}" not found in this plot`));
    } else {
      const planned = await planStemResolution(ctx.cm, ctx.schema, {
        TreeID: destinationTreeID,
        CensusID: ctx.censusID,
        StemTag: String(ctx.newRow.StemTag ?? ctx.oldRow.StemTag),
        QuadratID: quadratID,
        currentStemGUID: Number(ctx.oldRow.StemGUID) || null
      }, ctx.transactionID);

      if (planned.conflictReason === CONFLICT_REASON_INACTIVE_STEM) {
        errors.push(buildError('stem', 'inactive', 'StemTag', `Matching stem for StemTag "${ctx.newRow.StemTag ?? ctx.oldRow.StemTag}" exists but is inactive for this census`));
      } else if (planned.conflictReason === CONFLICT_REASON_DIFFERENT_QUADRAT) {
        errors.push(buildError('stem', 'different_quadrat', 'QuadratName', `Matching stem exists in a different quadrat`));
      } else if (!planned.existingStemGUID && !planned.wouldCreate) {
        errors.push(buildError('stem', 'cannot_create', 'StemTag', `Cannot resolve or create stem for StemTag "${ctx.newRow.StemTag ?? ctx.oldRow.StemTag}"`));
      } else {
        const movedAway = planned.sourceStemGUID !== null && planned.sourceStemGUID !== planned.existingStemGUID;
        if (movedAway) {
          const severity = planned.sourceStemRemainingMeasurements === 0 ? 'destructive' : 'warn';
          const destinationStemLabel = planned.existingStemGUID
            ? `stem S#${planned.existingStemGUID}`
            : planned.wouldCreate ? 'a new stem' : 'unresolved stem';
          effects.push({
            id: 'R3',
            severity,
            category: 'identity',
            title: 'Measurement will be reassigned to a different stem',
            detail: `Moving from stem S#${planned.sourceStemGUID} to ${destinationStemLabel}. Source stem will have ${planned.sourceStemRemainingMeasurements} measurement(s) after the move.`,
            affectedTable: 'stems',
            affectedRowCount: 1,
            references: {
              stemGUIDs: planned.existingStemGUID ? [Number(planned.sourceStemGUID), Number(planned.existingStemGUID)] : [Number(planned.sourceStemGUID)]
            }
          });
        }
      }
    }
  }

  return { effects, errors };
}
```

- [ ] **Step 4: Update `analyzer.ts` to collect rule errors**

Replace the rule-dispatch block inside `analyzeEdit` at lines 155-160:

```ts
if (dataType === 'measurementssummary' && errors.length === 0) {
  effects.push(...(await applySpeciesRules(ctx)));
  const treeStem = await applyTreeStemRules(ctx);
  effects.push(...treeStem.effects);
  errors.push(...treeStem.errors);
  effects.push(...(await applyCoordinateRules(ctx)));
  effects.push(...(await applyAttributeRules(ctx)));
}
```

Update the `canApply` computation:

```ts
canApply: errors.length === 0,
```

(Existing line — already derives from `errors.length`; no change if already correct. Verify.)

- [ ] **Step 5: Run all tests**

Run: `cd frontend && npx vitest run config/editplan/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/config/editplan/rules/treestem.ts frontend/config/editplan/rules/treestem.test.ts frontend/config/editplan/analyzer.ts
git commit -m "Surface treestem planner conflicts as blocking preview errors"
```

---

## Task 9: maxSeverity considers errors

**Goal:** Plan `maxSeverity` reflects blocking errors even when no destructive `Effect` is present.

**Files:**
- Modify: `frontend/config/editplan/analyzer.ts`
- Modify: `frontend/config/editplan/bulkanalyzer.ts`
- Modify: `frontend/config/editplan/analyzer.test.ts`

**Acceptance Criteria:**
- [ ] `EditPlan.maxSeverity === 'destructive'` when `plan.errors` contains any blocking error, regardless of effects.
- [ ] `BulkEditPlan.maxSeverity === 'destructive'` when any rowPlan carries blocking errors or aggregate errors exist.
- [ ] Plans with no errors still compute `maxSeverity` from effects (existing behavior preserved).

**Verify:** `cd frontend && npx vitest run config/editplan/analyzer.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Add to `analyzer.test.ts`:

```ts
it('computes destructive maxSeverity when only blocking errors are present', async () => {
  const plan = await /* build a plan that returns a TreeStemResolution error, no effects */ ;
  expect(plan.errors.length).toBeGreaterThan(0);
  expect(plan.effects).toEqual([]);
  expect(plan.maxSeverity).toBe('destructive');
});
```

Add to `bulkanalyzer.test.ts` (create if absent):

```ts
it('bulk plan maxSeverity is destructive when row plan carries blocking errors only', async () => {
  // build a bulkInput whose single matched row has a treestem error and no effects
  const plan = await analyzeBulk(/* ... */);
  expect(plan.maxSeverity).toBe('destructive');
});
```

- [ ] **Step 2: Update `analyzer.ts` reducer**

Replace the `maxSeverity` computation around line 162:

```ts
const effectSeverity = effects.reduce<Severity>(
  (max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max),
  'info'
);
const errorSeverity = errors.reduce<Severity>(
  (max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max),
  'info'
);
const maxSeverity: Severity = SEVERITY_RANK[errorSeverity] > SEVERITY_RANK[effectSeverity] ? errorSeverity : effectSeverity;
```

- [ ] **Step 3: Update `bulkanalyzer.ts` reducer**

After computing `aggregateEffects`, extend the `maxSeverity` reduction with the plan's `errors` array (already collected into `errors` local variable):

```ts
const effectSeverity = aggregateEffects.reduce<Severity>(
  (max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max),
  'info'
);
const errorSeverity = errors.reduce<Severity>(
  (max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max),
  'info'
);
const maxSeverity: Severity = SEVERITY_RANK[errorSeverity] > SEVERITY_RANK[effectSeverity] ? errorSeverity : effectSeverity;
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run config/editplan/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/config/editplan/analyzer.ts frontend/config/editplan/bulkanalyzer.ts frontend/config/editplan/analyzer.test.ts
git commit -m "Include blocking errors in plan maxSeverity computation"
```

---

## Task 10: Split assertEditPlanCanApply and assertBulkPlanCanApply

**Goal:** Role errors and non-role blocking errors throw distinct error classes, so non-role blockers no longer masquerade as `RoleForbiddenFieldError`.

**Files:**
- Modify: `frontend/config/editplan/analyzer.ts`
- Modify: `frontend/config/editplan/bulkanalyzer.ts`
- Modify: `frontend/config/editplan/analyzer.test.ts`

**Acceptance Criteria:**
- [ ] `assertEditPlanCanApply`: plan with only role errors → throws `RoleForbiddenFieldError`. Plan with only treestem errors → throws `EditPlanUnapplicableError` carrying those blocking errors. Plan with both → throws `RoleForbiddenFieldError` (role check runs first).
- [ ] `assertBulkPlanCanApply`: same split, throws `BulkPlanUnapplicableError` for non-role cases.
- [ ] No call site still relies on the old "any canApply=false throws RoleForbiddenFieldError" behavior.

**Verify:** `cd frontend && npx vitest run config/editplan/` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests**

Add to `analyzer.test.ts`:

```ts
import { assertEditPlanCanApply, EditPlanUnapplicableError, RoleForbiddenFieldError } from './analyzer';

it('throws RoleForbiddenFieldError when only role errors are present', () => {
  const plan = { /* with kind: 'RoleForbiddenField' */ } as any;
  expect(() => assertEditPlanCanApply(plan)).toThrow(RoleForbiddenFieldError);
});

it('throws EditPlanUnapplicableError when only treestem errors are present', () => {
  const plan = { /* canApply: false, errors: [treestem error] */ } as any;
  expect(() => assertEditPlanCanApply(plan)).toThrow(EditPlanUnapplicableError);
});

it('prefers RoleForbiddenFieldError when both error kinds are present', () => {
  const plan = { /* both */ } as any;
  expect(() => assertEditPlanCanApply(plan)).toThrow(RoleForbiddenFieldError);
});
```

Same for `assertBulkPlanCanApply` in `bulkanalyzer.test.ts`.

- [ ] **Step 2: Update `analyzer.ts::assertEditPlanCanApply`**

```ts
export function assertEditPlanCanApply(plan: EditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(
    (e): e is RoleForbiddenFieldPreviewError => e.kind === 'RoleForbiddenField' && e.blocking
  );
  if (roleErrors.length > 0) {
    throw new RoleForbiddenFieldError(roleErrors.map(e => e.field), roleErrors[0].role);
  }
  if (plan.canApply === false) {
    throw new EditPlanUnapplicableError((plan.errors ?? []).filter(e => e.blocking));
  }
}
```

- [ ] **Step 3: Update `bulkanalyzer.ts::assertBulkPlanCanApply`**

```ts
export function assertBulkPlanCanApply(plan: BulkEditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(
    (e): e is RoleForbiddenFieldPreviewError => e.kind === 'RoleForbiddenField' && e.blocking
  );
  if (roleErrors.length > 0) {
    throw new RoleForbiddenFieldError(roleErrors.map(e => e.field), roleErrors[0].role);
  }
  if (plan.canApply === false) {
    throw new BulkPlanUnapplicableError((plan.errors ?? []).filter(e => e.blocking));
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run config/editplan/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/config/editplan/analyzer.ts frontend/config/editplan/bulkanalyzer.ts frontend/config/editplan/analyzer.test.ts
git commit -m "Split assertPlanCanApply to distinguish role from preview blockers"
```

---

## Task 11: Typed mutating-resolver errors

**Goal:** `writers/resolvers-mutating.ts` throws `MeasurementResolutionError` instead of untyped `Error`.

**Files:**
- Modify: `frontend/config/editplan/writers/resolvers-mutating.ts`
- Modify: `frontend/config/editplan/writers/resolvers-mutating.test.ts` (create if absent).

**Acceptance Criteria:**
- [ ] All seven `throw new Error(...)` sites in `resolvers-mutating.ts` throw `MeasurementResolutionError` with the correct `(subject, reason)` tuple and a descriptive message.
- [ ] Existing writer tests that expect `Error` messages are updated to assert on `instanceof MeasurementResolutionError` plus the `subject`/`reason` fields.

**Verify:** `cd frontend && npx vitest run config/editplan/writers/` → PASS.

**Steps:**

- [ ] **Step 1: Replace the throws**

In `resolvers-mutating.ts`, convert each throw (the 7 locations identified in the spec). Example:

```ts
// Before:
if (!TreeTag) throw new Error('TreeTag not found for tree resolution');
// After:
if (!TreeTag) throw new MeasurementResolutionError('tree', 'missing', 'TreeTag not found for tree resolution');
```

Full map:
- `!plotID` → `('quadrat', 'missing', 'Plot not found for quadrat lookup')`
- `!quadratName` → `('quadrat', 'missing', 'Quadrat not found for stem resolution')`
- `quadratSearchResults.length === 0` → `('quadrat', 'missing', 'Quadrat not found')`
- `!TreeTag` → `('tree', 'missing', 'TreeTag not found for tree resolution')`
- `normalizedSpeciesID === null` → `('species', 'missing', 'Species not found for tree resolution')`
- `!matchingTree.IsActive` → `('tree', 'inactive', ...current message...)`
- `!StemTag` → `('stem', 'missing', 'StemTag not found for stem resolution')`
- `normalizedQuadratID === null` → `('quadrat', 'missing', 'Quadrat not found for stem resolution')`
- `matchingTreeID exists but inactive` → `('stem', 'inactive', ...)`
- `matchingTreeID exists but different quadrat` → `('stem', 'different_quadrat', ...)`

(Use the existing messages verbatim — only the class changes.)

- [ ] **Step 2: Update writer tests**

Any test asserting `toThrow('TreeTag not found...')` or similar should either keep the string match (still valid — `MeasurementResolutionError` extends `Error`) or be tightened to assert on the class and tuple:

```ts
await expect(resolveMeasurementSummaryTree(...)).rejects.toBeInstanceOf(MeasurementResolutionError);
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run config/editplan/writers/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/config/editplan/writers/resolvers-mutating.ts frontend/config/editplan/writers/resolvers-mutating.test.ts
git commit -m "Replace ad-hoc Error throws with typed MeasurementResolutionError"
```

---

## Task 12: Apply-route 422 mappings

**Goal:** `/api/revisionupload/apply` and `/api/edits/apply` map the new error classes to 422 responses with structured payloads.

**Files:**
- Modify: `frontend/app/api/revisionupload/apply/route.ts`
- Modify: `frontend/app/api/edits/apply/route.ts`
- Modify: `frontend/app/api/revisionupload/apply/route.test.ts`
- Modify: `frontend/app/api/edits/apply/route.test.ts`

**Acceptance Criteria:**
- [ ] Bulk apply catch block maps `BulkPlanUnapplicableError` → 422 `{ error: 'plan not applicable', blockingErrors }`.
- [ ] Bulk apply catch block maps `MeasurementResolutionError` → 422 `{ error: message, subject, reason }`.
- [ ] Single-row apply catch block maps `EditPlanUnapplicableError` and `MeasurementResolutionError` → 422 with same shape as above.
- [ ] Existing 403 (`RoleForbiddenFieldError`) and 409 (`RevisionApplyConflictError`, `RevisionApplyPlanHashMismatchError`) mappings unchanged.
- [ ] Unit tests assert the 422 status code and payload shape for each new case.

**Verify:** `cd frontend && npx vitest run app/api/revisionupload/apply/route.test.ts app/api/edits/apply/route.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Extend bulk apply catch block**

In `frontend/app/api/revisionupload/apply/route.ts` around line 1025-1046, add before the final `status` computation:

```ts
import { MeasurementResolutionError } from '@/config/editplan/writers/resolvers-mutating';
import { BulkPlanUnapplicableError } from '@/config/editplan/bulkanalyzer';

// inside the catch:
if (errorObj instanceof BulkPlanUnapplicableError) {
  return NextResponse.json(
    { error: 'plan not applicable', blockingErrors: errorObj.blockingErrors },
    { status: HTTPResponses.UNPROCESSABLE_ENTITY }
  );
}
if (errorObj instanceof MeasurementResolutionError) {
  return NextResponse.json(
    { error: errorObj.message, subject: errorObj.subject, reason: errorObj.reason },
    { status: HTTPResponses.UNPROCESSABLE_ENTITY }
  );
}
```

(`HTTPResponses.UNPROCESSABLE_ENTITY = 422` already exists in `frontend/config/macros.ts`.)

- [ ] **Step 2: Extend single-row apply catch block**

Same structure in `frontend/app/api/edits/apply/route.ts`:

```ts
if (errorObj instanceof EditPlanUnapplicableError) { ... 422 ... }
if (errorObj instanceof MeasurementResolutionError) { ... 422 ... }
```

- [ ] **Step 3: Write/extend unit tests**

`apply/route.test.ts`:

```ts
it('returns 422 when analyzeBulk reports non-role blocking errors', async () => {
  // arrange: mock analyzeBulk to throw BulkPlanUnapplicableError
  const response = await applyHandler(...);
  expect(response.status).toBe(422);
  const body = await response.json();
  expect(body.error).toBe('plan not applicable');
  expect(body.blockingErrors).toBeInstanceOf(Array);
});

it('returns 422 when a mutating resolver throws MeasurementResolutionError mid-transaction', async () => {
  // arrange: stub resolveMeasurementSummaryStem to throw MeasurementResolutionError
  const response = await applyHandler(...);
  expect(response.status).toBe(422);
  const body = await response.json();
  expect(body.subject).toBe('stem');
  expect(body.reason).toBe('inactive');
});
```

Mirror in `edits/apply/route.test.ts` for `EditPlanUnapplicableError`.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run app/api/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/revisionupload/apply/route.ts frontend/app/api/edits/apply/route.ts frontend/app/api/revisionupload/apply/route.test.ts frontend/app/api/edits/apply/route.test.ts
git commit -m "Map typed editplan errors to 422 responses in apply routes"
```

---

## Task 13: P2 integration test — unresolvable species and race-case

**Goal:** Integration coverage that the match endpoint returns `canApply: false` with a `TreeStemResolution` error for unresolvable species, and that a race-case (target tree deactivated between match and apply) surfaces as 422.

**Files:**
- Modify: `frontend/tests/integration/editplan-integrity.integration.test.ts`

**Acceptance Criteria:**
- [ ] New test: match endpoint with CSV whose `spcode` is not in `species` → response body has `canApply: false` and contains an error with `{subject: 'species', reason: 'missing'}`.
- [ ] New test: match endpoint clean, test harness deactivates the target tree, apply endpoint → 422 with `{subject: 'tree', reason: 'inactive'}` (or equivalent tuple).
- [ ] Both tests share the integration setup/teardown pattern from Task 6.

**Verify:** `cd frontend && npm run test:integration -- tests/integration/editplan-integrity.integration.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Add the unresolvable-species test**

```ts
it('match endpoint blocks when species code is unresolvable', async () => {
  const matchResponse = await matchHandler(buildMatchRequest({
    rows: [{ /* matched-row CSV with spcode: 'ZZZZ-NOT-IN-DB', changes SpeciesCode */ }]
  }));
  expect(matchResponse.status).toBe(200);
  const body = await matchResponse.json();
  expect(body.bulkPlan.canApply).toBe(false);
  expect(body.bulkPlan.errors).toContainEqual(expect.objectContaining({
    kind: 'TreeStemResolution', subject: 'species', reason: 'missing'
  }));
});
```

- [ ] **Step 2: Add the race-case test**

```ts
it('apply returns 422 when target tree is deactivated after match', async () => {
  // 1. Match (clean)
  const matchResponse = await matchHandler(...);
  const matchBody = await matchResponse.json();
  expect(matchBody.bulkPlan.canApply).toBe(true);

  // 2. Deactivate the target tree directly via the test DB helper
  await deactivateTreeInTestDB({ schema, treeID: TARGET_TREE_ID });

  // 3. Apply - resolver will fail mid-transaction
  const applyResponse = await applyHandler(buildApplyRequest(matchBody, matchBody.bulkPlanHash));
  expect(applyResponse.status).toBe(422);
  const body = await applyResponse.json();
  expect(body.subject).toBe('tree');
  expect(body.reason).toBe('inactive');
});
```

Extend `frontend/tests/setup/local-db-setup.ts` with a `deactivateTreeInTestDB` helper if one does not exist.

- [ ] **Step 3: Run tests**

Run: `cd frontend && npm run test:integration -- tests/integration/editplan-integrity.integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/integration/editplan-integrity.integration.test.ts frontend/tests/setup/local-db-setup.ts
git commit -m "Add P2 integration coverage for preview blocker and resolver race"
```

---

## Task 14: P3 effective() helper for clearable fields

**Goal:** The `coremeasurements` sync block in `writers/measurementssummary.ts` preserves explicit clears for `Description`, `Attributes`, `MeasuredDBH`, `MeasuredHOM`, `StemLocalX`, `StemLocalY`; revalidation receives the cleared state.

**Files:**
- Modify: `frontend/config/editplan/writers/measurementssummary.ts`
- Modify: `frontend/tests/integration/editplan-writer-measurementssummary.integration.test.ts`

**Acceptance Criteria:**
- [ ] `effective(field)` helper returns `merged[field]` when `changedFields.has(field)`, else `current[field]`.
- [ ] UPDATE statement writes `NULL` for `Description`, `RawCodes`, `RawComments`, `MeasuredDBH`, `MeasuredHOM`, `RawX`, `RawY` when the user explicitly cleared them.
- [ ] `refreshIngestionErrorsForMeasurement` call receives `null` values for cleared fields (not stale current values).
- [ ] Identity fields (`RawTreeTag`, `RawStemTag`, `RawSpCode`, `RawQuadrat`) keep the `??` fallback.
- [ ] Integration tests cover each clearable field against real DB.

**Verify:** `cd frontend && npm run test:integration -- tests/integration/editplan-writer-measurementssummary.integration.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing integration tests**

Add to `frontend/tests/integration/editplan-writer-measurementssummary.integration.test.ts` (follow the neighboring test cases in the file for setup/teardown shape). Each test seeds a row with a non-null current value, applies an edit that clears the field, and asserts the DB state after:

```ts
it('persists explicit Description clear as NULL', async () => {
  const { coreMeasurementID } = await seedMeasurementWithDescription({ description: 'existing note' });
  await runEditPlanApply({
    fieldChanges: [{ field: 'Description', from: 'existing note', to: null }]
  });
  const row = await fetchCoremeasurement(coreMeasurementID);
  expect(row.Description).toBeNull();
  expect(row.RawComments).toBeNull();
});

it('persists explicit Attributes clear as NULL + drops cmattributes', async () => {
  // similar — seed RawCodes='A;B' + two cmattributes rows, clear Attributes, assert RawCodes IS NULL and cmattributes COUNT=0
});

it('persists explicit MeasuredDBH clear as NULL', async () => { ... });
it('persists explicit StemLocalX clear as NULL', async () => { ... });
it('passes cleared Description to revalidation (Comments=null in refresh payload)', async () => { ... });
it('leaves current Description intact when the field is not changed', async () => { ... });
```

- [ ] **Step 2: Implement `effective()` helper**

In `measurementssummary.ts`, inside the writer function before the `shouldSyncRaw` block:

```ts
const effective = <K extends keyof LoadedCoreMeasurementRow>(field: K): LoadedCoreMeasurementRow[K] =>
  (changedFields.has(field as string) ? (merged as LoadedCoreMeasurementRow)[field] : (current as LoadedCoreMeasurementRow)[field]);
```

- [ ] **Step 3: Update the UPDATE payload (lines ~512-523)**

```ts
const updatePayload = {
  RawTreeTag: merged.TreeTag ?? current.TreeTag ?? null,
  RawStemTag: merged.StemTag ?? current.StemTag ?? null,
  RawSpCode: merged.SpeciesCode ?? current.SpeciesCode ?? null,
  RawQuadrat: merged.QuadratName ?? current.QuadratName ?? null,
  RawX: toOptionalNumber(effective('StemLocalX')),
  RawY: toOptionalNumber(effective('StemLocalY')),
  RawCodes: effective('Attributes') ?? null,
  RawComments: effective('Description') ?? null,
  Description: effective('Description') ?? null,
  MeasurementDate: normalizedMeasurementDate,
  MeasuredDBH: toOptionalNumber(effective('MeasuredDBH')),
  MeasuredHOM: toOptionalNumber(effective('MeasuredHOM'))
};
```

- [ ] **Step 4: Update the `refreshIngestionErrorsForMeasurement` payload (lines ~542-554)**

```ts
{
  Tag: merged.TreeTag ?? current.TreeTag ?? null,
  StemTag: merged.StemTag ?? current.StemTag ?? null,
  SpCode: merged.SpeciesCode ?? current.SpeciesCode ?? null,
  Quadrat: merged.QuadratName ?? current.QuadratName ?? null,
  X: toOptionalNumber(effective('StemLocalX')),
  Y: toOptionalNumber(effective('StemLocalY')),
  DBH: toOptionalNumber(effective('MeasuredDBH')),
  HOM: toOptionalNumber(effective('MeasuredHOM')),
  Date: normalizedMeasurementDate,
  Codes: effective('Attributes') ?? null,
  Comments: effective('Description') ?? null
}
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npm run test:integration -- tests/integration/editplan-writer-measurementssummary.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/config/editplan/writers/measurementssummary.ts frontend/tests/integration/editplan-writer-measurementssummary.integration.test.ts
git commit -m "Persist explicit clears of nullable measurement fields"
```

---

## Task 15: Final verification

**Goal:** Entire suite green, production build succeeds.

**Files:** None (verification only).

**Acceptance Criteria:**
- [ ] `npm run test:unit` passes.
- [ ] `npm run test:integration` passes (local Docker MySQL running).
- [ ] `npm run build` succeeds.
- [ ] `npm run lint` clean.

**Verify:** See steps below.

**Steps:**

- [ ] **Step 1: Run the full test matrix**

```bash
cd frontend
docker compose -f ../docker-compose.yml up -d mysql
npm run test:unit
npm run test:integration
npm run lint
npm run build
```

- [ ] **Step 2: Address any remaining failures**

Fix issues in-place — no new tasks required unless a genuinely new change emerges. If a fix spans multiple files, make a single focused commit per conceptual change.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -- <specific files>
git commit -m "Final fixes for editplan integrity batch"
```

- [ ] **Step 4: Summary check**

Confirm that:
- `frontend/config/editplan/canonicalrow.ts` exists and is used in both match and apply routes.
- `buildCanonicalNewRow` and `buildAnalyzerNewRow` are gone.
- `TreeStemResolutionPreviewError` is surfaced from `treestem.ts` and consumed by analyzer + bulk analyzer.
- Apply routes map `BulkPlanUnapplicableError` / `EditPlanUnapplicableError` / `MeasurementResolutionError` to 422.
- `writers/measurementssummary.ts` uses `changedFields.has()` gates for clearable fields.
