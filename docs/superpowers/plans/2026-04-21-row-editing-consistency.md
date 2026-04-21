# Row Editing Consistency and Ramification Surfacing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared `config/editplan/` library with a strict planner/apply split, wire three new HTTP endpoints (`/api/edits/preview`, `/api/edits/apply`, `/api/edits/revert`) into the four existing measurement edit surfaces, add a synchronous `edit_operations` ledger to support single-row undo, and lock down editable-field semantics so researchers see every cross-row and identity-changing effect before committing.

**Architecture:** A pure-read analyzer produces `EditPlan` / `BulkEditPlan` objects that describe every downstream effect of a proposed edit. The public `applyEdit` wrapper owns the single-row lock/transaction, while the lower-level `applyEditInTransaction` primitive assumes the caller already owns the scope lock and transaction; revision upload uses that primitive so the whole matched-row batch remains atomic. Both paths re-run the analyzer, compare canonical hashes to detect drift, write mutations, and record synchronous ledger rows where undo is supported. Four existing client surfaces (measurement datagrid inline edit, Errors Explorer row edit, failed-measurements grid, revision-upload apply) all route through the same pair of endpoints and render from the same plan shape.

**Tech Stack:** Next.js 15 (app router, Node runtime), React 19 + MUI Joy, mysql2/promise, NextAuth (Azure AD), Vitest for unit/integration, Cypress for component.

**Spec:** `docs/superpowers/specs/2026-04-21-row-editing-consistency-design.md`.
**Related prior work:** `docs/superpowers/specs/2026-04-14-measurement-revision-upload-design.md` and `docs/superpowers/plans/2026-04-15-measurement-revision-upload.md`.
**Branch:** `feat/dual-upload-census`.

## Pre-implementation gap decisions

The spec and follow-up review called out the open items below. This plan resolves each:

1. **Revert source of truth** — new per-site `edit_operations` table (Task 0). Written synchronously inside the same transaction as apply. `unifiedchangelog` stays for audit; revert does not depend on it.
2. **Preview/apply separation** — Task 2 extracts read-only resolver twins into `frontend/config/editplan/resolvers.ts`. Task 8 moves the mutating resolvers into `frontend/config/editplan/writers/resolvers-mutating.ts`. The analyzer imports only the read-only file; writers are the only layer allowed to import the mutating module. CI lint rule (added in Task 8) forbids `editplan/analyzer.*` or `editplan/rules/*` from importing the mutating resolvers file.
3. **Bulk revision identity-field scope** — Phase 1 keeps bulk revision row-local. The existing `IGNORED_EDIT_FIELDS` (`spcode`, `quadrat`, `lx`, `ly`, `tag`, `stemtag`) continue to be surfaced as ignored edits. The `BulkEditPlan` consequently only ever contains R5 (attributes) and R6 (duplicate survivor) effects for the current surface; identity rules remain dormant on bulk until a future phase widens the writable field set.
4. **Locking semantics** — preview does NOT acquire the measurement scope lock (no read-lock exists yet; introducing one is out of scope). Preview still returns 423 if an upload session or validation run currently owns the scope (checked via existing upload-session/validation-run probes that revision apply already performs). Apply acquires the existing exclusive lock with timeout 0 (fail-fast) as it does today.
5. **Field allowlist** — enforced server-side in `rejectDisallowedFields` (Task 1). Grid surfaces additionally narrow `isCellEditable` for parity (Task 13).
6. **Post-validation response** — Phase 1 returns `validationPending: true` on every successful measurement edit apply; the existing background/whole-census validation flow picks the row up. `postValidation: { newErrors, clearedErrors }` is reserved in the response shape but only populated once sync-validation is added in a later phase.
7. **Apply primitive boundary** — `applyEdit` is the endpoint-facing single-row helper and always owns lock + transaction. `applyEditInTransaction` is the shared writer primitive for revision apply and compatibility shims when they already own a transaction. Revert owns lock/transaction separately and uses the full-ledger restore primitive. No batch path may call `applyEdit` in a loop.
8. **Revert scope** — Phase 1 single-row undo is allowed only for ledger entries whose full `beforeState`/`afterState` can be restored by the writer. Revert restores all recorded table rows (`coremeasurements`, `stems`, `trees`, `cmattributes`, validation rows, and derived rows captured by the writer), not only a `coremeasurements` diff. Bulk revision ledger rows are marked non-revertable in UI.
9. **Canonical field names** — every endpoint and hook canonicalizes incoming UI/API payload keys before allowlist, clear-policy, diff, hashing, and writer dispatch. The analyzer never compares raw camelCase grid rows or failed-measurement raw aliases directly to SQL result column names.
10. **Endpoint scope authorization** — all edit routes validate schema, user access to the requested plot/census, and target-row membership in that plot/census before analyzer or writer code runs.
11. **Preview conflict detection** — preview stays read-only and does not acquire the exclusive measurement lock, but it still calls the shared non-locking upload-session/validation-run conflict probe and returns 423 when the scope is busy.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `frontend/db-migrations/unified-measurements-migrations/54_create_edit_operations.sql` | Schema for per-site `edit_operations` table; indexes on `targetID`, `createdAt`, `revertedByEditOperationID`. |
| `frontend/config/editoperations.ts` | `ensureEditOperationsTable(connection, schema)` helper + row I/O helpers (write, read-by-id, mark-reverted). |
| `frontend/config/editplan/types.ts` | `Severity`, `SEVERITY_RANK`, `EffectCategory`, `Effect`, `EditPlanDataType`, `EditPlan`, `BulkEditPlan`, `RowPlan`, `ApplyResult` types shared by planner, apply, endpoints, UI. |
| `frontend/config/editplan/fieldpolicy.ts` | Editable-field allowlist per surface, raw-key-to-canonical-field mapping, clear/no-op policy per field group, normalizer used by both analyzer and apply before diffing/hashing. |
| `frontend/config/editplan/planhash.ts` | Canonical SHA-256 hasher: key sort, deterministic reference-array sort, effect sort, nested bulk-row plan normalization, date/decimal normalization, volatile-field strip. |
| `frontend/config/editplan/resolvers.ts` | Read-only twins of `resolveMeasurementSummaryTree` / `resolveMeasurementSummaryStem` / `resolveMeasurementSummaryQuadratID` / species lookup. Returns `existingID`, `destinationID`, `wouldCreateTree`, `wouldCreateStem`, orphan counts — no inserts. |
| `frontend/config/editplan/analyzer.ts` | Single-row analyzer: runs field-diff and each rule, assembles `EditPlan`. |
| `frontend/config/editplan/scopeguard.ts` | Shared endpoint guards for schema/plot/census authorization, target ownership, and non-locking upload-session/validation-run conflict probes. |
| `frontend/config/editplan/rules/` | One file per rule group: `species.ts` (R1a/R1c), `treestem.ts` (R2/R3), `coordinates.ts` (R4), `attributes.ts` (R5), `duplicates.ts` (R6/R9). Each exports a `(ctx) => Effect[]` function. |
| `frontend/config/editplan/bulkanalyzer.ts` | Wraps single-row analyzer to produce `BulkEditPlan` (per-row plans + aggregated effects + invalid-row entries). |
| `frontend/config/editplan/apply.ts` | Apply helpers — `applyEdit` owns the single-row lock/transaction; `applyEditInTransaction` re-runs analyzer, hash-checks, dispatches to dataType-specific writer, and writes ledger rows inside an existing transaction. |
| `frontend/config/editplan/writers/measurementssummary.ts` | Measurement-row mutations: species re-link, tree/stem resolution (the mutating versions), stem coord update, cmattributes rebuild, coremeasurements update, raw-column sync, validation reset, materialized-view refresh. |
| `frontend/config/editplan/writers/failedmeasurements.ts` | Raw-column sync on coremeasurements where `StemGUID IS NULL`, plus `refreshIngestionErrorsForMeasurement` call. |
| `frontend/config/editplan/revert.ts` | Looks up an `edit_operations` row, builds a full-ledger restore operation from all `beforeState` rows, runs the restore inside one locked transaction, and links the original/revert ledger rows. |
| `frontend/app/api/edits/preview/route.ts` | `POST /api/edits/preview` endpoint — zod body, schema/plot/census access, target ownership check, non-locking conflict probe, no-writes analyzer call. |
| `frontend/app/api/edits/apply/route.ts` | `POST /api/edits/apply` endpoint — zod body, hash-checked apply. |
| `frontend/app/api/edits/revert/route.ts` | `POST /api/edits/revert` endpoint — loads ledger, builds restore plan, apply. |
| `frontend/components/editplan/previewdialog.tsx` | Shared preview dialog component: field-diff table + effects list grouped by severity + action bar. |
| `frontend/components/editplan/impactsummary.tsx` | Bulk-impact summary panel used in `REVISION_MATCH` screen. |
| `frontend/components/editplan/editeffectrow.tsx` | Single effect row renderer with severity label, drill-down link, optional side panel. |
| `frontend/components/editplan/undotoast.tsx` | Success toast with "Undo" button (12s window). |
| `frontend/hooks/useEditPreviewFlow.ts` | Client hook that wraps the preview → dialog → apply handshake (used by grid surfaces). |

### Modified files

| Path | Change |
|---|---|
| `frontend/config/macros/coreapifunctions.ts` | Remove `measurementssummary` and `failedmeasurements` branches from `PATCH` (lines 301–705). Keep non-measurement dataTypes intact. Remove the SpeciesName/SubspeciesName UPDATE branch entirely. |
| `frontend/app/api/fixeddata/[dataType]/[[...slugs]]/route.ts` | For `dataType === 'measurementssummary'` or `'failedmeasurements'`, forward to an internal apply helper with preview-bypass (compatibility shim only; no public `bypassPreview` request flag). |
| `frontend/app/api/revisionupload/route.ts` | Match endpoint: call `bulkanalyzer.ts`; return `BulkEditPlan` alongside existing response fields. |
| `frontend/app/api/revisionupload/apply/route.ts` | Apply endpoint: switch matched-row writes from in-file UPDATE loop to `apply.ts`; keep new-row routing through `bulkingestionprocess` unchanged. |
| `frontend/components/datagrids/measurementscommons.tsx` | Replace direct PATCH-on-Save with `useEditPreviewFlow` hook. Narrow `isCellEditable` / column defs so `SpeciesName`, `SubspeciesName`, and internal IDs are read-only. |
| `frontend/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid.tsx` | Same treatment: use `useEditPreviewFlow` with `dataType: 'failedmeasurements'`. |
| `frontend/components/errors/errorsexplorer.tsx` | Replace custom in-file PATCH flow (line ~497) with shared `previewdialog.tsx` + `useEditPreviewFlow`. |
| `frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx` | Render `impactsummary.tsx` above the existing matched-row table. Feed it the `BulkEditPlan` from the match response. |
| `frontend/components/uploadsystem/segments/uploadrevisionapply.tsx` | Gate apply button behind typed `APPLY {N}` input when bulk `maxSeverity === 'destructive'`. |

---

### Task 0: Create `edit_operations` table migration

**Goal:** One new per-site table plus an ensure-helper pattern matching `ensureUploadSessionsTable`.

**Files:**
- Create: `frontend/db-migrations/unified-measurements-migrations/54_create_edit_operations.sql`
- Create: `frontend/config/editoperations.ts`
- Create: `frontend/config/editoperations.test.ts`

**Acceptance Criteria:**
- [ ] Migration SQL is idempotent (uses `CREATE TABLE IF NOT EXISTS`) and registered in `run-migrations.sh` (already auto-ordered by filename).
- [ ] `ensureEditOperationsTable(connectionManager, schema)` creates the table when absent; no-op when present.
- [ ] `writeEditOperation`, `readEditOperation(id)`, and `markEditOperationReverted(id, byID)` are exported.
- [ ] Table columns accommodate the `EditOperation` shape from the spec (ledger section), including a `Revertable` flag so bulk revision ledger rows can be auditable without surfacing row-menu undo.
- [ ] Unit tests cover: idempotent create, round-trip write/read with non-null `beforeState`/`afterState` JSON, mark-reverted flips pointer, read returns null for unknown id.

**Verify:** `cd frontend && npm run test:unit -- editoperations` → all pass.

**Steps:**

- [ ] **Step 1: Write the migration**

```sql
-- frontend/db-migrations/unified-measurements-migrations/54_create_edit_operations.sql
CREATE TABLE IF NOT EXISTS edit_operations (
  EditOperationID INT AUTO_INCREMENT PRIMARY KEY,
  OperationType ENUM('single-row-edit', 'bulk-revision-row', 'revert') NOT NULL,
  DataType ENUM('measurementssummary', 'failedmeasurements') NOT NULL,
  TargetID BIGINT NOT NULL,
  PlotID INT NOT NULL,
  CensusID INT NOT NULL,
  PlanHash CHAR(64) NOT NULL,
  BeforeState JSON NOT NULL,
  AfterState JSON NOT NULL,
  Revertable BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedBy VARCHAR(255) NOT NULL,
  CreatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  RevertedByEditOperationID INT NULL,
  INDEX idx_edit_operations_target (DataType, TargetID, CreatedAt DESC),
  INDEX idx_edit_operations_scope (PlotID, CensusID, CreatedAt DESC),
  INDEX idx_edit_operations_reverted (RevertedByEditOperationID),
  CONSTRAINT fk_edit_operations_revert
    FOREIGN KEY (RevertedByEditOperationID)
    REFERENCES edit_operations(EditOperationID)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Write the ensure-helper module**

```ts
// frontend/config/editoperations.ts
import ConnectionManager from '@/config/connectionmanager';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export type EditOperationType = 'single-row-edit' | 'bulk-revision-row' | 'revert';
export type EditOperationDataType = 'measurementssummary' | 'failedmeasurements';

export interface EditOperationStateRow {
  table: string;
  primaryKey: string;
  primaryKeyValue: string | number;
  row: Record<string, unknown> | null;
}

