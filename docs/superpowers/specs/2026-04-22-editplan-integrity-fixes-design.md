# Editplan Integrity Fixes — Design

Date: 2026-04-22
Branch: `feat/editing-feedback`
Status: Approved

## Overview

Three independent integrity fixes in the shared editplan layer used by revision
upload (bulk) and single-row editing (measurement PATCH, failed-measurements
explorer). All three surfaced in a single code review pass:

1. **P1 — Bulk plan hash completeness.** The plan hash returned by
   `/api/revisionupload` does not attest to new-row payloads or to specific
   duplicate survivor/deletion pairs, so a client can tamper with reviewed
   content between match and apply without forcing a drift-detection 409.
2. **P2 — Preview/apply parity.** The `treestem` rule silently skips unresolved
   species/quadrat identity and ignores planner `conflictReason`, so previews
   claim `canApply: true` for edits the mutating resolvers will refuse. The
   resolvers throw untyped `Error`s that fall through to 500.
3. **P3 — Clearable field writes.** The `coremeasurements` sync block uses
   `merged.X ?? current.X ?? null`, so a user-approved clear of any nullable
   field falls back to the stale value and is passed to revalidation as well.

Scope is the `measurementssummary` writer path and the editplan apply
endpoints. No DB migrations; API contract changes are additive (new plan
fields, new 422 response shape). Client payloads for apply are unchanged.

## P1 — Bulk plan hash completeness

### Goal

Every field a client can tamper with between match and apply must be hashed
into `bulkPlanHash`, so the apply-side `analyzeBulk` rerun + hash-compare
(already in place at `app/api/revisionupload/apply/route.ts:873`) catches
tampering as plan drift → 409.

### Type changes

`config/editplan/types.ts`:

```ts
interface RowPlan {
  rowIndex: number;
  targetID?: number;
  plan?: EditPlan;
  status: 'matched' | 'new' | 'invalid' | 'unchanged';
  reason?: string;
  canonicalNewRow?: Record<string, unknown>; // NEW: populated when status === 'new'
}

interface DuplicateDeletion {
  coreMeasurementID: number;
  survivorCoreMeasurementID: number;
}

interface BulkEditPlan {
  // existing fields...
  duplicateDeletions: DuplicateDeletion[]; // NEW; always present (empty array when none)
}
```

`BulkInput` in `config/editplan/bulkanalyzer.ts` takes structured duplicates:

```ts
interface BulkInput {
  matched: Array<{ rowIndex: number; targetID: number; newRow: Record<string, unknown> }>;
  newRows: Array<{ rowIndex: number; newRow: Record<string, unknown> }>;
  invalid: Array<{ rowIndex: number; reason: string }>;
  duplicateMeasurementIDsToDelete: DuplicateDeletion[]; // CHANGED: was number[]
}
```

Callers (`app/api/revisionupload/route.ts`, `app/api/revisionupload/apply/route.ts`)
rebuild `BulkInput` with pair shape. The match route already has survivor
information in its `resolvedRows`; the apply route pairs via
`buildDuplicateDeletionHints`.

### Canonicalizer — shared module with two modes

New file `config/editplan/canonicalrow.ts`. Replaces the ad-hoc
`buildCanonicalNewRow` in `apply/route.ts`, which today conflates matched
updates and new inserts.

```ts
type RowMode = 'revision-update' | 'revision-insert';

const REVISION_UPDATE_FIELDS = [
  'MeasuredDBH', 'MeasuredHOM', 'MeasurementDate', 'Attributes', 'Description'
];
const REVISION_INSERT_FIELDS = [
  ...REVISION_UPDATE_FIELDS,
  'TreeTag', 'StemTag', 'SpeciesCode', 'QuadratName', 'StemLocalX', 'StemLocalY'
];

export function canonicalizeRowForHash(
  row: Record<string, unknown>,
  mode: RowMode
): Record<string, unknown>;
```

- Matched updates use `revision-update` (only fields actually written by
  matched-row apply). Feeding identity fields into `analyzeEdit` today would
  surface phantom effects for changes the update path does not write.
- New inserts use `revision-insert` (full insert surface for
  `canonicalNewRow`).
- Normalization per existing `fieldpolicy.ts` rules: string trim, SpeciesCode
  case, date string → ISO `yyyy-mm-dd`, decimals via
  `PER_COLUMN_DECIMAL_PRECISION`, null-and-empty-string collapse to `null`.
- Strict whitelist — keys outside the mode's list are dropped before hashing.
- Idempotent: `fn(fn(x)) === fn(x)`.

### Analyzer changes

`config/editplan/bulkanalyzer.ts`:

- Line 54: replace `{ rowIndex, status: 'new' }` with
  `{ rowIndex, status: 'new', canonicalNewRow: canonicalizeRowForHash(newRow.newRow, 'revision-insert') }`.
- Line 62: pass the full `DuplicateDeletion[]` to `applyDuplicateRules`; the
  rule sums `.length` internally. No visible effect change.
- After the rowPlans loop, attach sorted duplicate pairs to the plan:

  ```ts
  plan.duplicateDeletions = [...input.duplicateMeasurementIDsToDelete].sort((a, b) =>
    a.coreMeasurementID - b.coreMeasurementID ||
    a.survivorCoreMeasurementID - b.survivorCoreMeasurementID
  );
  ```

  Sort by both fields. Do not dedupe — repeated pairs must hash differently
  than single pairs so duplicated-row tampering surfaces as drift.

### Hash changes

`config/editplan/planhash.ts::canonicalizePlan` for `BulkEditPlan` adds
`duplicateDeletions` (already sorted). `canonicalizeRowPlan` already runs
`sortKeys`, so `canonicalNewRow` is picked up automatically.

### Invariant

Match endpoint and apply endpoint both pipe csvRow through the same
`canonicalizeRowForHash` (with the correct mode) before `analyzeBulk`. Any
tampered field in a reviewed new row → different `canonicalNewRow` → different
plan hash → 409. Swapped duplicate survivor ID → different `duplicateDeletions`
→ different hash → 409.

### Tests

`canonicalrow.test.ts`:

- Alias expansion (Codes → Attributes, Comments → Description).
- Whitespace trim.
- Empty string → null.
- Date string → ISO `yyyy-mm-dd`.
- Decimal precision per `PER_COLUMN_DECIMAL_PRECISION`.
- Unlisted key drop (identity fields absent from `revision-update` output,
  present in `revision-insert` output).
- Idempotence.
- Mode isolation.

`planhash.test.ts`:

- New-row content drift — tag / stemtag / spcode / quadrat / dbh / hom / date
  / codes / comments each flipped one at a time produces a different hash.
- Duplicate pair swap drift — same count, different survivor ID → different
  hash.
- Duplicate pair order-insensitive — shuffled pairs → same hash.
- Repeated pair hashes differently than a single pair.

## P2 — Preview/apply parity

### Goal

Convert planner `conflictReason` and unresolvable-identity cases into blocking
`PreviewError`s so the match endpoint tells the truth (`canApply: false`).
Wrap the mutating resolver throws in a typed error the apply route maps to 422
as race-defense.

### PreviewError taxonomy

`config/editplan/types.ts`:

```ts
type PreviewError = RoleForbiddenFieldPreviewError | TreeStemResolutionPreviewError;

interface RoleForbiddenFieldPreviewError {
  // existing shape, renamed from the anonymous interface
  kind: 'RoleForbiddenField';
  field: string;
  role: UserAuthRoles | 'unknown';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}

interface TreeStemResolutionPreviewError {
  kind: 'TreeStemResolution';
  subject: 'species' | 'quadrat' | 'tree' | 'stem';
  reason: 'missing' | 'inactive' | 'different_quadrat' | 'cannot_create';
  field: 'SpeciesCode' | 'QuadratName' | 'TreeTag' | 'StemTag';
  message: string;
  severity: 'destructive';
  blocking: true;
  rowIndex?: number;
}
```

Union variant types renamed to `*PreviewError` to avoid collision with the
thrown `RoleForbiddenFieldError` class. Discriminant values (`kind:
'RoleForbiddenField' | 'TreeStemResolution'`) are unchanged.

`message` stays as a backend fallback; UI switches on `{subject, reason, field}`
for human copy. `suggestedFix` is not added — derive suggestions in the UI
from the tuple if/when a flow needs them.

### Rule return shape

Change `applyTreeStemRules` from `Promise<Effect[]>` to
`Promise<{ effects: Effect[]; errors: PreviewError[] }>`. `analyzer.ts`
collects both and populates the `EditPlan`. `bulkanalyzer.ts` already
aggregates `plan.errors` into bulk errors.

### Error emission points in `treestem.ts`