export interface EditOperationRecord {
  editOperationID: number;
  operationType: EditOperationType;
  dataType: EditOperationDataType;
  targetID: number;
  plotID: number;
  censusID: number;
  planHash: string;
  beforeState: EditOperationStateRow[];
  afterState: EditOperationStateRow[];
  revertable: boolean;
  createdBy: string;
  createdAt: string;
  revertedByEditOperationID: number | null;
}

const ENSURE_TABLE_SQL = `/* ENSURE_EDIT_OPERATIONS_TABLE */
CREATE TABLE IF NOT EXISTS ??.edit_operations (
  EditOperationID INT AUTO_INCREMENT PRIMARY KEY,
  OperationType ENUM('single-row-edit', 'bulk-revision-row', 'revert') NOT NULL,
  DataType ENUM('measurementssummary', 'failedmeasurements') NOT NULL,
  TargetID BIGINT NOT NULL,
  PlotID INT NOT NULL,
  CensusID INT NOT NULL,
  PlanHash CHAR(64) NOT NULL,
  BeforeState JSON NOT NULL,
  AfterState JSON NOT NULL,
  Revertable BOOLEAN NOT NULL DEFAULT TRUE,
  CreatedBy VARCHAR(255) NOT NULL,
  CreatedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  RevertedByEditOperationID INT NULL,
  INDEX idx_edit_operations_target (DataType, TargetID, CreatedAt DESC),
  INDEX idx_edit_operations_scope (PlotID, CensusID, CreatedAt DESC),
  INDEX idx_edit_operations_reverted (RevertedByEditOperationID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;

export async function ensureEditOperationsTable(connection: ConnectionManager, schema: string, transactionID?: string): Promise<void> {
  await connection.executeQuery(safeFormatQuery(schema, ENSURE_TABLE_SQL), [], transactionID);
}

export async function writeEditOperation(
  connection: ConnectionManager,
  schema: string,
  record: Omit<EditOperationRecord, 'editOperationID' | 'createdAt' | 'revertedByEditOperationID'>,
  transactionID: string
): Promise<number> {
  const result = await connection.executeQuery(
    safeFormatQuery(
      schema,
      `INSERT INTO ??.edit_operations
       (OperationType, DataType, TargetID, PlotID, CensusID, PlanHash, BeforeState, AfterState, Revertable, CreatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    [
      record.operationType,
      record.dataType,
      record.targetID,
      record.plotID,
      record.censusID,
      record.planHash,
      JSON.stringify(record.beforeState),
      JSON.stringify(record.afterState),
      record.revertable,
      record.createdBy
    ],
    transactionID
  );
  return (result as { insertId: number }).insertId;
}

export async function readEditOperation(
  connection: ConnectionManager,
  schema: string,
  editOperationID: number,
  transactionID?: string
): Promise<EditOperationRecord | null> {
  const rows = await connection.executeQuery(
    safeFormatQuery(schema, `SELECT * FROM ??.edit_operations WHERE EditOperationID = ? LIMIT 1`),
    [editOperationID],
    transactionID
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    editOperationID: r.EditOperationID,
    operationType: r.OperationType,
    dataType: r.DataType,
    targetID: r.TargetID,
    plotID: r.PlotID,
    censusID: r.CensusID,
    planHash: r.PlanHash,
    beforeState: typeof r.BeforeState === 'string' ? JSON.parse(r.BeforeState) : r.BeforeState,
    afterState: typeof r.AfterState === 'string' ? JSON.parse(r.AfterState) : r.AfterState,
    revertable: Boolean(r.Revertable),
    createdBy: r.CreatedBy,
    createdAt: typeof r.CreatedAt === 'string' ? r.CreatedAt : r.CreatedAt.toISOString(),
    revertedByEditOperationID: r.RevertedByEditOperationID ?? null
  };
}

export async function markEditOperationReverted(
  connection: ConnectionManager,
  schema: string,
  editOperationID: number,
  revertedByEditOperationID: number,
  transactionID: string
): Promise<void> {
  await connection.executeQuery(
    safeFormatQuery(schema, `UPDATE ??.edit_operations SET RevertedByEditOperationID = ? WHERE EditOperationID = ?`),
    [revertedByEditOperationID, editOperationID],
    transactionID
  );
}
```

- [ ] **Step 3: Write failing tests**

```ts
// frontend/config/editoperations.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase, TestDatabase } from '@/tests/setup/local-db-setup';
import ConnectionManager from '@/config/connectionmanager';
import { ensureEditOperationsTable, writeEditOperation, readEditOperation, markEditOperationReverted } from './editoperations';

describe('editoperations', () => {
  let db: TestDatabase;
  let cm: ConnectionManager;

  beforeEach(async () => {
    db = await setupTestDatabase();
    cm = ConnectionManager.getInstance();
  });

  afterEach(async () => {
    await cm.closeConnection();
    await teardownTestDatabase(db);
  });

  it('ensureEditOperationsTable is idempotent', async () => {
    await ensureEditOperationsTable(cm, db.schema);
    await ensureEditOperationsTable(cm, db.schema); // second call must not throw
    const rows = await cm.executeQuery(`SHOW TABLES LIKE 'edit_operations'`);
    expect(rows).toHaveLength(1);
  });

  it('writeEditOperation and readEditOperation round-trip', async () => {
    await ensureEditOperationsTable(cm, db.schema);
    const txID = await cm.beginTransaction();
    const id = await writeEditOperation(cm, db.schema, {
      operationType: 'single-row-edit',
      dataType: 'measurementssummary',
      targetID: 12345,
      plotID: 1,
      censusID: 2,
      planHash: 'a'.repeat(64),
      beforeState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 12345, row: { MeasuredDBH: 10.0 } }],
      afterState: [{ table: 'coremeasurements', primaryKey: 'CoreMeasurementID', primaryKeyValue: 12345, row: { MeasuredDBH: 12.0 } }],
      revertable: true,
      createdBy: 'test@example.com'
    }, txID);
    await cm.commitTransaction(txID);

    const record = await readEditOperation(cm, db.schema, id);
    expect(record).not.toBeNull();
    expect(record!.targetID).toBe(12345);
    expect(record!.beforeState[0].row!.MeasuredDBH).toBe(10.0);
    expect(record!.afterState[0].row!.MeasuredDBH).toBe(12.0);
    expect(record!.revertedByEditOperationID).toBeNull();
  });

  it('markEditOperationReverted links records', async () => {
    await ensureEditOperationsTable(cm, db.schema);
    const txID = await cm.beginTransaction();
    const baseRecord = {
      dataType: 'measurementssummary' as const,
      targetID: 1,
      plotID: 1,
      censusID: 1,
      planHash: 'b'.repeat(64),
      beforeState: [],
      afterState: [],
      revertable: true,
      createdBy: 't'
    };
    const originalID = await writeEditOperation(cm, db.schema, { ...baseRecord, operationType: 'single-row-edit' }, txID);
    const revertID = await writeEditOperation(cm, db.schema, { ...baseRecord, operationType: 'revert' }, txID);
    await markEditOperationReverted(cm, db.schema, originalID, revertID, txID);
    await cm.commitTransaction(txID);

    const original = await readEditOperation(cm, db.schema, originalID);
    expect(original!.revertedByEditOperationID).toBe(revertID);
  });

  it('readEditOperation returns null for unknown id', async () => {
    await ensureEditOperationsTable(cm, db.schema);
    expect(await readEditOperation(cm, db.schema, 999999)).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests (they should fail — file not yet implemented by the test harness)**

Run: `cd frontend && npm run test:unit -- editoperations`
Expected: FAIL with unresolved import or table-not-found.

- [ ] **Step 5: Confirm tests pass after implementation files from step 2 are in place**

Run: `cd frontend && npm run test:unit -- editoperations`
Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/db-migrations/unified-measurements-migrations/54_create_edit_operations.sql \
        frontend/config/editoperations.ts \
        frontend/config/editoperations.test.ts
git commit -m "Add edit_operations table and ledger helpers for undo"
```

---

### Task 1: Shared types, field allowlist, clear/no-op policy, plan hash

**Goal:** Publish the exported shape every other module consumes. No DB access.

**Files:**
- Create: `frontend/config/editplan/types.ts`
- Create: `frontend/config/editplan/fieldpolicy.ts`
- Create: `frontend/config/editplan/planhash.ts`
- Create: `frontend/config/editplan/planhash.test.ts`
- Create: `frontend/config/editplan/fieldpolicy.test.ts`

**Acceptance Criteria:**
- [ ] `types.ts` exports `Severity`, `SEVERITY_RANK`, `EffectCategory`, `Effect`, `EditPlanDataType`, `EditPlan`, `BulkEditPlan`, `RowPlan`, `ApplyResult`. Strict TS, no `any`.
- [ ] `fieldpolicy.ts` exports `EDITABLE_FIELDS_BY_SURFACE`, `FIELD_ALIASES_BY_SURFACE`, `CLEAR_POLICY`, `canonicalizeEditPayload(surface, rawRow)`, `normalizeFieldValue(field, value)`, `rejectDisallowedFields(surface, canonicalRow): string[] | null`, and `InvalidClearError`.
- [ ] `canonicalizeEditPayload` maps actual client/server payload keys (`speciesCode`, `measuredDBH`, `rawSpCode`, `RawTreeTag`, etc.) to canonical edit-plan names before allowlist/diff/hash/writer dispatch.
- [ ] `normalizeFieldValue` rejects `invalid-clear` fields by throwing `InvalidClearError` for blank strings, `"NULL"`, and explicit `null`; it must not silently normalize identity fields to `null`.
- [ ] `planhash.ts` exports `canonicalizePlan(plan)` (returns a deterministic stringifiable object) and `hashPlan(plan): string`. Strips `planHash` and `generatedAt` at every nested `EditPlan`, including `BulkEditPlan.rowPlans[].plan`. Sorts keys recursively. Sorts `effects` by `[id, category, affectedTable]`. Sorts reference arrays deterministically. Normalizes dates to `YYYY-MM-DD`, decimals to `column-precision` via a `columnPrecision` map, null/empty/undefined per `CLEAR_POLICY`.
- [ ] Unit tests assert: hash stability under key reordering, reference array ordering, nested `BulkEditPlan.rowPlans[].plan.generatedAt`/`planHash` volatility, sensitivity to any semantic change, `canonicalizePlan` idempotence, allowlist rejection returns the disallowed keys, client camelCase/raw aliases canonicalize correctly, and `normalizeFieldValue` collapses valid equivalences while rejecting invalid clears.

**Verify:** `cd frontend && npm run test:unit -- config/editplan/planhash config/editplan/fieldpolicy` → all pass.

**Steps:**

- [ ] **Step 1: Write types**

```ts
// frontend/config/editplan/types.ts
export type Severity = 'info' | 'warn' | 'destructive';

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warn: 1,
  destructive: 2
};

export type EffectCategory = 'field' | 'cross-row' | 'identity' | 'destructive' | 'validation';

export interface Effect {
  id: string;
  severity: Severity;
  category: EffectCategory;
  title: string;
  detail: string;
  affectedTable: string;
  affectedRowCount: number;
  references?: {
    coreMeasurementIDs?: number[];
    speciesID?: number;
    stemGUIDs?: string[];
    treeIDs?: number[];
  };
}

export type EditPlanDataType = 'measurementssummary' | 'failedmeasurements';

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface EditPlan {
  dataType: EditPlanDataType;
  targetID: number;
  fieldChanges: FieldChange[];
  effects: Effect[];
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
}

export interface RowPlan {
  rowIndex: number;
  targetID?: number;
  plan?: EditPlan;
  status: 'matched' | 'new' | 'invalid' | 'unchanged';
  reason?: string;
}

export interface BulkEditPlan {
  dataType: EditPlanDataType;
  rowCount: number;
  rowPlans: RowPlan[];
  aggregateEffects: Effect[];
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
}

export interface ApplyResult {
  updatedIDs: Record<string, number>;
  applyErrors: Array<{ ruleID?: string; coreMeasurementID?: number; csvIndex?: number; reason: string }>;
  editOperationID: number | null;
  validationPending: boolean;
  postValidation?: { newErrors: number; clearedErrors: number };
}
```

- [ ] **Step 2: Write field policy**

```ts
// frontend/config/editplan/fieldpolicy.ts
import { EditPlanDataType } from './types';

export type EditSurface = 'measurementssummary' | 'failedmeasurements' | 'revision-row-local' | 'revision-identity';

export const EDITABLE_FIELDS_BY_SURFACE: Record<EditSurface, ReadonlySet<string>> = {
  measurementssummary: new Set([
    'SpeciesCode',
    'TreeTag',
    'StemTag',
    'QuadratName',
    'StemLocalX',
    'StemLocalY',
    'MeasurementDate',
    'MeasuredDBH',
    'MeasuredHOM',
    'Description',
    'Attributes'
  ]),
  failedmeasurements: new Set(['Tag', 'StemTag', 'SpCode', 'Quadrat', 'X', 'Y', 'DBH', 'HOM', 'Date', 'Codes', 'Comments']),
  'revision-row-local': new Set(['dbh', 'hom', 'date', 'codes', 'comments']),
  'revision-identity': new Set(['spcode', 'tag', 'stemtag', 'quadrat', 'lx', 'ly', 'dbh', 'hom', 'date', 'codes', 'comments'])
};

export const FIELD_ALIASES_BY_SURFACE: Record<EditSurface, Record<string, string>> = {
  measurementssummary: {
    speciesCode: 'SpeciesCode',
    treeTag: 'TreeTag',
    stemTag: 'StemTag',
    quadratName: 'QuadratName',
    stemLocalX: 'StemLocalX',
    stemLocalY: 'StemLocalY',
    measurementDate: 'MeasurementDate',
    measuredDBH: 'MeasuredDBH',
    measuredHOM: 'MeasuredHOM',
    description: 'Description',
    attributes: 'Attributes'
  },
  failedmeasurements: {
    tag: 'Tag',
    rawTreeTag: 'Tag',
    RawTreeTag: 'Tag',
    stemTag: 'StemTag',
    rawStemTag: 'StemTag',
    RawStemTag: 'StemTag',
    spCode: 'SpCode',
    speciesCode: 'SpCode',
    rawSpCode: 'SpCode',
    RawSpCode: 'SpCode',
    quadrat: 'Quadrat',
    rawQuadrat: 'Quadrat',
    RawQuadrat: 'Quadrat',
    x: 'X',
    rawX: 'X',
    RawX: 'X',
    y: 'Y',
    rawY: 'Y',
    RawY: 'Y',
    dbh: 'DBH',
    rawDBH: 'DBH',
    RawDBH: 'DBH',
    hom: 'HOM',
    rawHOM: 'HOM',
    RawHOM: 'HOM',
    date: 'Date',
    rawDate: 'Date',
    RawDate: 'Date',
    codes: 'Codes',
    rawCodes: 'Codes',
    RawCodes: 'Codes',
    comments: 'Comments',
    rawComments: 'Comments',
    RawComments: 'Comments'
  },
  'revision-row-local': {},
  'revision-identity': {}
};

export type ClearSemantics = 'no-op-on-blank' | 'clear-on-blank' | 'clear-on-explicit-null' | 'invalid-clear';

export const CLEAR_POLICY: Record<string, ClearSemantics> = {
  SpeciesCode: 'invalid-clear',
  TreeTag: 'invalid-clear',
  StemTag: 'invalid-clear',
  QuadratName: 'invalid-clear',
  Tag: 'invalid-clear',
  SpCode: 'invalid-clear',
  Quadrat: 'invalid-clear',
  X: 'no-op-on-blank',
  Y: 'no-op-on-blank',
  DBH: 'no-op-on-blank',
  HOM: 'no-op-on-blank',
  Date: 'invalid-clear',
  Codes: 'clear-on-blank',
  Comments: 'clear-on-blank',
  MeasuredDBH: 'no-op-on-blank',
  MeasuredHOM: 'no-op-on-blank',
  StemLocalX: 'no-op-on-blank',
  StemLocalY: 'no-op-on-blank',
  MeasurementDate: 'invalid-clear',
  Description: 'clear-on-blank',
  Attributes: 'clear-on-blank'
};

export class InvalidClearError extends Error {
  constructor(public field: string) {
    super(`${field} cannot be cleared`);
    this.name = 'InvalidClearError';
  }
}

export function canonicalizeEditPayload(surface: EditSurface, rawNewRow: Record<string, unknown>): Record<string, unknown> {
  const aliases = FIELD_ALIASES_BY_SURFACE[surface];
  const canonical: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(rawNewRow)) {
    const field = aliases[rawKey] ?? rawKey;
    const normalized = normalizeFieldValue(field, value);
    if (normalized !== undefined) canonical[field] = normalized;
  }
  return canonical;
}

export function rejectDisallowedFields(surface: EditSurface, newRow: Record<string, unknown>): string[] | null {
  const allowed = EDITABLE_FIELDS_BY_SURFACE[surface];
  const disallowed: string[] = [];
  for (const key of Object.keys(newRow)) {
    if (!allowed.has(key)) disallowed.push(key);
  }
  return disallowed.length ? disallowed : null;
}

/**
 * Collapses "literal NULL" strings and whitespace to explicit null so the
 * analyzer and apply agree on what counts as a change.
 */
export function normalizeFieldValue(field: string, value: unknown): unknown {
  const policy = CLEAR_POLICY[field] ?? 'no-op-on-blank';
  if (value === undefined) return undefined;
  if (value === null) {
    if (policy === 'invalid-clear') throw new InvalidClearError(field);
    if (policy === 'no-op-on-blank') return undefined;
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toUpperCase() === 'NULL') {
      if (policy === 'invalid-clear') throw new InvalidClearError(field);
      if (policy === 'no-op-on-blank') return undefined;
      if (policy === 'clear-on-explicit-null' && trimmed.toUpperCase() !== 'NULL') return undefined;
      return null;
    }
    return trimmed;
  }
  return value;
}

export const PER_COLUMN_DECIMAL_PRECISION: Record<string, number> = {
  MeasuredDBH: 2,
  MeasuredHOM: 2,
  StemLocalX: 2,
  StemLocalY: 2
};
```

- [ ] **Step 3: Write planHash**

```ts
// frontend/config/editplan/planhash.ts
import { createHash } from 'node:crypto';
import { EditPlan, BulkEditPlan, Effect, FieldChange } from './types';
import { PER_COLUMN_DECIMAL_PRECISION } from './fieldpolicy';

function normalizeDate(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return v;
}

function normalizeDecimal(v: unknown, precision: number): unknown {
  if (typeof v !== 'number') return v;
  return Number(v.toFixed(precision));
}

function normalizeFieldChange(fc: FieldChange): FieldChange {
  const precision = PER_COLUMN_DECIMAL_PRECISION[fc.field];
  const from = fc.field.endsWith('Date') ? normalizeDate(fc.from) : precision !== undefined ? normalizeDecimal(fc.from, precision) : fc.from;
  const to = fc.field.endsWith('Date') ? normalizeDate(fc.to) : precision !== undefined ? normalizeDecimal(fc.to, precision) : fc.to;
  return { field: fc.field, from, to };
}

function sortKeys<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys) as unknown as T;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sortKeys(v)] as const);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries) as T;
}

function sortScalarArray<T>(values: T[] | undefined): T[] | undefined {
  if (!values) return undefined;
  return [...values].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

function normalizeReferences(refs: Effect['references']): Effect['references'] {
  if (!refs) return undefined;
  return sortKeys({
    ...refs,
    coreMeasurementIDs: sortScalarArray(refs.coreMeasurementIDs),
    stemGUIDs: sortScalarArray(refs.stemGUIDs),
    treeIDs: sortScalarArray(refs.treeIDs)
  });
}

function sortEffects(effects: Effect[]): Effect[] {
  return [...effects]
    .map(e => ({
      ...e,
      references: normalizeReferences(e.references)
    }))
    .sort((a, b) => (a.id + a.category + a.affectedTable).localeCompare(b.id + b.category + b.affectedTable));
}

function canonicalizeEditPlan(plan: EditPlan): unknown {
  const { planHash, generatedAt, ...rest } = plan;
  const canonical = {
    ...rest,
    effects: sortEffects(plan.effects).map(e => sortKeys(e)),
    fieldChanges: plan.fieldChanges.map(normalizeFieldChange).sort((a, b) => a.field.localeCompare(b.field))
  };
  return sortKeys(canonical);
}

export function canonicalizePlan(plan: EditPlan | BulkEditPlan): unknown {
  if ('rowPlans' in plan) {
    const { planHash, generatedAt, ...rest } = plan;
    return sortKeys({
      ...rest,
      rowPlans: plan.rowPlans
        .map(({ plan: rowPlan, ...rowRest }) => sortKeys({
          ...rowRest,
          plan: rowPlan ? canonicalizeEditPlan(rowPlan) : undefined
        }))
        .sort((a, b) => Number((a as { rowIndex: number }).rowIndex) - Number((b as { rowIndex: number }).rowIndex)),
      aggregateEffects: sortEffects(plan.aggregateEffects).map(e => sortKeys(e))
    });
  }

  return canonicalizeEditPlan(plan);
}

export function hashPlan(plan: EditPlan | BulkEditPlan): string {
  const canonical = canonicalizePlan(plan);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
```

- [ ] **Step 4: Write tests**

```ts
// frontend/config/editplan/planhash.test.ts
import { describe, it, expect } from 'vitest';
import { hashPlan } from './planhash';
import { BulkEditPlan, EditPlan } from './types';

const base: EditPlan = {
  dataType: 'measurementssummary',
  targetID: 1,
  fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 12 }],
  effects: [
    { id: 'R4', severity: 'warn', category: 'cross-row', title: 't', detail: 'd', affectedTable: 'stems', affectedRowCount: 3 }
  ],
  maxSeverity: 'warn',
  planHash: '',
  generatedAt: '2026-04-21T00:00:00Z'
};

describe('hashPlan', () => {
  it('is stable across key reordering on effects', () => {
    const h1 = hashPlan(base);
    const reordered: EditPlan = {
      ...base,
      effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [1, 2] } }]
    };
    const reorderedKeys: EditPlan = {
      ...reordered,
      effects: [{ ...reordered.effects[0], references: { coreMeasurementIDs: [1, 2] } }]
    };
    expect(hashPlan(reordered)).toBe(hashPlan(reorderedKeys));
  });

  it('ignores generatedAt and planHash', () => {
    const other: EditPlan = { ...base, planHash: 'zzzz', generatedAt: '2030-01-01T00:00:00Z' };
    expect(hashPlan(base)).toBe(hashPlan(other));
  });

  it('changes when a field change differs', () => {
    const other: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10, to: 13 }] };
    expect(hashPlan(base)).not.toBe(hashPlan(other));
  });

  it('normalizes decimal precision for measured columns', () => {
    const a: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10.00001, to: 12.00001 }] };
    const b: EditPlan = { ...base, fieldChanges: [{ field: 'MeasuredDBH', from: 10.00002, to: 12.00002 }] };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('sorts reference arrays deterministically', () => {
    const a: EditPlan = { ...base, effects: [{ ...base.effects[0], references: { coreMeasurementIDs: [2, 1], treeIDs: [9, 3] } }] };
    const b: EditPlan = { ...base, effects: [{ ...base.effects[0], references: { treeIDs: [3, 9], coreMeasurementIDs: [1, 2] } }] };
    expect(hashPlan(a)).toBe(hashPlan(b));
  });

  it('strips volatile fields from nested bulk row plans', () => {
    const bulkA: BulkEditPlan = { dataType: 'measurementssummary', rowCount: 1, rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: base }], aggregateEffects: [], maxSeverity: 'info', planHash: 'a', generatedAt: '2026-04-21T00:00:00Z' };
    const bulkB: BulkEditPlan = {
      ...bulkA,
      planHash: 'b',
      generatedAt: '2030-01-01T00:00:00Z',
      rowPlans: [{ rowIndex: 0, targetID: 1, status: 'matched', plan: { ...base, planHash: 'nested', generatedAt: '2030-01-01T00:00:00Z' } }]
    };
    expect(hashPlan(bulkA)).toBe(hashPlan(bulkB));
  });
});
```

```ts
// frontend/config/editplan/fieldpolicy.test.ts
import { describe, it, expect } from 'vitest';
import { canonicalizeEditPayload, InvalidClearError, rejectDisallowedFields, normalizeFieldValue } from './fieldpolicy';

describe('fieldpolicy', () => {
  it('rejects disallowed fields on measurementssummary', () => {
    expect(rejectDisallowedFields('measurementssummary', { SpeciesCode: 'AA' })).toBeNull();
    expect(rejectDisallowedFields('measurementssummary', { SpeciesCode: 'AA', SpeciesName: 'x' })).toEqual(['SpeciesName']);
  });

  it('normalizes "NULL" and empty strings', () => {
    expect(normalizeFieldValue('Description', '   NULL')).toBeNull();
    expect(normalizeFieldValue('MeasuredDBH', '')).toBeUndefined();
    expect(normalizeFieldValue('MeasuredDBH', 'NULL')).toBeUndefined();
    expect(normalizeFieldValue('Description', '  hello ')).toBe('hello');
  });

  it('rejects invalid clears for identity fields', () => {
    expect(() => normalizeFieldValue('SpeciesCode', '')).toThrow(InvalidClearError);
    expect(() => normalizeFieldValue('TreeTag', 'NULL')).toThrow(InvalidClearError);
    expect(() => normalizeFieldValue('MeasurementDate', null)).toThrow(InvalidClearError);
  });

  it('canonicalizes real grid and failed-row payload keys before allowlist checks', () => {
    expect(canonicalizeEditPayload('measurementssummary', { speciesCode: 'aa', measuredDBH: '12.3' })).toEqual({ SpeciesCode: 'aa', MeasuredDBH: '12.3' });
    const failed = canonicalizeEditPayload('failedmeasurements', { rawSpCode: 'bb', RawTreeTag: '100', rawX: 12.34 });
    expect(failed).toEqual({ SpCode: 'bb', Tag: '100', X: 12.34 });
    expect(rejectDisallowedFields('failedmeasurements', failed)).toBeNull();
  });
});
```

- [ ] **Step 5: Run and verify**

Run: `cd frontend && npm run test:unit -- config/editplan/planhash config/editplan/fieldpolicy`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/config/editplan/types.ts \
        frontend/config/editplan/fieldpolicy.ts \
        frontend/config/editplan/fieldpolicy.test.ts \
        frontend/config/editplan/planhash.ts \
        frontend/config/editplan/planhash.test.ts
git commit -m "Add shared editplan types, field policy, and canonical plan hasher"
```

---

### Task 2: Read-only planner resolvers

**Goal:** Create pure-read twins of the mutating tree/stem/quadrat/species resolvers in `coreapifunctions.ts`. Planner must never insert, update, or delete.

**Files:**
- Create: `frontend/config/editplan/resolvers.ts`
- Create: `frontend/config/editplan/resolvers.test.ts`

**Acceptance Criteria:**
- [ ] `resolveSpeciesByCode(cm, schema, code)` returns `{ speciesID: number | null }`.
- [ ] `planTreeResolution(cm, schema, { TreeTag, SpeciesID, CensusID })` returns `{ existingTreeID: number | null, wouldCreate: boolean, sourceTreeID: number | null, sourceTreeRemainingStems: number }`. (`sourceTreeID` is the tree currently referenced by the measurement before the edit; `sourceTreeRemainingStems` is the count of active stems on that tree that remain after the edit moves this measurement away.)
- [ ] `planStemResolution(cm, schema, stemData)` returns `{ existingStemGUID: number | null, wouldCreate: boolean, sourceStemGUID: number | null, sourceStemRemainingMeasurements: number, conflictReason?: string }`.
- [ ] `planQuadratResolution(cm, schema, { QuadratName, PlotID })` returns `{ quadratID: number | null }`.
- [ ] Integration tests against local MySQL cover: found/not-found, orphan counting, inactive blocking stem conflict.

**Verify:** `cd frontend && npm run test:integration -- config/editplan/resolvers` → all pass.

**Steps:**

- [ ] **Step 1: Implement**