- `speciesID === null` when `SpeciesCode` changed → `{subject: 'species', reason: 'missing', field: 'SpeciesCode'}`.
- `planned.conflictReason === CONFLICT_REASON_INACTIVE_TREE` → `{subject: 'tree', reason: 'inactive', field: 'TreeTag'}`.
- Tree `wouldCreate === false && existingTreeID === null` with no `conflictReason` → `{subject: 'tree', reason: 'cannot_create', field: 'TreeTag'}`.
- `quadratID === null` when `QuadratName` changed → `{subject: 'quadrat', reason: 'missing', field: 'QuadratName'}`.
- `planned.conflictReason === CONFLICT_REASON_INACTIVE_STEM` → `{subject: 'stem', reason: 'inactive', field: 'StemTag'}`.
- `planned.conflictReason === CONFLICT_REASON_DIFFERENT_QUADRAT` → `{subject: 'stem', reason: 'different_quadrat', field: 'QuadratName'}`.
- Stem `wouldCreate === false && existingStemGUID === null` with no `conflictReason` → `{subject: 'stem', reason: 'cannot_create', field: 'StemTag'}`.

`cannot_create` is defensive — with current planners it is not reachable
(inactive and different-quadrat cases set `conflictReason`). Tests exercise
the branch via synthetic planner fixtures.

All blocking errors set `blocking: true, severity: 'destructive'`.

### maxSeverity fix

Current severity reducers in `analyzer.ts` and `bulkanalyzer.ts` only walk
`effects`. Errors with `severity: 'destructive'` don't lift `maxSeverity`, so
a plan with only blocking errors reports `maxSeverity: 'info'` while
`canApply: false`.

Fix: extend each reducer to also walk `plan.errors`. Blocking errors are
always destructive, so this promotes `maxSeverity` automatically without
polluting `aggregateEffects` with mirrored entries.

### `assertBulkPlanCanApply` and `assertEditPlanCanApply`

Both currently throw `RoleForbiddenFieldError` whenever `canApply === false`,
even when the cause is not a role error — latent bug that misroutes
non-role blockers to 403 with misleading shape. Split:

```ts
// bulkanalyzer.ts
export function assertBulkPlanCanApply(plan: BulkEditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(
    e => e.kind === 'RoleForbiddenField' && e.blocking
  );
  if (roleErrors.length > 0) {
    throw new RoleForbiddenFieldError(roleErrors.map(e => e.field), roleErrors[0].role);
  }
  if (plan.canApply === false) {
    throw new BulkPlanUnapplicableError(plan.errors?.filter(e => e.blocking) ?? []);
  }
}

// analyzer.ts — same split, single-row variant
export function assertEditPlanCanApply(plan: EditPlan): void {
  const roleErrors = (plan.errors ?? []).filter(
    e => e.kind === 'RoleForbiddenField' && e.blocking
  );
  if (roleErrors.length > 0) {
    throw new RoleForbiddenFieldError(roleErrors.map(e => e.field), roleErrors[0].role);
  }
  if (plan.canApply === false) {
    throw new EditPlanUnapplicableError(plan.errors?.filter(e => e.blocking) ?? []);
  }
}
```

Role errors checked first so role feedback retains its own status code.

### Mutating resolver typed errors

`config/editplan/writers/resolvers-mutating.ts`. Replace all seven
`throw new Error(...)` calls with:

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

Fires only as race-defense now (preview blocks the same cases), but still
reachable if DB state changes between match and apply.

### Apply route error mapping

`app/api/revisionupload/apply/route.ts` and `app/api/edits/apply/route.ts`
catch blocks:

- `RoleForbiddenFieldError` → 403 (existing).
- `BulkPlanUnapplicableError` / `EditPlanUnapplicableError` → 422 with
  `{ error: 'plan not applicable', blockingErrors }`.
- `MeasurementResolutionError` → 422 with `{ error: message, subject, reason }`.

### Tests

`treestem.test.ts`: each of the 7 error emission points produces the expected
`PreviewError`; `canApply === false`; matched-but-no-change rows do not emit
(errors only fire when the identity field is in `changedFields`).

`bulkanalyzer.test.ts`: plan with only `TreeStemResolution` errors throws
`BulkPlanUnapplicableError`; plan with role + treestem errors throws
`RoleForbiddenFieldError` (role check takes priority); `maxSeverity`
reflects errors when there are no destructive effects.

`analyzer.test.ts`: same split-error and maxSeverity cases for the single-row
variant.

Integration: race-case — preview clean, deactivate target tree between match
and apply → apply returns 422 with `MeasurementResolutionError` shape
(not 500). Client-side `canApply` bypass defense: submit `canApply=false`
plan → 422 with populated `blockingErrors`.

## P3 — Clearable field writes

### Goal

An explicit user-approved clear of a nullable field must persist as `NULL`
in `coremeasurements` and must propagate the cleared value to
`refreshIngestionErrorsForMeasurement`. Current `merged.X ?? current.X ??
null` fallback defeats both.

### Scope

`config/editplan/writers/measurementssummary.ts` lines 506-557.