```ts
// frontend/config/editplan/resolvers.ts
import ConnectionManager from '@/config/connectionmanager';

export async function resolveSpeciesByCode(cm: ConnectionManager, schema: string, code: string, txID?: string): Promise<{ speciesID: number | null }> {
  const rows = await cm.executeQuery(
    `SELECT SpeciesID FROM ${schema}.species WHERE LOWER(SpeciesCode) = LOWER(?) AND IsActive = 1 ORDER BY SpeciesID LIMIT 1`,
    [code],
    txID
  );
  return { speciesID: rows.length ? rows[0].SpeciesID : null };
}

export interface PlanTreeInput {
  TreeTag: string;
  SpeciesID: number;
  CensusID: number;
  currentTreeID: number | null;
}

export async function planTreeResolution(cm: ConnectionManager, schema: string, input: PlanTreeInput, txID?: string) {
  const existingRows = await cm.executeQuery(
    `SELECT TreeID, IsActive FROM ${schema}.trees WHERE TreeTag = ? AND SpeciesID = ? AND CensusID = ? ORDER BY TreeID LIMIT 1`,
    [input.TreeTag, input.SpeciesID, input.CensusID],
    txID
  );
  const existingTreeID = existingRows.length && existingRows[0].IsActive ? existingRows[0].TreeID : null;
  const wouldCreate = existingTreeID === null;

  let sourceTreeRemainingStems = 0;
  if (input.currentTreeID !== null && input.currentTreeID !== existingTreeID) {
    const remaining = await cm.executeQuery(
      `SELECT COUNT(*) AS cnt FROM ${schema}.stems WHERE TreeID = ? AND IsActive = 1`,
      [input.currentTreeID],
      txID
    );
    sourceTreeRemainingStems = Number(remaining[0].cnt ?? 0);
  }

  return {
    existingTreeID,
    wouldCreate,
    sourceTreeID: input.currentTreeID,
    sourceTreeRemainingStems
  };
}

export interface PlanStemInput {
  TreeID: number;
  CensusID: number;
  StemTag: string;
  QuadratID: number;
  currentStemGUID: number | null;
}

export async function planStemResolution(cm: ConnectionManager, schema: string, input: PlanStemInput, txID?: string) {
  const exact = await cm.executeQuery(
    `SELECT StemGUID FROM ${schema}.stems WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? AND QuadratID <=> ? AND IsActive = 1 LIMIT 1`,
    [input.TreeID, input.CensusID, input.StemTag, input.QuadratID],
    txID
  );
  if (exact.length) {
    const existingStemGUID = exact[0].StemGUID as number;
    return {
      existingStemGUID,
      wouldCreate: false,
      sourceStemGUID: input.currentStemGUID,
      sourceStemRemainingMeasurements: await countSourceStemRemaining(cm, schema, input.currentStemGUID, existingStemGUID, txID)
    };
  }

  const blocking = await cm.executeQuery(
    `SELECT StemGUID, QuadratID, IsActive FROM ${schema}.stems WHERE TreeID = ? AND CensusID = ? AND StemTag <=> ? ORDER BY StemGUID LIMIT 1`,
    [input.TreeID, input.CensusID, input.StemTag],
    txID
  );
  if (blocking.length) {
    const b = blocking[0];
    if (!b.IsActive) return { conflictReason: `matching stem is inactive`, existingStemGUID: null, wouldCreate: false, sourceStemGUID: input.currentStemGUID, sourceStemRemainingMeasurements: 0 };
    if (b.QuadratID !== input.QuadratID) return { conflictReason: `stem exists in a different quadrat`, existingStemGUID: null, wouldCreate: false, sourceStemGUID: input.currentStemGUID, sourceStemRemainingMeasurements: 0 };
    // same quadrat, nullable StemTag equality — treat as exact match
    return {
      existingStemGUID: b.StemGUID as number,
      wouldCreate: false,
      sourceStemGUID: input.currentStemGUID,
      sourceStemRemainingMeasurements: await countSourceStemRemaining(cm, schema, input.currentStemGUID, b.StemGUID, txID)
    };
  }

  return {
    existingStemGUID: null,
    wouldCreate: true,
    sourceStemGUID: input.currentStemGUID,
    sourceStemRemainingMeasurements: await countSourceStemRemaining(cm, schema, input.currentStemGUID, null, txID)
  };
}

async function countSourceStemRemaining(cm: ConnectionManager, schema: string, sourceStemGUID: number | null, destinationStemGUID: number | null, txID?: string): Promise<number> {
  if (sourceStemGUID === null || sourceStemGUID === destinationStemGUID) return 0;
  const rows = await cm.executeQuery(
    `SELECT COUNT(*) AS cnt FROM ${schema}.coremeasurements WHERE StemGUID = ?`,
    [sourceStemGUID],
    txID
  );
  return Math.max(0, Number(rows[0].cnt ?? 0) - 1); // subtract the one being moved
}

export async function planQuadratResolution(cm: ConnectionManager, schema: string, { QuadratName, PlotID }: { QuadratName: string; PlotID: number }, txID?: string): Promise<{ quadratID: number | null }> {
  const rows = await cm.executeQuery(
    `SELECT QuadratID FROM ${schema}.quadrats WHERE LOWER(QuadratName) = LOWER(?) AND PlotID = ? AND IsActive = 1 ORDER BY QuadratID LIMIT 1`,
    [QuadratName.trim(), PlotID],
    txID
  );
  return { quadratID: rows.length ? rows[0].QuadratID : null };
}
```

- [ ] **Step 2: Integration tests**

```ts
// frontend/config/editplan/resolvers.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase, TestDatabase, seedMinimalFixture } from '@/tests/setup/local-db-setup';
import ConnectionManager from '@/config/connectionmanager';
import { resolveSpeciesByCode, planTreeResolution, planStemResolution, planQuadratResolution } from './resolvers';

describe('editplan/resolvers', () => {
  let db: TestDatabase;
  let cm: ConnectionManager;

  beforeEach(async () => {
    db = await setupTestDatabase();
    cm = ConnectionManager.getInstance();
    await seedMinimalFixture(db, { species: ['AA', 'BB'], trees: [{ tag: '100', species: 'AA' }, { tag: '200', species: 'AA' }], quadrats: ['0101'] });
  });
  afterEach(async () => { await cm.closeConnection(); await teardownTestDatabase(db); });

  it('resolveSpeciesByCode returns id for known code and null for unknown', async () => {
    expect((await resolveSpeciesByCode(cm, db.schema, 'AA')).speciesID).toBeGreaterThan(0);
    expect((await resolveSpeciesByCode(cm, db.schema, 'XX')).speciesID).toBeNull();
  });

  it('planTreeResolution reports orphan count when moving measurement away', async () => {
    const result = await planTreeResolution(cm, db.schema, { TreeTag: '200', SpeciesID: db.speciesIDs['AA'], CensusID: db.censusID, currentTreeID: db.treeIDs['100'] });
    expect(result.existingTreeID).toBe(db.treeIDs['200']);
    expect(result.wouldCreate).toBe(false);
  });

  it('planStemResolution reports wouldCreate when no match', async () => {
    const result = await planStemResolution(cm, db.schema, { TreeID: db.treeIDs['100'], CensusID: db.censusID, StemTag: 'NEW', QuadratID: db.quadratIDs['0101'], currentStemGUID: null });
    expect(result.existingStemGUID).toBeNull();
    expect(result.wouldCreate).toBe(true);
  });
});
```

- [ ] **Step 3: Run and commit**

Run: `cd frontend && npm run test:integration -- config/editplan/resolvers`
Expected: PASS.

```bash
git add frontend/config/editplan/resolvers.ts frontend/config/editplan/resolvers.test.ts
git commit -m "Add read-only planner resolvers for tree/stem/species/quadrat"
```

---

### Task 3: Analyzer rules R1a / R1c (species re-link / not found)

**Goal:** First rule module. Establishes the rule-module shape other rule files will follow.

**Files:**
- Create: `frontend/config/editplan/rules/species.ts`
- Create: `frontend/config/editplan/rules/species.test.ts`
- Create: `frontend/config/editplan/rules/context.ts`

**Acceptance Criteria:**
- [ ] `context.ts` exports `RuleContext` — the shared input every rule receives (mapped old row, mapped new row, connection, schema, transaction id, preloaded lookups).
- [ ] `species.ts::applySpeciesRules(ctx)` returns `Effect[]`, plus a throwable `SpeciesNotFoundError` when code resolves to no species.
- [ ] Emits R1a when `SpeciesCode` changed and resolves to a different existing `SpeciesID`. Severity `warn`, category `identity`.
- [ ] Unit tests cover: no effect when code unchanged; R1a when code changes to an existing different species; `SpeciesNotFoundError` thrown when code is unknown; no effect for `SpeciesName`/`SubspeciesName` alone (those fields are not editable on the measurement surface, see fieldpolicy).

**Verify:** `cd frontend && npm run test:unit -- config/editplan/rules/species` → all pass.

**Steps:**

- [ ] **Step 1: Write the shared rule context**

```ts
// frontend/config/editplan/rules/context.ts
import ConnectionManager from '@/config/connectionmanager';
import { EditPlanDataType } from '../types';

export interface RuleContext {
  cm: ConnectionManager;
  schema: string;
  transactionID?: string;
  dataType: EditPlanDataType;
  plotID: number;
  censusID: number;
  oldRow: Record<string, unknown>;
  newRow: Record<string, unknown>;
  changedFields: Set<string>;
}

export class SpeciesNotFoundError extends Error {
  constructor(public code: string) { super(`Species not found: ${code}`); this.name = 'SpeciesNotFoundError'; }
}
```

- [ ] **Step 2: Write species rule**

```ts
// frontend/config/editplan/rules/species.ts
import { Effect } from '../types';
import { RuleContext, SpeciesNotFoundError } from './context';
import { resolveSpeciesByCode } from '../resolvers';

export async function applySpeciesRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('SpeciesCode')) return [];

  const newCode = String(ctx.newRow.SpeciesCode ?? '').trim();
  if (!newCode) throw new SpeciesNotFoundError('');

  const { speciesID: newSpeciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);
  if (newSpeciesID === null) throw new SpeciesNotFoundError(newCode);

  const oldSpeciesID = Number(ctx.oldRow.SpeciesID);
  if (newSpeciesID === oldSpeciesID) return [];

  return [
    {
      id: 'R1a',
      severity: 'warn',
      category: 'identity',
      title: 'Measurement will be re-linked to a different species',
      detail: `Species code "${ctx.oldRow.SpeciesCode}" → "${newCode}". No species row will be modified.`,
      affectedTable: 'coremeasurements',
      affectedRowCount: 1,
      references: { speciesID: newSpeciesID }
    }
  ];
}
```

- [ ] **Step 3: Write tests**

```ts
// frontend/config/editplan/rules/species.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applySpeciesRules } from './species';
import { SpeciesNotFoundError } from './context';

vi.mock('../resolvers', () => ({
  resolveSpeciesByCode: vi.fn(async (_cm: unknown, _schema: string, code: string) => {
    if (code === 'AA') return { speciesID: 1 };
    if (code === 'BB') return { speciesID: 2 };
    return { speciesID: null };
  })
}));

function makeCtx(overrides: Partial<Parameters<typeof applySpeciesRules>[0]> = {}) {
  return {
    cm: {} as any,
    schema: 's',
    dataType: 'measurementssummary' as const,
    plotID: 1,
    censusID: 1,
    oldRow: { SpeciesID: 1, SpeciesCode: 'AA' },
    newRow: { SpeciesCode: 'BB' },
    changedFields: new Set(['SpeciesCode']),
    ...overrides
  };
}

describe('applySpeciesRules', () => {
  it('no effect when SpeciesCode unchanged', async () => {
    expect(await applySpeciesRules(makeCtx({ changedFields: new Set() }))).toEqual([]);
  });

  it('emits R1a when code resolves to different species', async () => {
    const effects = await applySpeciesRules(makeCtx());
    expect(effects).toHaveLength(1);
    expect(effects[0].id).toBe('R1a');
    expect(effects[0].severity).toBe('warn');
    expect(effects[0].references?.speciesID).toBe(2);
  });

  it('throws SpeciesNotFoundError for unknown code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: 'ZZ' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });

  it('throws SpeciesNotFoundError for empty code', async () => {
    await expect(applySpeciesRules(makeCtx({ newRow: { SpeciesCode: '' } }))).rejects.toBeInstanceOf(SpeciesNotFoundError);
  });
});
```

- [ ] **Step 4: Run and commit**

Run: `cd frontend && npm run test:unit -- config/editplan/rules/species`
Expected: PASS.

```bash
git add frontend/config/editplan/rules/
git commit -m "Add species re-link rules (R1a/R1c) for editplan analyzer"
```

---

### Task 4: Analyzer rules R2 / R3 (tree/stem reassignment + orphaning)

**Goal:** Identity-changing rules for tree and stem, with `destructive` promotion when the source row becomes orphaned.

**Files:**
- Create: `frontend/config/editplan/rules/treestem.ts`
- Create: `frontend/config/editplan/rules/treestem.test.ts`

**Acceptance Criteria:**
- [ ] R2 emitted when `TreeTag` changes OR `SpeciesCode` change leads to a different tree id (consult resolver). Severity `warn`; promoted to `destructive` when `sourceTreeRemainingStems === 0`.
- [ ] R3 emitted when `StemTag` or `QuadratName` changes and resolver reports different `existingStemGUID`. Severity promotion analogous to R2.
- [ ] `sourceTreeID` / `sourceStemGUID` populated in `references` so drill-down lists can lookup affected rows.
- [ ] Unit tests mock the resolvers and cover: no effect when identity unchanged; warn when moved but source has remaining stems; destructive when source emptied; both R2 and R3 can fire on the same edit.

**Verify:** `cd frontend && npm run test:unit -- config/editplan/rules/treestem` → pass.

**Steps:**

- [ ] **Step 1: Implement**

```ts
// frontend/config/editplan/rules/treestem.ts
import { Effect } from '../types';
import { RuleContext } from './context';
import { planTreeResolution, planStemResolution, planQuadratResolution, resolveSpeciesByCode } from '../resolvers';

export async function applyTreeStemRules(ctx: RuleContext): Promise<Effect[]> {
  const effects: Effect[] = [];
  const treeIdentityChanged = ctx.changedFields.has('TreeTag') || ctx.changedFields.has('SpeciesCode');
  const stemIdentityChanged = ctx.changedFields.has('StemTag') || ctx.changedFields.has('QuadratName');

  let destinationTreeID: number | null = Number(ctx.oldRow.TreeID) || null;
  if (treeIdentityChanged) {
    const newCode = String(ctx.newRow.SpeciesCode ?? ctx.oldRow.SpeciesCode ?? '').trim();
    const { speciesID } = await resolveSpeciesByCode(ctx.cm, ctx.schema, newCode, ctx.transactionID);
    if (speciesID !== null) {
      const planned = await planTreeResolution(ctx.cm, ctx.schema, {
        TreeTag: String(ctx.newRow.TreeTag ?? ctx.oldRow.TreeTag),
        SpeciesID: speciesID,
        CensusID: ctx.censusID,
        currentTreeID: Number(ctx.oldRow.TreeID) || null
      }, ctx.transactionID);
      destinationTreeID = planned.existingTreeID;

      const currentTreeID = Number(ctx.oldRow.TreeID);
      const movedAway = planned.sourceTreeID !== null && planned.sourceTreeID !== planned.existingTreeID;
      if (movedAway) {
        const destLabel = planned.existingTreeID
          ? `tree T#${planned.existingTreeID}`
          : planned.wouldCreate
            ? 'a new tree'
            : 'unresolved tree';
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

  if (stemIdentityChanged && destinationTreeID !== null) {
    const { quadratID } = await planQuadratResolution(ctx.cm, ctx.schema, {
      QuadratName: String(ctx.newRow.QuadratName ?? ctx.oldRow.QuadratName),
      PlotID: ctx.plotID
    }, ctx.transactionID);
    if (quadratID !== null) {
      const planned = await planStemResolution(ctx.cm, ctx.schema, {
        TreeID: destinationTreeID,
        CensusID: ctx.censusID,
        StemTag: String(ctx.newRow.StemTag ?? ctx.oldRow.StemTag),
        QuadratID: quadratID,
        currentStemGUID: Number(ctx.oldRow.StemGUID) || null
      }, ctx.transactionID);
      const movedAway = planned.sourceStemGUID !== null && planned.sourceStemGUID !== planned.existingStemGUID;
      if (movedAway) {
        const severity = planned.sourceStemRemainingMeasurements === 0 ? 'destructive' : 'warn';
        effects.push({
          id: 'R3',
          severity,
          category: 'identity',
          title: 'Measurement will be reassigned to a different stem',
          detail: `Moving from stem S#${planned.sourceStemGUID} to ${planned.existingStemGUID ? `stem S#${planned.existingStemGUID}` : planned.wouldCreate ? 'a new stem' : 'unresolved stem'}. Source stem will have ${planned.sourceStemRemainingMeasurements} measurement(s) after the move.`,
          affectedTable: 'stems',
          affectedRowCount: 1,
          references: { stemGUIDs: [planned.sourceStemGUID as number].concat(planned.existingStemGUID ? [planned.existingStemGUID as number] : []).map(Number) as unknown as number[] }
        });
      }
    }
  }

  return effects;
}
```

- [ ] **Step 2: Unit tests**

```ts
// frontend/config/editplan/rules/treestem.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyTreeStemRules } from './treestem';

vi.mock('../resolvers', () => ({
  resolveSpeciesByCode: vi.fn(async () => ({ speciesID: 1 })),
  planTreeResolution: vi.fn(),
  planStemResolution: vi.fn(),
  planQuadratResolution: vi.fn(async () => ({ quadratID: 9 }))
}));

import * as resolvers from '../resolvers';

function ctx(overrides = {}) {
  return {
    cm: {} as any, schema: 's', dataType: 'measurementssummary' as const, plotID: 1, censusID: 1,
    oldRow: { TreeID: 10, TreeTag: 'T1', StemGUID: 100, StemTag: 'S1', QuadratName: 'Q', SpeciesCode: 'AA' },
    newRow: { TreeTag: 'T2' },
    changedFields: new Set(['TreeTag']),
    ...overrides
  };
}

describe('applyTreeStemRules', () => {
  it('no effects when identity unchanged', async () => {
    expect(await applyTreeStemRules(ctx({ changedFields: new Set() }))).toEqual([]);
  });

  it('emits warn R2 when moving to a tree with stems remaining on source', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({ existingTreeID: 20, wouldCreate: false, sourceTreeID: 10, sourceTreeRemainingStems: 2 });
    const effects = await applyTreeStemRules(ctx());
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ id: 'R2', severity: 'warn' });
  });

  it('promotes R2 to destructive when source tree orphans', async () => {
    (resolvers.planTreeResolution as any).mockResolvedValue({ existingTreeID: 20, wouldCreate: false, sourceTreeID: 10, sourceTreeRemainingStems: 0 });
    const effects = await applyTreeStemRules(ctx());
    expect(effects[0].severity).toBe('destructive');
  });
});
```

- [ ] **Step 3: Run and commit**

Run: `cd frontend && npm run test:unit -- config/editplan/rules/treestem`
Expected: PASS.

```bash
git add frontend/config/editplan/rules/treestem.ts frontend/config/editplan/rules/treestem.test.ts
git commit -m "Add tree/stem reassignment rules (R2/R3) with orphan promotion"
```

---

### Task 5: Analyzer rules R4 (coordinate propagation) and R5 (attributes rebuild)

**Goal:** Remaining cross-row / info rules.

**Files:**
- Create: `frontend/config/editplan/rules/coordinates.ts`
- Create: `frontend/config/editplan/rules/coordinates.test.ts`
- Create: `frontend/config/editplan/rules/attributes.ts`
- Create: `frontend/config/editplan/rules/attributes.test.ts`

**Acceptance Criteria:**
- [ ] R4 emitted when `StemLocalX` or `StemLocalY` change. Severity `warn`, category `cross-row`. Counts every measurement sharing the same `StemGUID` in the current census.
- [ ] R5 emitted when `Attributes` changes. Default severity `info`; promoted to `destructive` when any code currently attached is no longer present in the new set.
- [ ] Unit tests cover: X or Y change triggers R4 with correct count; Y-only edit still triggers; attributes superset → info; attributes that drop a code → destructive; identical set → no effect.

**Verify:** `cd frontend && npm run test:unit -- config/editplan/rules/coordinates config/editplan/rules/attributes` → pass.

**Steps:**

- [ ] **Step 1: Implement coordinates**

```ts
// frontend/config/editplan/rules/coordinates.ts
import { Effect } from '../types';
import { RuleContext } from './context';

export async function applyCoordinateRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('StemLocalX') && !ctx.changedFields.has('StemLocalY')) return [];
  const stemGUID = Number(ctx.oldRow.StemGUID);
  if (!stemGUID) return [];
  const [{ cnt }] = await ctx.cm.executeQuery(
    `SELECT COUNT(*) AS cnt FROM ${ctx.schema}.coremeasurements WHERE StemGUID = ?`,
    [stemGUID],
    ctx.transactionID
  );
  const count = Number(cnt ?? 0);
  return [
    {
      id: 'R4',
      severity: 'warn',
      category: 'cross-row',
      title: `Stem coordinate will propagate to ${count} measurement(s)`,
      detail: `Stem S#${stemGUID} coordinate change updates the stem row; every measurement referencing that stem reflects the new value.`,
      affectedTable: 'stems',
      affectedRowCount: count,
      references: { stemGUIDs: [stemGUID] }
    }
  ];
}
```

- [ ] **Step 2: Implement attributes**

```ts
// frontend/config/editplan/rules/attributes.ts
import { Effect } from '../types';
import { RuleContext } from './context';

function parseCodes(raw: unknown): Set<string> {
  if (!raw) return new Set();
  return new Set(String(raw).split(/[;,]/).map(s => s.trim()).filter(Boolean));
}

export async function applyAttributeRules(ctx: RuleContext): Promise<Effect[]> {
  if (!ctx.changedFields.has('Attributes')) return [];
  const oldCodes = parseCodes(ctx.oldRow.Attributes);
  const newCodes = parseCodes(ctx.newRow.Attributes);
  if (oldCodes.size === newCodes.size && [...oldCodes].every(c => newCodes.has(c))) return [];

  const dropped = [...oldCodes].filter(c => !newCodes.has(c));
  const severity: 'info' | 'destructive' = dropped.length > 0 ? 'destructive' : 'info';
  return [
    {
      id: 'R5',
      severity,
      category: severity === 'destructive' ? 'destructive' : 'field',
      title: severity === 'destructive' ? `Attribute codes ${dropped.join(', ')} will be removed` : 'Attribute codes will be rebuilt',
      detail: `cmattributes rows for this measurement are deleted and re-inserted for the new code set.`,
      affectedTable: 'cmattributes',
      affectedRowCount: Math.max(oldCodes.size, newCodes.size)
    }
  ];
}
```

- [ ] **Step 3: Tests (see species.test.ts for shape — mirror the pattern)**

- [ ] **Step 4: Commit**

```bash
git add frontend/config/editplan/rules/coordinates.ts frontend/config/editplan/rules/coordinates.test.ts \
        frontend/config/editplan/rules/attributes.ts frontend/config/editplan/rules/attributes.test.ts
git commit -m "Add coordinate propagation (R4) and attribute rebuild (R5) rules"
```

---

### Task 6: Bulk plan aggregator + R6 / R9 (duplicate survivor + invalid match keys) + analyzer glue

**Goal:** Assemble per-row analyzer and build `BulkEditPlan`.

**Files:**
- Create: `frontend/config/editplan/analyzer.ts`
- Create: `frontend/config/editplan/bulkanalyzer.ts`
- Create: `frontend/config/editplan/rules/duplicates.ts`
- Create: `frontend/config/editplan/analyzer.test.ts`

**Acceptance Criteria:**
- [ ] `analyzer.ts::analyzeEdit(cm, schema, dataType, plotID, censusID, targetID, rawNewRow, txID?)` canonicalizes incoming payload keys, validates against the surface allowlist, loads the authoritative current row by `targetID` constrained to `plotID` + `censusID`, computes `changedFields` from canonical field names, dispatches to the rule modules, returns a signed `EditPlan` with `planHash` set.
- [ ] `bulkanalyzer.ts::analyzeBulk(...)` takes matched/unmatched/invalid row arrays (shape identical to `revisionupload` match response) and returns `BulkEditPlan` with per-row plans, aggregated effects (sum/max across all row plans), and R6/R9 entries.
- [ ] R6 fires when the matched-rows response includes `duplicateMeasurementIDsToDelete` with count > 0; severity `destructive`.
- [ ] R9 is represented as `RowPlan` entries with `status: 'invalid'`, not as an `Effect`; aggregator does not count those toward `aggregateEffects`.
- [ ] `analyzeEdit` throws `DisallowedFieldError` when the canonical new row contains keys outside the allowlist for the surface; it throws `TargetScopeError` when `targetID` is not in the requested plot/census.
- [ ] Unit tests mock the rule modules and verify dispatch, `maxSeverity` aggregation, bulk plan aggregation, field alias canonicalization for measurement grid + failed rows, and target-scope rejection.

**Verify:** `cd frontend && npm run test:unit -- config/editplan/analyzer` → pass.

**Steps:**

- [ ] **Step 1: Implement `duplicates.ts`, `analyzer.ts`, `bulkanalyzer.ts`** using the code shown below:

```ts
// frontend/config/editplan/analyzer.ts
import ConnectionManager from '@/config/connectionmanager';
import { EditPlan, EditPlanDataType, Effect, SEVERITY_RANK, Severity } from './types';
import { applySpeciesRules } from './rules/species';
import { applyTreeStemRules } from './rules/treestem';
import { applyCoordinateRules } from './rules/coordinates';
import { applyAttributeRules } from './rules/attributes';
import { canonicalizeEditPayload, rejectDisallowedFields, EditSurface } from './fieldpolicy';
import { hashPlan } from './planhash';
import { safeFormatQuery } from '@/config/utils/sqlsecurity';

export class DisallowedFieldError extends Error { constructor(public fields: string[]) { super(`Disallowed fields: ${fields.join(',')}`); this.name = 'DisallowedFieldError'; } }
export class TargetScopeError extends Error { constructor(public targetID: number) { super(`target not found in requested plot/census: ${targetID}`); this.name = 'TargetScopeError'; } }

const SURFACE_BY_DATATYPE: Record<EditPlanDataType, EditSurface> = {
  measurementssummary: 'measurementssummary',
  failedmeasurements: 'failedmeasurements'
};

export async function analyzeEdit(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  targetID: number,
  rawNewRow: Record<string, unknown>,
  transactionID?: string
): Promise<EditPlan> {
  const surface = SURFACE_BY_DATATYPE[dataType];
  const newRow = canonicalizeEditPayload(surface, rawNewRow);
  const disallowed = rejectDisallowedFields(surface, newRow);
  if (disallowed) throw new DisallowedFieldError(disallowed);

  const oldRow = await loadCurrentRow(cm, schema, dataType, plotID, censusID, targetID, transactionID);

  const changedFields = new Set<string>();
  const fieldChanges = [];
  for (const [field, to] of Object.entries(newRow)) {
    const from = (oldRow as Record<string, unknown>)[field];
    if (from !== to) {
      changedFields.add(field);
      fieldChanges.push({ field, from, to });
    }
  }

  const ctx = { cm, schema, transactionID, dataType, plotID, censusID, oldRow, newRow, changedFields };
  const effects: Effect[] = [];
  effects.push(...await applySpeciesRules(ctx));
  effects.push(...await applyTreeStemRules(ctx));
  effects.push(...await applyCoordinateRules(ctx));
  effects.push(...await applyAttributeRules(ctx));

  const maxSeverity: Severity = effects.reduce((max, e) => SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max, 'info' as Severity);

  const plan: EditPlan = {
    dataType,
    targetID,
    fieldChanges,
    effects,
    maxSeverity,
    planHash: '',
    generatedAt: new Date().toISOString()
  };
  plan.planHash = hashPlan(plan);
  return plan;
}