### Fix — `effective()` helper

```ts
const effective = <K extends keyof LoadedCoreMeasurementRow>(field: K) =>
  changedFields.has(field as string) ? merged[field] : current[field];
```

Rewrite the UPDATE and `refreshIngestionErrorsForMeasurement` payloads using
`effective('Description')`, `effective('Attributes')`, etc. Intent stays
visible at each call site — "if the user touched this field, use the new
value (which may be null); otherwise keep current."

### Field-by-field classification

| Field | Classification | Fix |
|-------|----------------|-----|
| `RawTreeTag` (from `TreeTag`) | Identity, not clearable | Keep `??` fallback |
| `RawStemTag` (from `StemTag`) | Identity | Keep fallback |
| `RawSpCode` (from `SpeciesCode`) | Identity | Keep fallback |
| `RawQuadrat` (from `QuadratName`) | Identity | Keep fallback |
| `RawX` / `RawY` (from `StemLocalX`/`StemLocalY`) | Clearable | `effective()` gate |
| `RawCodes` (from `Attributes`) | Clearable | `effective()` gate |
| `RawComments` (from `Description`) | Clearable | `effective()` gate |
| `Description` | Clearable | `effective()` gate |
| `MeasurementDate` | Already uses `normalizedMeasurementDate` | No change |
| `MeasuredDBH` | Clearable (dead-tree case) | `effective()` gate |
| `MeasuredHOM` | Clearable | `effective()` gate |

Identity fields stay with the fallback because treestem rules reject identity
clears upstream — a null `merged.TreeTag` means the field was not changed,
so fallback is correct.

Same fix applied to `refreshIngestionErrorsForMeasurement` call (lines
542-554) so revalidation sees the cleared state, not stale values.

### Tests

Additions to `writers/measurementssummary.test.ts`:

- Explicit-null `Description` → `Description=NULL`, `RawComments=NULL` in DB.
- Explicit-null `Attributes` → `RawCodes=NULL` in DB and `cmattributes` rows
  deleted for the measurement.
- Explicit-null `MeasuredDBH` → `MeasuredDBH=NULL`.
- Explicit-null `StemLocalX` → `RawX=NULL`.
- Explicit-null `Description` causes
  `refreshIngestionErrorsForMeasurement` to receive `Comments: null`.
- Regression: omitting `Description` from the update leaves the current
  value intact.

## Cross-cutting

### Integration test

New file `tests/integration/editplan-integrity.integration.test.ts` covering
the full flow under real DB + scope lock:

- **P1**: tampered `newRows[0].csvRow.MeasuredDBH` → 409.
- **P1**: tampered `duplicateMeasurementIDsToDelete[0].coreMeasurementID`
  (swapped to a sibling same-stem measurement) → 409.
- **P2**: CSV with `SpeciesCode='ZZZZ'` (not in `species`) → plan has
  `TreeStemResolution` error with `{subject: 'species', reason: 'missing'}`
  and `canApply: false`; apply rejects with 422.
- **P2 race-case**: preview clean → deactivate target tree between match and
  apply → apply returns 422 with `MeasurementResolutionError` shape.
- **P3**: CSV clearing `Description` (explicit empty) → apply writes
  `Description=NULL`, `RawComments=NULL`; `refreshIngestionErrorsForMeasurement`
  receives cleared codes.

### Rollout

- No DB migrations.
- API contract changes are additive:
  - `BulkEditPlan` gains `duplicateDeletions` and `RowPlan.canonicalNewRow?`.
    Old clients reading the response continue to work.
  - Apply endpoints gain 422 response shapes:
    `{ error, blockingErrors }` (plan-unapplicable)
    or `{ error, subject, reason }` (mutating-resolver race).
    Existing error-handling UI that branches on 409/403/500 needs a 422 arm.
- Client payload for apply is unchanged. The server still accepts
  `newRows: csvRow[]` and
  `duplicateMeasurementIDsToDelete: {coreMeasurementID, survivorCoreMeasurementID}[]`.
- UI updates (scoped separately):
  - Preview dialog renders `TreeStemResolution` errors as blocking messages
    with tuple-derived copy.
  - Apply error toast handles the new 422 shapes.

### Out of scope

- Persisting plans server-side keyed by `bulkPlanHash` (P1 option C, rejected).
- Expanding editplan integrity work to other `dataType`s beyond
  `measurementssummary`. The `failedmeasurements` writer uses
  `pickCanonical` and already handles clears correctly.
- `suggestedFix` field on `TreeStemResolutionPreviewError`.
- Removing `assertEditPlanCanApply` as a concept — the fix normalizes it.