async function loadCurrentRow(cm: ConnectionManager, schema: string, dataType: EditPlanDataType, plotID: number, censusID: number, targetID: number, txID?: string): Promise<Record<string, unknown>> {
  if (dataType === 'failedmeasurements') {
    const rows = await cm.executeQuery(
      safeFormatQuery(schema, `SELECT
         cm.CoreMeasurementID,
         cm.CensusID,
         cm.RawTreeTag AS Tag,
         cm.RawStemTag AS StemTag,
         cm.RawSpCode AS SpCode,
         cm.RawQuadrat AS Quadrat,
         cm.RawX AS X,
         cm.RawY AS Y,
         cm.MeasuredDBH AS DBH,
         cm.MeasuredHOM AS HOM,
         cm.MeasurementDate AS Date,
         cm.RawCodes AS Codes,
         cm.RawComments AS Comments
       FROM ??.coremeasurements cm
       JOIN ??.census c ON c.CensusID = cm.CensusID
       WHERE cm.CoreMeasurementID = ? AND cm.CensusID = ? AND c.PlotID = ? AND cm.StemGUID IS NULL AND cm.IsActive = 1
       LIMIT 1`),
      [targetID, censusID, plotID],
      txID
    );
    if (!rows.length) throw new TargetScopeError(targetID);
    return rows[0];
  }

  const rows = await cm.executeQuery(
    safeFormatQuery(schema, `SELECT
       cm.CoreMeasurementID,
       cm.CensusID,
       cm.MeasurementDate,
       cm.MeasuredDBH,
       cm.MeasuredHOM,
       cm.Description,
       cm.RawCodes AS Attributes,
       t.TreeTag,
       sp.SpeciesCode,
       sp.SpeciesID,
       s.StemTag,
       s.StemGUID,
       s.LocalX AS StemLocalX,
       s.LocalY AS StemLocalY,
       q.QuadratName
     FROM ??.coremeasurements cm
     JOIN ??.census c ON c.CensusID = cm.CensusID
     LEFT JOIN ??.stems s ON s.StemGUID = cm.StemGUID
     LEFT JOIN ??.trees t ON t.TreeID = s.TreeID
     LEFT JOIN ??.species sp ON sp.SpeciesID = t.SpeciesID
     LEFT JOIN ??.quadrats q ON q.QuadratID = s.QuadratID
     WHERE cm.CoreMeasurementID = ? AND cm.CensusID = ? AND c.PlotID = ? AND cm.StemGUID IS NOT NULL AND cm.IsActive = 1
     LIMIT 1`),
    [targetID, censusID, plotID],
    txID
  );
  if (!rows.length) throw new TargetScopeError(targetID);
  return rows[0];
}
```

- [ ] **Step 2: Implement bulk + duplicates rule**

```ts
// frontend/config/editplan/rules/duplicates.ts
import { Effect } from '../types';
export function applyDuplicateRules(duplicateCount: number): Effect[] {
  if (duplicateCount <= 0) return [];
  return [{
    id: 'R6',
    severity: 'destructive',
    category: 'destructive',
    title: `${duplicateCount} duplicate measurement(s) will be deleted`,
    detail: 'Survivor selection keeps one measurement per stem in this census; the rest are removed.',
    affectedTable: 'coremeasurements',
    affectedRowCount: duplicateCount
  }];
}
```

```ts
// frontend/config/editplan/bulkanalyzer.ts
import ConnectionManager from '@/config/connectionmanager';
import { BulkEditPlan, EditPlanDataType, Effect, RowPlan, SEVERITY_RANK, Severity } from './types';
import { analyzeEdit } from './analyzer';
import { applyDuplicateRules } from './rules/duplicates';
import { hashPlan } from './planhash';

export interface BulkInput {
  matched: Array<{ rowIndex: number; targetID: number; newRow: Record<string, unknown> }>;
  newRows: Array<{ rowIndex: number; newRow: Record<string, unknown> }>;
  invalid: Array<{ rowIndex: number; reason: string }>;
  duplicateMeasurementIDsToDelete: number[];
}

export async function analyzeBulk(
  cm: ConnectionManager,
  schema: string,
  dataType: EditPlanDataType,
  plotID: number,
  censusID: number,
  input: BulkInput,
  transactionID?: string
): Promise<BulkEditPlan> {
  const rowPlans: RowPlan[] = [];
  for (const m of input.matched) {
    const plan = await analyzeEdit(cm, schema, dataType, plotID, censusID, m.targetID, m.newRow, transactionID);
    rowPlans.push({ rowIndex: m.rowIndex, targetID: m.targetID, plan, status: plan.fieldChanges.length ? 'matched' : 'unchanged' });
  }
  for (const n of input.newRows) rowPlans.push({ rowIndex: n.rowIndex, status: 'new' });
  for (const i of input.invalid) rowPlans.push({ rowIndex: i.rowIndex, status: 'invalid', reason: i.reason });

  const effects: Effect[] = [];
  effects.push(...applyDuplicateRules(input.duplicateMeasurementIDsToDelete.length));
  for (const rp of rowPlans) if (rp.plan) effects.push(...rp.plan.effects);

  const aggregateEffects = aggregateByRuleID(effects);
  const maxSeverity: Severity = aggregateEffects.reduce((max, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[max] ? e.severity : max), 'info' as Severity);

  const plan: BulkEditPlan = {
    dataType,
    rowCount: rowPlans.length,
    rowPlans,
    aggregateEffects,
    maxSeverity,
    planHash: '',
    generatedAt: new Date().toISOString()
  };
  plan.planHash = hashPlan(plan);
  return plan;
}

function aggregateByRuleID(effects: Effect[]): Effect[] {
  const buckets = new Map<string, Effect[]>();
  for (const e of effects) {
    const list = buckets.get(e.id) ?? [];
    list.push(e);
    buckets.set(e.id, list);
  }
  const out: Effect[] = [];
  for (const [id, list] of buckets) {
    const sumRows = list.reduce((acc, e) => acc + e.affectedRowCount, 0);
    const maxSeverity = list.reduce<Severity>((m, e) => (SEVERITY_RANK[e.severity] > SEVERITY_RANK[m] ? e.severity : m), 'info');
    out.push({
      id,
      severity: maxSeverity,
      category: list[0].category,
      title: list[0].title,
      detail: `${list.length} row(s) affected · ${sumRows} downstream row(s)`,
      affectedTable: list[0].affectedTable,
      affectedRowCount: sumRows
    });
  }
  return out;
}
```

- [ ] **Step 3: Tests mirror species.test.ts pattern; mock the rules and assert dispatch/aggregation.**

- [ ] **Step 4: Commit**

```bash
git add frontend/config/editplan/analyzer.ts frontend/config/editplan/bulkanalyzer.ts \
        frontend/config/editplan/rules/duplicates.ts frontend/config/editplan/analyzer.test.ts
git commit -m "Add analyzer + bulk aggregator with duplicate (R6) and invalid-row (R9) handling"
```

---

### Task 7: Apply helper skeleton (lock wrapper + transactional primitive + drift check + edit_operations writer)

**Goal:** Two-layer apply API. `applyEdit` is the public single-row wrapper that owns lock/transaction. `applyEditInTransaction` is the lower-level primitive for callers that already own the scope lock and transaction (revision apply, compatibility shim). No batch path may call `applyEdit` in a loop.

**Files:**
- Create: `frontend/config/editplan/apply.ts`
- Create: `frontend/config/editplan/apply.test.ts`

**Acceptance Criteria:**
- [ ] `applyEdit(cm, input): Promise<ApplyResult>` begins a transaction, acquires `buildMeasurementScopeLockName(schema, plotID, censusID)` at timeout 0, calls `applyEditInTransaction`, commits on success, rolls back on error.
- [ ] `applyEditInTransaction(cm, input & { transactionID })` never begins/commits/rolls back a transaction and never acquires/releases the scope lock. It ensures `edit_operations`, re-runs analyzer, hash-checks, dispatches to dataType-specific writer, writes a ledger row when `writeLedger !== false`, and returns `ApplyResult`.
- [ ] Revision/bulk callers must own one outer transaction and one scope lock, then call `applyEditInTransaction` for every matched row.
- [ ] On `423 Locked`, bubbles a `ScopeLockHeldError` the endpoint layer translates to 423.
- [ ] `HashDriftError` exposes the fresh plan.
- [ ] `SpeciesNotFoundError` bubbles out so endpoint layer returns 422.
- [ ] Tests mock the writer and assert: `applyEdit` acquires lock and commits/rolls back; `applyEditInTransaction` does not begin/commit/acquire; hash drift throws without writer calls; ledger row written inside the provided transaction.

**Verify:** `cd frontend && npm run test:unit -- config/editplan/apply` → pass.

**Steps:**

- [ ] **Step 1: Implement**

```ts
// frontend/config/editplan/apply.ts
import ConnectionManager from '@/config/connectionmanager';
import { EditPlanDataType, ApplyResult, EditPlan } from './types';
import { analyzeEdit } from './analyzer';
import { writeMeasurementsSummary } from './writers/measurementssummary';
import { writeFailedMeasurements } from './writers/failedmeasurements';
import { buildMeasurementScopeLockName, MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS } from '@/config/measurementscopelock';
import { ensureEditOperationsTable, writeEditOperation } from '@/config/editoperations';

export class ScopeLockHeldError extends Error { name = 'ScopeLockHeldError'; }
export class HashDriftError extends Error {
  constructor(public freshPlan: EditPlan) { super('plan hash drift'); this.name = 'HashDriftError'; }
}

export interface ApplyInput {
  dataType: EditPlanDataType;
  schema: string;
  plotID: number;
  censusID: number;
  targetID: number;
  newRow: Record<string, unknown>;
  expectedPlanHash: string | null; // null for server-internal callers that already did a batch-level hash check
  operationType?: 'single-row-edit' | 'bulk-revision-row' | 'revert';
  revertable?: boolean;
  writeLedger?: boolean;
  createdBy: string;
}

export async function applyEdit(cm: ConnectionManager, input: ApplyInput): Promise<ApplyResult> {
  const txID = await cm.beginTransaction();
  try {
    const acquired = await cm.acquireApplicationLock(
      buildMeasurementScopeLockName(input.schema, input.plotID, input.censusID),
      txID,
      MEASUREMENT_SCOPE_LOCK_TIMEOUT_MS
    );
    if (!acquired) throw new ScopeLockHeldError('scope locked');

    const result = await applyEditInTransaction(cm, { ...input, transactionID: txID });
    await cm.commitTransaction(txID);
    return result;
  } catch (err) {
    try { await cm.rollbackTransaction(txID); } catch { /* rollback best-effort */ }
    throw err;
  }
}

export interface ApplyInTransactionInput extends ApplyInput {
  transactionID: string;
}

export async function applyEditInTransaction(cm: ConnectionManager, input: ApplyInTransactionInput): Promise<ApplyResult> {
  await ensureEditOperationsTable(cm, input.schema, input.transactionID);

  const freshPlan = await analyzeEdit(cm, input.schema, input.dataType, input.plotID, input.censusID, input.targetID, input.newRow, input.transactionID);

  if (input.expectedPlanHash !== null && freshPlan.planHash !== input.expectedPlanHash) {
    throw new HashDriftError(freshPlan);
  }

  const writer = input.dataType === 'measurementssummary' ? writeMeasurementsSummary : writeFailedMeasurements;
  const { updatedIDs, beforeState, afterState, postValidation, validationPending } = await writer(cm, input, freshPlan, input.transactionID);

  let editOperationID: number | null = null;
  if (input.writeLedger !== false) {
    editOperationID = await writeEditOperation(cm, input.schema, {
      operationType: input.operationType ?? 'single-row-edit',
      dataType: input.dataType,
      targetID: input.targetID,
      plotID: input.plotID,
      censusID: input.censusID,
      planHash: freshPlan.planHash,
      beforeState,
      afterState,
      revertable: input.revertable ?? input.operationType !== 'bulk-revision-row',
      createdBy: input.createdBy
    }, input.transactionID);
  }

  return { updatedIDs, applyErrors: [], editOperationID, validationPending, postValidation };
}
```

- [ ] **Step 2: Tests**

```ts
// frontend/config/editplan/apply.test.ts
import { describe, it, expect, vi } from 'vitest';
import { applyEdit, applyEditInTransaction, HashDriftError, ScopeLockHeldError } from './apply';

vi.mock('./analyzer', () => ({ analyzeEdit: vi.fn() }));
vi.mock('./writers/measurementssummary', () => ({ writeMeasurementsSummary: vi.fn() }));
vi.mock('@/config/editoperations', () => ({ ensureEditOperationsTable: vi.fn(), writeEditOperation: vi.fn(async () => 99) }));

import * as analyzer from './analyzer';
import * as writer from './writers/measurementssummary';

function makeCM(opts: { lockAcquired: boolean }) {
  return {
    beginTransaction: vi.fn(async () => 'tx'),
    commitTransaction: vi.fn(),
    rollbackTransaction: vi.fn(),
    acquireApplicationLock: vi.fn(async () => opts.lockAcquired),
    executeQuery: vi.fn(),
    closeConnection: vi.fn()
  } as any;
}

const baseInput = { dataType: 'measurementssummary' as const, schema: 's', plotID: 1, censusID: 1, targetID: 1, newRow: {}, expectedPlanHash: 'x', createdBy: 't' };

describe('applyEdit', () => {
  it('throws ScopeLockHeldError when lock not acquired', async () => {
    const cm = makeCM({ lockAcquired: false });
    await expect(applyEdit(cm, baseInput)).rejects.toBeInstanceOf(ScopeLockHeldError);
    expect(cm.rollbackTransaction).toHaveBeenCalled();
  });

  it('throws HashDriftError when planHash mismatches', async () => {
    const cm = makeCM({ lockAcquired: true });
    (analyzer.analyzeEdit as any).mockResolvedValue({ planHash: 'other' });
    await expect(applyEdit(cm, baseInput)).rejects.toBeInstanceOf(HashDriftError);
  });

  it('writes ledger and commits on success', async () => {
    const cm = makeCM({ lockAcquired: true });
    (analyzer.analyzeEdit as any).mockResolvedValue({ planHash: 'x' });
    (writer.writeMeasurementsSummary as any).mockResolvedValue({ updatedIDs: { CoreMeasurementID: 1 }, beforeState: [], afterState: [], validationPending: true });
    const result = await applyEdit(cm, baseInput);
    expect(result.editOperationID).toBe(99);
    expect(cm.commitTransaction).toHaveBeenCalled();
  });

  it('applyEditInTransaction reuses the provided transaction and lock ownership', async () => {
    const cm = makeCM({ lockAcquired: true });
    (analyzer.analyzeEdit as any).mockResolvedValue({ planHash: 'x' });
    (writer.writeMeasurementsSummary as any).mockResolvedValue({ updatedIDs: { CoreMeasurementID: 1 }, beforeState: [], afterState: [], validationPending: true });
    await applyEditInTransaction(cm, { ...baseInput, transactionID: 'outer-tx' });
    expect(cm.beginTransaction).not.toHaveBeenCalled();
    expect(cm.acquireApplicationLock).not.toHaveBeenCalled();
    expect(cm.commitTransaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add frontend/config/editplan/apply.ts frontend/config/editplan/apply.test.ts
git commit -m "Add editplan apply helper with lock, drift check, and ledger writer"
```

---

### Task 8: Apply writer — measurementssummary variant

**Goal:** Port the mutating behavior that today lives in `coreapifunctions.ts::PATCH` (lines 301–617) into a dedicated writer. This includes SpeciesCode re-link, tree/stem resolution (mutating helpers), coremeasurements update, stem coord update, cmattributes rebuild, raw-column sync, treestemstate recompute, validation reset, and materialized-view refresh.

**Files:**
- Create: `frontend/config/editplan/writers/measurementssummary.ts`
- Create: `frontend/config/editplan/writers/measurementssummary.test.ts`

**Acceptance Criteria:**
- [ ] Writer receives `(cm, input, plan, txID)` and returns `{ updatedIDs, beforeState, afterState, validationPending, postValidation? }`.
- [ ] Reuses the existing mutating resolvers from `coreapifunctions.ts` (extract them to a shared helper module, `frontend/config/editplan/writers/resolvers-mutating.ts`, then `coreapifunctions.ts::PATCH` for non-measurement dataTypes imports from there).
- [ ] Calls `refreshMeasurementViewsForScope` when any identity field changed (same behavior as revision-apply).
- [ ] Populates `beforeState` and `afterState` with the coremeasurements row and every secondary write needed for exact revert (`stems`, `trees`, `cmattributes`, validation rows affected by reset, and materialized refresh markers where applicable). Newly inserted rows are represented as `beforeState.row = null`; deleted rows are represented as `afterState.row = null`.
- [ ] `validationPending: true` is returned unless a sync-validation step is run (phase-1 we mark pending; later phase can tighten).
- [ ] Integration tests: single-field DBH edit updates only coremeasurements; TreeTag edit creates/reuses tree and rewrites StemGUID; StemLocalX edit updates stems row; attributes edit rewrites cmattributes.

**Verify:** `cd frontend && npm run test:integration -- config/editplan/writers/measurementssummary` → pass.

**Steps:**

- [ ] **Step 1: Extract mutating resolvers** from `coreapifunctions.ts` (lines 72–271) into `frontend/config/editplan/writers/resolvers-mutating.ts` — keep identical behavior, remove from `coreapifunctions.ts`, update its imports.

- [ ] **Step 2: Port `measurementssummary` branch** (`coreapifunctions.ts` lines 301–617). The writer receives `plan.fieldChanges` so it can run only the branches relevant to changed fields (mirroring today's `hasUpdatedField` gates).

- [ ] **Step 3: Build `beforeState` / `afterState`** by SELECTing the affected rows before and after mutations. Include all secondary rows that Task 10 must restore; do not limit capture to `coremeasurements`.

- [ ] **Step 4: Integration tests** use `setupTestDatabase` + `seedMinimalFixture` and assert exact table state after each scenario (DBH-only, TreeTag, StemLocalX, Attributes).

- [ ] **Step 5: Commit**

```bash
git add frontend/config/editplan/writers/
git commit -m "Add measurementssummary writer porting current PATCH behavior into editplan apply"
```

---

### Task 9: Apply writer — failedmeasurements variant

**Goal:** Port the `failedmeasurements` branch from `coreapifunctions.ts::PATCH` (lines 628–705) into the editplan writer layer.

**Files:**
- Create: `frontend/config/editplan/writers/failedmeasurements.ts`
- Create: `frontend/config/editplan/writers/failedmeasurements.test.ts`

**Acceptance Criteria:**
- [ ] Updates raw columns on `coremeasurements` where `StemGUID IS NULL`, normalizes `Date` to `YYYY-MM-DD`, resets `IsValidated`, calls `refreshIngestionErrorsForMeasurement` inside the same transaction.
- [ ] Builds `beforeState` / `afterState` consistent with the shape used by measurementssummary writer, including ingestion-error/validation rows refreshed by the failed-row writer when they are part of the reversible state.
- [ ] Integration test edits a failed row, asserts raw columns updated, error log refreshed, row still has `StemGUID IS NULL`.

**Verify:** `cd frontend && npm run test:integration -- config/editplan/writers/failedmeasurements` → pass.

**Steps:** Mirror Task 8's pattern. Commit:

```bash
git add frontend/config/editplan/writers/failedmeasurements.ts \
        frontend/config/editplan/writers/failedmeasurements.test.ts
git commit -m "Add failedmeasurements writer in editplan apply layer"
```

---

### Task 10: Revert helper

**Goal:** Restore a single-row edit from the full `edit_operations` ledger, including every secondary table captured in `beforeState`/`afterState`.

**Files:**
- Create: `frontend/config/editplan/revert.ts`
- Create: `frontend/config/editplan/revert.test.ts`

**Acceptance Criteria:**
- [ ] `revertEdit(cm, { schema, plotID, censusID, editOperationID, createdBy })` reads the ledger and rejects `revertable === false`, `operationType === 'bulk-revision-row'`, missing records, and records outside the requested plot/census.
- [ ] Revert acquires the same measurement scope lock and owns one transaction. It does not call `applyEdit`; it calls `restoreLedgerStateInTransaction` so it can restore all recorded tables instead of only a `coremeasurements` diff.
- [ ] `restoreLedgerStateInTransaction` consumes `beforeState`/`afterState` rows, validates the current DB still matches the recorded `afterState` for each affected row, then restores every `beforeState` row in dependency-safe order: `cmattributes` delete/reinsert, `stems` coordinate/status restore, `trees` restore/deactivate inserted rows, `coremeasurements` restore, validation/materialized rows refresh.
- [ ] The revert operation writes a new `edit_operations` row with `operationType: 'revert'`, `revertable: false`, `beforeState` equal to the current rows before revert, and `afterState` equal to rows after restore.
- [ ] After success, `markEditOperationReverted(originalID, newEditOperationID)` runs inside the same tx.
- [ ] Rejects when the target ledger entry was already reverted (`revertedByEditOperationID` not null).
- [ ] Integration tests cover: DBH edit revert; StemLocalX/Y edit revert restores `stems`; Attributes edit revert rebuilds `cmattributes`; TreeTag/StemTag identity edit revert handles created/relinked tree/stem state or rejects as non-revertable if the writer cannot safely restore it; ledger pointer linked.

**Verify:** `cd frontend && npm run test:integration -- config/editplan/revert` → pass.

**Steps:** Implement with TDD pattern from prior tasks. Revert code must use the ledger state rows as the restore source of truth, not a synthetic `newRow` diff. Commit:

```bash
git add frontend/config/editplan/revert.ts frontend/config/editplan/revert.test.ts
git commit -m "Add revert helper reconstructing edits from edit_operations ledger"
```

---

### Task 11: HTTP endpoints (preview / apply / revert)

**Goal:** Thin Next.js route handlers that translate HTTP <-> editplan library.

**Files:**
- Create: `frontend/app/api/edits/preview/route.ts`
- Create: `frontend/app/api/edits/apply/route.ts`
- Create: `frontend/app/api/edits/revert/route.ts`
- Create: `frontend/config/editplan/scopeguard.ts`
- Create: `frontend/app/api/edits/preview/route.test.ts`
- Create: `frontend/app/api/edits/apply/route.test.ts`
- Create: `frontend/app/api/edits/revert/route.test.ts`

**Acceptance Criteria:**
- [ ] All three routes: `export const runtime = 'nodejs'`, authenticated via `auth()`, validate body with zod, enforce schema validity via `isValidSchema`, call `assertCanEditMeasurementScope(session, schema, plotID, censusID)`, and never trust client `oldRow`.
- [ ] `scopeguard.ts` exports `assertCanEditMeasurementScope`, `assertNoActiveMeasurementScopeConflict`, and `assertTargetInScope`. `assertTargetInScope` checks `coremeasurements.CoreMeasurementID`, `coremeasurements.CensusID`, and `census.PlotID`; failed rows must also satisfy `StemGUID IS NULL`, measurement rows `StemGUID IS NOT NULL`.
- [ ] `/preview`: no-writes path — calls `assertNoActiveMeasurementScopeConflict` before `analyzeEdit`, calls `assertTargetInScope`, and then calls `analyzeEdit` with no transaction. Returns `EditPlan`. 400 on bad body, 401 unauthenticated, 403 unauthorized scope, 404 target outside scope, 422 on `DisallowedFieldError`, `InvalidClearError`, or `SpeciesNotFoundError`, 423 on active upload/validation conflict.
- [ ] `/apply`: body `{ schema, plotID, censusID, dataType, targetID, newRow, planHash }`. Rejects public `bypassPreview` flags. Calls the same scope guards, then `applyEdit` with `expectedPlanHash: body.planHash`. Translates exceptions: `HashDriftError` → 409 with `{ freshPlan }`; `ScopeLockHeldError` → 423; `DisallowedFieldError` / `InvalidClearError` / `SpeciesNotFoundError` → 422; `TargetScopeError` → 404.
- [ ] `/revert`: body `{ schema, plotID, censusID, editOperationID }`. Calls the same scope guards, then `revertEdit`. Same error translation.
- [ ] Each route test file asserts: 401 without session; 400 on bad body; 403 on unauthorized plot/census; 404 on target outside requested scope; 422 on disallowed/invalid-clear field; 423 on active upload/validation conflict for preview; 409 on stale hash; 200 on happy path with shape match.

**Verify:** `cd frontend && npm run test:integration -- app/api/edits` → pass.

**Steps:**

- [ ] **Step 1: Implement `/preview/route.ts`** using zod:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import ConnectionManager from '@/config/connectionmanager';
import { isValidSchema } from '@/config/utils/sqlsecurity';
import { analyzeEdit, DisallowedFieldError, TargetScopeError } from '@/config/editplan/analyzer';
import { InvalidClearError } from '@/config/editplan/fieldpolicy';
import { assertCanEditMeasurementScope, assertNoActiveMeasurementScopeConflict, assertTargetInScope, ScopeAccessError, ScopeBusyError } from '@/config/editplan/scopeguard';
import { SpeciesNotFoundError } from '@/config/editplan/rules/context';

export const runtime = 'nodejs';

const Body = z.object({
  schema: z.string(),
  plotID: z.number().int().positive(),
  censusID: z.number().int().positive(),
  dataType: z.enum(['measurementssummary', 'failedmeasurements']),
  targetID: z.number().int().positive(),
  newRow: z.record(z.unknown())
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad body', details: parsed.error.flatten() }, { status: 400 });
	  const body = parsed.data;
	  if (!isValidSchema(body.schema)) return NextResponse.json({ error: 'invalid schema' }, { status: 400 });

	  const cm = ConnectionManager.getInstance();
	  try {
	    await assertCanEditMeasurementScope(cm, session, body.schema, body.plotID, body.censusID);
	    await assertNoActiveMeasurementScopeConflict(cm, body.schema, body.plotID, body.censusID);
	    await assertTargetInScope(cm, body.schema, body.dataType, body.plotID, body.censusID, body.targetID);
	    const plan = await analyzeEdit(cm, body.schema, body.dataType, body.plotID, body.censusID, body.targetID, body.newRow);
	    return NextResponse.json(plan, { status: 200 });
	  } catch (err) {
	    if (err instanceof ScopeAccessError) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
	    if (err instanceof ScopeBusyError) return NextResponse.json({ error: 'scope busy' }, { status: 423 });
	    if (err instanceof TargetScopeError) return NextResponse.json({ error: 'target not found' }, { status: 404 });
	    if (err instanceof DisallowedFieldError) return NextResponse.json({ error: 'disallowed fields', fields: err.fields }, { status: 422 });
	    if (err instanceof InvalidClearError) return NextResponse.json({ error: 'invalid clear', field: err.field }, { status: 422 });
	    if (err instanceof SpeciesNotFoundError) return NextResponse.json({ error: 'species not found', code: err.code }, { status: 422 });
	    throw err;
  } finally {
    await cm.closeConnection();
  }
}
```

- [ ] **Step 2: Implement `/apply/route.ts`** (same pattern, includes `planHash`, calls `assertCanEditMeasurementScope` + `assertTargetInScope`; `applyEdit` performs the exclusive lock and translates `ScopeLockHeldError` to 423).

- [ ] **Step 3: Implement `/revert/route.ts`**.

- [ ] **Step 4: Integration tests** follow existing patterns in `app/api/revisionupload/apply/route.test.ts`, including unauthorized scope, target outside scope, preview 423 on active upload/validation run, and invalid-clear 422.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/api/edits/ frontend/config/editplan/scopeguard.ts
git commit -m "Add /api/edits/{preview,apply,revert} endpoints"
```

---

### Task 12: Shared preview dialog + undo toast + row-menu revert

**Goal:** The React surface everything else consumes.

**Files:**
- Create: `frontend/components/editplan/previewdialog.tsx`
- Create: `frontend/components/editplan/impactsummary.tsx`
- Create: `frontend/components/editplan/editeffectrow.tsx`
- Create: `frontend/components/editplan/undotoast.tsx`
- Create: `frontend/components/editplan/revertmenuitem.tsx`
- Create: `frontend/hooks/useEditPreviewFlow.ts`
- Create: `frontend/components/editplan/previewdialog.test.tsx`

**Acceptance Criteria:**
- [ ] `PreviewDialog` props: `{ plan: EditPlan; onConfirm: () => Promise<void>; onCancel: () => void; busy: boolean }`. Renders field diff + effects grouped by severity (destructive > warn > info) + Cancel/Apply footer. No typed-confirm on single-row.
- [ ] `ImpactSummary` props: `{ bulkPlan: BulkEditPlan; onConfirm: () => Promise<void>; typedConfirmRequired: boolean }`. Gates Apply button behind an `APPLY {N}` input when `bulkPlan.maxSeverity === 'destructive'`.
- [ ] `UndoToast` props: `{ editOperationID: number; onUndo: () => Promise<void>; timeoutMs?: number }`. Dismisses on click or timeout; shows "Undo" button.
- [ ] `RevertMenuItem` props: `{ editOperationID: number | null; createdAt: string | null; onRevert: () => Promise<void> }`. Disabled when `editOperationID === null`.
- [ ] `useEditPreviewFlow({ schema, plotID, censusID, dataType, surface })` returns `{ beginEdit(newRow, oldRowHint?): Promise<ApplyResult> }` that handles: preview → decide → dialog or inline apply → undo toast only when `editOperationID !== null` → 409 re-render.
- [ ] Cypress component tests for `PreviewDialog`: shows destructive effects first; Apply disabled while busy; Cancel fires callback.

**Verify:** `cd frontend && npm run test:component -- components/editplan` → pass.

**Steps:** Write the components; each has tests; keep props well-typed. Commit:

```bash
git add frontend/components/editplan/ frontend/hooks/useEditPreviewFlow.ts
git commit -m "Add shared preview dialog, impact summary, undo toast, and revert menu components"
```

---

### Task 13: Wire measurement datagrid (measurementscommons.tsx)

**Goal:** Replace the direct PATCH-on-Save flow with `useEditPreviewFlow`. Narrow `isCellEditable`. Make `SpeciesName` and `SubspeciesName` read-only.

**Files:**
- Modify: `frontend/components/datagrids/measurementscommons.tsx`
- Modify: `frontend/components/datagrids/measurementscommons.test.tsx`
- Modify: `frontend/components/client/datagridcolumns.tsx` (if column defs live there)

**Acceptance Criteria:**
- [ ] On grid row save: `useEditPreviewFlow` handles the handshake. If `maxSeverity === 'info'` the dialog is skipped.
- [ ] `SpeciesName` and `SubspeciesName` columns are `editable: false`.
- [ ] Internal ID columns (`CoreMeasurementID`, `SpeciesID`, `TreeID`, `StemGUID`, `QuadratID`, `PlotID`, `CensusID`) remain non-editable.
- [ ] Existing regression tests for inline edit still pass.

**Verify:** `cd frontend && npm run test:unit -- datagrids/measurementscommons` and `npm run test:component -- measurementscommons` → pass.

**Steps:** Replace the inline `updateRow` function (lines 696–793) with a `useEditPreviewFlow` call; delete dead imports; update column config. Commit:

```bash
git add frontend/components/datagrids/measurementscommons.tsx \
        frontend/components/datagrids/measurementscommons.test.tsx \
        frontend/components/client/datagridcolumns.tsx
git commit -m "Wire measurement datagrid to editplan preview/apply; lock taxonomy fields read-only"
```

---

### Task 14: Wire Errors Explorer

**Goal:** Replace the custom dialog flow in `errorsexplorer.tsx` with the shared `PreviewDialog` + `useEditPreviewFlow`.

**Files:**
- Modify: `frontend/components/errors/errorsexplorer.tsx`
- Modify: `frontend/components/errors/errorsexplorer.test.tsx`

**Acceptance Criteria:**
- [ ] `stripRowForUpdate` stays (it's a projection helper); the PATCH call at line ~497 is replaced with the flow hook.
- [ ] Tests cover the preview-then-confirm path.

**Verify:** `cd frontend && npm run test:component -- errorsexplorer` → pass.

**Steps:** Delete the in-file PATCH and generation counter (no longer needed — the hook handles staleness via `planHash`). Commit:

```bash
git add frontend/components/errors/errorsexplorer.tsx frontend/components/errors/errorsexplorer.test.tsx
git commit -m "Wire Errors Explorer to shared editplan preview dialog"
```

---

### Task 15: Wire failed-measurements grid

**Goal:** Same treatment, `dataType: 'failedmeasurements'`.

**Files:**
- Modify: `frontend/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid.tsx`
- Modify: `frontend/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid.test.tsx`

**Acceptance Criteria:**
- [ ] Grid `processRowUpdate` delegates to `useEditPreviewFlow({ dataType: 'failedmeasurements' })`.
- [ ] Existing tests for raw-column sync + error refresh still pass.

**Verify:** `cd frontend && npm run test:component -- isolatedfailedmeasurementsdatagrid` → pass.

**Steps:** Straightforward rewrite. Commit:

```bash
git add frontend/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid.tsx \
        frontend/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid.test.tsx
git commit -m "Wire failed-measurements grid to editplan preview/apply"
```

---

### Task 16: Revision upload — match endpoint returns BulkEditPlan + new UI summary

**Goal:** The match endpoint calls `analyzeBulk` and includes the `BulkEditPlan` alongside existing matched/invalid/new rows. The review screen renders `ImpactSummary`.

**Files:**
- Modify: `frontend/app/api/revisionupload/route.ts`
- Modify: `frontend/app/api/revisionupload/route.test.ts`
- Modify: `frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx`
- Modify: `frontend/config/revisionuploadtypes.ts` (add `bulkPlan: BulkEditPlan`)

**Acceptance Criteria:**
- [ ] Match response extended with `bulkPlan`; existing fields unchanged.
- [ ] Review screen renders aggregate effects above the matched-rows table.
- [ ] Per the row-local decision in the "Pre-implementation gap decisions" section, the bulk plan only ever contains R5 (attributes) and R6 (duplicates) effects for the current revision-upload surface. Identity rules (R1a/R2/R3/R4) remain dormant because `spcode`, `tag`, `stemtag`, `quadrat`, `lx`, `ly` are still in `IGNORED_EDIT_FIELDS`.
- [ ] Integration test: upload a CSV with Attributes changes on several rows, assert `bulkPlan.aggregateEffects` contains R5 with correct count.
- [ ] Integration test: upload a CSV that would cause duplicate survivor cleanup, assert `bulkPlan.aggregateEffects` contains R6 with `severity === 'destructive'`.

**Verify:** `cd frontend && npm run test:integration -- revisionupload` → pass.

**Steps:** After the match loop completes, build `analyzeBulk` input from matched + new + invalid + `duplicateMeasurementIDsToDelete` and include in response. Render `<ImpactSummary bulkPlan={...} />`. Commit:

```bash
git add frontend/app/api/revisionupload/route.ts frontend/app/api/revisionupload/route.test.ts \
        frontend/components/uploadsystem/segments/uploadrevisionmatch.tsx \
        frontend/config/revisionuploadtypes.ts
git commit -m "Return BulkEditPlan from revision match and render impact summary"
```

---

### Task 17: Revision upload apply — shared transactional primitive + typed confirm gate

**Goal:** The matched-row update loop in `revisionupload/apply/route.ts` owns one outer transaction and one measurement scope lock, then uses `applyEditInTransaction` for each matched row. Bulk UI gates the apply button on `APPLY {N}` typed confirm when `bulkPlan.maxSeverity === 'destructive'`.

**Files:**
- Modify: `frontend/app/api/revisionupload/apply/route.ts`
- Modify: `frontend/app/api/revisionupload/apply/route.test.ts`
- Modify: `frontend/components/uploadsystem/segments/uploadrevisionapply.tsx`

**Acceptance Criteria:**
- [ ] Apply route begins one outer transaction, acquires the measurement scope lock once, hash-checks the submitted `BulkEditPlan.planHash`, and calls `applyEditInTransaction` for each matched row with `expectedPlanHash: null`, `operationType: 'bulk-revision-row'`, and `revertable: false`.
- [ ] The route must not call `applyEdit` in a loop. Row-level writes, duplicate deletion, and new-row ingestion all commit or roll back as one unit.
- [ ] `BulkEditPlan.planHash` is compared at apply-start against the client-submitted hash; mismatch → 409 with fresh bulk plan.
- [ ] Failed-row inserts via `bulkingestionprocess` path unchanged.
- [ ] Typed confirm gate on UI when `maxSeverity === 'destructive'`.
- [ ] Integration tests extended: destructive-batch apply requires the typed gate (UI); apply works with no destructive effects without gate; stale bulk hash returns 409; one row failure rolls back prior matched-row edits and duplicate deletions.

**Verify:** `cd frontend && npm run test:integration -- revisionupload/apply` and `npm run test:component -- uploadrevisionapply` → pass.

**Steps:** Refactor the per-row `UPDATE coremeasurements ... SET ...` block to call `applyEditInTransaction` inside the existing revision-apply transaction after acquiring the scope lock once. Add the typed gate to the UI button. Commit:

```bash
git add frontend/app/api/revisionupload/apply/route.ts \
        frontend/app/api/revisionupload/apply/route.test.ts \
        frontend/components/uploadsystem/segments/uploadrevisionapply.tsx
git commit -m "Route revision apply matched rows through shared editplan apply + typed destructive gate"
```

---

### Task 18: Compatibility shim + remove SpeciesName rename branch

**Goal:** Keep legacy `PATCH /api/fixeddata/measurementssummary/...` callers working temporarily; remove the species-row rename behavior entirely.

**Files:**
- Modify: `frontend/config/macros/coreapifunctions.ts`
- Modify: `frontend/config/macros/coreapifunctions.test.ts`

**Acceptance Criteria:**
- [ ] For `dataType === 'measurementssummary' || 'failedmeasurements'`, PATCH forwards to an internal helper that calls `applyEdit` with `expectedPlanHash: null` (internal-bypass only). No `bypassPreview` flag is accepted from the request body.
- [ ] The `UPDATE species SET SpeciesName = ?` branch (lines 337–351) is removed.
- [ ] Existing measurement-PATCH tests still pass, verifying the shim routes cleanly.
- [ ] Regression test: a request attempting to send `SpeciesName` in `newRow` is rejected by the field-policy allowlist in `analyzeEdit`.

**Verify:** `cd frontend && npm run test:unit -- coreapifunctions` → pass.

**Steps:** Delete the relevant lines; wire the shim. Commit:

```bash
git add frontend/config/macros/coreapifunctions.ts frontend/config/macros/coreapifunctions.test.ts
git commit -m "Convert measurement PATCH to shim over editplan apply; drop species rename branch"
```

---

### Task 19: End-to-end Cypress tests + integration drift/lock sweep + migration registration

**Goal:** Integration + Cypress coverage matching the spec's "Testing" section.

**Files:**
- Create: `frontend/cypress/component/editplan-preview-dialog.cy.tsx`
- Create: `frontend/cypress/e2e/row-edit-ramification.cy.ts`
- Create: `frontend/tests/integration/editplan-drift-and-lock.integration.test.ts`
- Modify: `frontend/db-migrations/unified-measurements-migrations/run-migrations.sh` (only if ordering tweaks are needed — new `54_*.sql` should pick up automatically).

**Acceptance Criteria:**
- [ ] Cypress e2e: researcher edits TreeTag on a measurement → preview dialog appears → apply → undo toast → click Undo → measurement reverts.
- [ ] Cypress e2e: bulk revision upload with destructive effects → typed confirm required → apply works.
- [ ] Integration test: preview `/api/edits/preview`, out-of-band UPDATE, apply → 409 with fresh plan.
- [ ] Integration test: hold the measurement scope lock in one connection, attempt apply → 423.
- [ ] Integration test: active upload session or validation run makes preview return 423 without acquiring the exclusive lock.
- [ ] Integration test: target row from a different plot/census returns 404 and unauthorized plot/census returns 403.
- [ ] Integration test: revision apply rolls back all matched-row updates and duplicate deletions when any `applyEditInTransaction` call fails.
- [ ] Integration test: revert restores secondary table side effects (`stems`, `cmattributes`) or rejects explicitly non-revertable identity/bulk operations.
- [ ] Integration test: migration 54 registered in the runner and runs cleanly on a fresh schema.
- [ ] Regression: the full test suite green.

**Verify:**
```
cd frontend && npm run test:all
```

**Steps:** Add the Cypress specs; extend the integration suite. Commit:

```bash
git add frontend/cypress/ frontend/tests/integration/editplan-drift-and-lock.integration.test.ts
git commit -m "Add end-to-end and drift/lock integration coverage for editplan flows"
```

---

## Task Dependencies

- Task 0 → blocks Tasks 7, 10 (ledger)
- Task 1 → blocks all subsequent tasks (types)
- Task 2 → blocks Tasks 3, 4 (resolvers)
- Tasks 3, 4, 5 → block Task 6 (analyzer glue)
- Task 6 → blocks Tasks 7, 11 (apply, endpoints)
- Task 7 → blocks Tasks 8, 9, 10, 11
- Tasks 8, 9 → block Task 11
- Task 10 → blocks Task 11 (`/revert`)
- Task 11 → blocks Tasks 12, 13, 14, 15, 16, 17 (surfaces consume endpoints)
- Task 12 → blocks Tasks 13, 14, 15, 17
- Task 16 → blocks Task 17
- Tasks 13–17 → block Task 18 (shim removal safe only after surfaces migrated)
- Task 18 → blocks Task 19 (end-to-end covers final state)
