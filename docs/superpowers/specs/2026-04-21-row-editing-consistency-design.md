# Row Editing Consistency and Ramification Surfacing

**Date:** 2026-04-21
**Status:** Draft
**Related spec:** [2026-04-14-measurement-revision-upload-design.md](./2026-04-14-measurement-revision-upload-design.md)

## Problem

Researchers edit measurement rows through four different surfaces today: the inline datagrid on the measurements view (`measurementscommons.tsx`), the Errors Explorer dialog (`components/errors/errorsexplorer.tsx`), the failed-measurements grid (`isolatedfailedmeasurementsdatagrid.tsx`), and the bulk revision CSV upload (`/api/revisionupload` + `/api/revisionupload/apply`, from the 2026-04-14 spec). Each surface reaches the database through a different code path, and all of them trigger downstream side effects silently.

The current `config/macros/coreapifunctions.ts::PATCH` handler performs several operations that affect rows other than the one the user is editing, with no user-visible indication at edit time:

- A `SpeciesName` or `SubspeciesName` cell edit on a measurement writes to the shared `species` row, renaming the species across every measurement and every census that references it.
- A `TreeTag`, `StemTag`, or `QuadratName` edit re-resolves the measurement to a different `TreeID` / `StemGUID`, potentially creating a new tree or stem and leaving the old one with no remaining children.
- A `StemLocalX` or `StemLocalY` edit writes to the `stems` row, so every measurement/materialized row that references that stem row gets the new coordinate.
- An `Attributes` edit deletes and re-inserts rows in `cmattributes`.
- The revision apply endpoint can delete duplicate measurements for a stem as part of survivor selection.

Researchers cannot see any of this at the time they commit the edit. Mistakes are recoverable only via the Recent Changes Explorer, after the fact. This design adds a forward guard (preview before save) and a backward guard (per-edit revert for single-row edits) with a single source of truth that all four surfaces share.

## Scope

In scope:

- Editing surfaces that mutate `coremeasurements` (and joined `stems` / `trees` / `cmattributes` rows): the measurement datagrid inline edit, the Errors Explorer row edit, the failed-measurements grid inline edit, and the revision CSV upload apply flow.

Out of scope:

- Non-measurement editing surfaces: species, quadrats, attributes, personnel, roles, sites, users, plots. Those retain the existing `PATCH /api/fixeddata/[dataType]` behavior unchanged.
- A batch-level revert for bulk revision uploads. Recovery for bulk applies stays via the Recent Changes Explorer.

## Design Decisions

### Pre-implementation gaps that must be resolved

This review identified several places where the design is not yet implementation-ready. They are called out here so follow-up planning does not lose them:

- **Revert source of truth.** `unifiedchangelog` is an audit feed, not a reliable undo ledger. The current changelog logger queues entries asynchronously after commit and records table-level changes, so `/api/edits/apply` cannot reliably return a single `changelogID` that represents the whole user edit. This spec therefore needs a synchronous edit-operation ledger before the undo affordance is implemented.
- **Preview/apply separation.** The current measurement PATCH path mixes resolution and mutation. Tree/stem resolution can create rows, coordinate edits update `stems`, and attributes delete/reinsert `cmattributes`. The analyzer must be a pure no-write planner, with apply as the only place that mutates data.
- **Revision upload breadth.** The 2026-04-14 revision upload design intentionally supports only row-local matched-row fields (`dbh`, `hom`, `date`, `codes`, `comments`) and surfaces identity columns as ignored edits. This plan must explicitly decide whether bulk revision remains row-local in this phase or expands to support identity changes (`spcode`, `tag`, `stemtag`, `quadrat`, `lx`, `ly`). The rule catalog and bulk UI depend on that decision.
- **Locking semantics.** The existing measurement-scope lock is an exclusive MySQL `GET_LOCK`. A read-level lock does not exist yet. Preview must either take no lock and rely on apply-time drift detection, take the same exclusive lock, or introduce a real shared/read lock.
- **Field allowlist.** The editable field set differs by surface today, and the measurement grid currently exposes internal IDs as editable. This design needs an explicit field allowlist per surface and a matching server-side allowlist.
- **Post-validation response.** Synchronous `newErrors` / `clearedErrors` are only accurate if apply runs validations before returning. If validation remains background or deferred, the response should report `validationPending` instead.

### Ramification categories that surface at edit time

Cross-row and identity-changing effects are surfaced. Purely local effects that affect only the edited row are not shown. Validation invalidation and ingestion-error refresh are silent always: they always happen after any measurement edit, have no destructive impact, and add noise if displayed.

Identity changes (which tree / stem / species the measurement belongs to) get the highest severity tier because they are the category researchers most often want to catch before committing.

### Dialog gating

- **Single-row edit.** When the analyzer returns `maxSeverity === 'info'` (or the effect list is empty after filtering out silent rules), the edit saves inline with no dialog. Otherwise, the preview dialog opens and the user confirms once.
- **Bulk revision upload.** The existing `REVISION_MATCH` screen gains an aggregated impact summary. When any effect in the batch is `destructive`, the apply button is gated behind a typed confirmation (`APPLY {N}` where `N` is the row count).

### Revert affordance for single-row edits

Per-edit revert uses a synchronous edit-operation ledger created inside the same transaction as the edit. `unifiedchangelog` remains the audit / Recent Changes feed, but it is not the source of truth for undo because its entries are asynchronous and table-level. Revert is available via two surfaces:

- A success toast shown on every successful single-row edit, with an "Undo" button.
- A row-action menu item ("Revert last edit", with a timestamp) reachable from the three-dot menu on any row that has a revertable edit in its history.

Bulk revision applies do not get a revert affordance in this phase.

### Species editing behavior change

The measurement datagrid currently lets researchers edit `SpeciesCode`, `SpeciesName`, and `SubspeciesName` as separate cells. When `SpeciesName` or `SubspeciesName` is edited, the PATCH handler issues an `UPDATE species SET ...` against the resolved species row. This spec removes that branch and narrows the editable surface:

- `SpeciesCode` stays editable on the measurement grid and is the identity handle for re-linking.
- `SpeciesName` and `SubspeciesName` become read-only on the measurement grid. They reflect the linked species. To change a species definition, users go to the species fixed-data grid (out of scope for this spec, already existing).

Editing `SpeciesCode` is interpreted as "re-link this measurement to an existing species with the new code." If no species with the new code exists, the edit is rejected with a message directing the user to create the species in the fixed-data grid. No species rows are mutated from the measurement edit path after this change.

### Editable field allowlist

The server enforces the final editable field set; client column settings are only a UI convenience.

| Surface | Editable fields in this phase |
|---|---|
| Measurement grid | `SpeciesCode`, `TreeTag`, `StemTag`, `QuadratName`, `StemLocalX`, `StemLocalY`, `MeasurementDate`, `MeasuredDBH`, `MeasuredHOM`, `Description`, `Attributes` |
| Errors Explorer | Same as measurement grid, scoped to the error-row projection |
| Failed-measurements grid | Raw failed-row fields: `Tag`, `StemTag`, `SpCode`, `Quadrat`, `X`, `Y`, `DBH`, `HOM`, `Date`, `Codes`, `Comments` |
| Revision upload | Open decision: either keep the 2026-04-14 row-local set (`dbh`, `hom`, `date`, `codes`, `comments`) or explicitly expand the bulk apply path to support the identity fields above |

Internal IDs (`CoreMeasurementID`, `SpeciesID`, `TreeID`, `StemGUID`, `QuadratID`, `PlotID`, `CensusID`) are never editable through measurement row editing. `SpeciesName` and `SubspeciesName` are read-only on measurement editing surfaces.

### Blank, null, and clear semantics

The planner must not infer updates with ad hoc truthy checks. Each editable field needs one explicit policy:

| Field group | Blank input means | `null` input means |
|---|---|---|
| Identity fields (`SpeciesCode`, `TreeTag`, `StemTag`, `QuadratName`) | Invalid; do not allow clearing identity from a resolved measurement | Invalid unless a failed-row raw field explicitly supports it |
| Numeric measurement fields (`MeasuredDBH`, `MeasuredHOM`, `StemLocalX`, `StemLocalY`) | Clear only if the UI sends an explicit clear marker; otherwise no-op | Clear if the field policy allows nullable values |
| `MeasurementDate` | Invalid for resolved measurements | Invalid for resolved measurements |
| `Description` / comments | Clear if user explicitly clears the cell | Clear |
| `Attributes` / codes | Empty string means remove all codes after confirmation; no-op must be represented by omitting the field | Clear all codes |
| Revision upload blank cells | No-op for matched-row revisions, preserving the 2026-04-14 non-destructive merge behavior | No-op unless the revision format later adds an explicit clear marker |

This policy must be applied before hashing so preview and apply agree on what changed.

## Architecture

### `EditPlan` data model

The analyzer produces an `EditPlan` object that the single-row dialog renders from. Bulk revision uses `BulkEditPlan`, which is an aggregate of per-row `EditPlan` objects plus invalid/new-row bookkeeping:

```ts
type Severity = 'info' | 'warn' | 'destructive';

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warn: 1,
  destructive: 2
};

type EffectCategory = 'field' | 'cross-row' | 'identity' | 'destructive' | 'validation';

type Effect = {
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
};

type EditPlanDataType = 'measurementssummary' | 'failedmeasurements';

type EditPlan = {
  dataType: EditPlanDataType;
  fieldChanges: { field: string; from: unknown; to: unknown }[];
  effects: Effect[];
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
};

type BulkEditPlan = {
  dataType: EditPlanDataType;
  rowCount: number;
  rowPlans: Array<{
    rowIndex: number;
    targetID?: number;
    plan: EditPlan;
    status: 'matched' | 'new' | 'invalid' | 'unchanged';
    reason?: string;
  }>;
  aggregateEffects: Effect[];
  maxSeverity: Severity;
  planHash: string;
  generatedAt: string;
};
```

`maxSeverity` is computed with `SEVERITY_RANK`, not string comparison. The `planHash` is the SHA-256 of the canonicalized plan after removing volatile fields (`planHash`, `generatedAt`) and applying stable normalization:

- Object keys sorted recursively.
- Effect arrays sorted by `id`, `category`, `affectedTable`, and stable reference values.
- Reference arrays sorted and capped for response size; capped references include a server-side drill-down token when the UI needs to fetch the full list.
- Dates normalized to `YYYY-MM-DD` for date fields.
- Decimal-like values normalized to the database precision used by the target column.
- Empty string, `null`, and omitted fields normalized according to the per-field clear/no-op policy.

On apply, the server re-runs the analyzer against current DB state and compares hashes to detect drift.

### Ramification rules catalog

| ID | Trigger | Severity | Description |
|---|---|---|---|
| **R1a** | `SpeciesCode` edit resolves to a different existing `SpeciesID` | `warn` (identity) | Measurement re-linked from species A to species B. No species row is mutated. |
| **R1c** | `SpeciesCode` edit resolves to no existing species | (rejection, not effect) | Apply returns `422`. User is prompted to create the species in the fixed-data grid. |
| **R2** | `TreeTag` edit re-resolves to a different `TreeID`, or `SpeciesCode` change triggers a new tree | `warn` -> `destructive` if source tree becomes orphaned | Measurement reassigned from tree A to tree B. Severity promotes when tree A would have no remaining active stems/measurements after the edit. This is an orphaning warning; no delete is implied unless apply explicitly deletes/deactivates a row. |
| **R3** | `StemTag` / `QuadratName` edit re-resolves to a different `StemGUID` | `warn` -> `destructive` if source stem becomes orphaned | Measurement reassigned from stem A to stem B. Severity promotes when stem A would have no remaining active measurements after the edit. This is an orphaning warning; no delete is implied unless apply explicitly deletes/deactivates a row. |
| **R4** | `StemLocalX` or `StemLocalY` edit | `warn` (cross-row) | Stem coordinate propagates to every measurement/materialized row referencing that `stems` row. Because `stems` is census-scoped today, this is scoped to the current census unless a separate cross-census `StemCrossID` rule is added. |
| **R5** | `Attributes` / codes edit | `info`, or `destructive` when any previously-valid code is removed | `cmattributes` rows removed and re-inserted. |
| **R6** | Revision apply detects duplicate measurements for the stem in this census | `destructive` | Survivor selected, duplicates deleted. |
| **R9** | Revision CSV has two rows with the same match key | n/a (invalid row) | All colliding rows marked invalid so the user can reconcile before re-upload. This does not count as destructive because no DB mutation occurs. |

Silent rules — always run, never surfaced:

- **R7 Validation invalidation.** Any measurement edit clears `IsValidated` and marks the row for validation. If validation runs synchronously, errors appear in `measurement_error_log` before apply returns; otherwise apply returns `validationPending: true`.
- **R8 Ingestion-error refresh.** The existing `refreshIngestionErrorsForMeasurement` call runs on every edit.

`maxSeverity` is computed over the surfaced effects only (R7 and R8 never raise severity). R9 produces invalid-row entries in the bulk plan, not `Effect` entries, so it does not raise `maxSeverity`.

R1b (species row rename via measurement edit) is intentionally absent from this catalog. The behavior is removed as part of this spec (see "Species editing behavior change"). IDs R1b and R8-internal are reserved to keep existing references to these numbers unambiguous in the implementation plan.

### Analyzer/apply split

The shared `config/editplan/` library has two layers:

- **Planner/analyzer:** reads current DB state and returns `EditPlan` / `BulkEditPlan`. It must not call helpers that can insert, update, delete, refresh materialized tables, clear errors, or mutate validation state. Existing mutating helpers such as tree/stem resolution need read-only planner equivalents that can report `existingID`, `destinationID`, `wouldCreateTree`, `wouldCreateStem`, and orphan counts without writing.
- **Apply helper:** re-runs the analyzer inside the write lock, checks `planHash`, then performs the mutations in one transaction. Apply is the only layer allowed to create tree/stem rows, update `coremeasurements`, update `stems`, rebuild `cmattributes`, clear validation errors, reset validation state, refresh materialized views, or delete duplicate measurements.

This split is a hard requirement for `/api/edits/preview` no-write guarantees.

### Endpoints

`POST /api/edits/preview`
- Body: `{ schema, plotID, censusID, dataType: 'measurementssummary' | 'failedmeasurements', targetID, newRow, oldRowHint? }`
- Returns: `EditPlan`
- Requires authentication, validates schema and plot/census access, and enforces the server-side editable-field allowlist.
- Fetches the authoritative current row by `targetID`; `oldRowHint` is accepted only for client display/debug context and is not trusted for analysis.
- Checks for active upload / validation ownership of the same plot+census scope. Until a real shared/read lock exists, preview does not claim to hold a read lock; it relies on apply-time drift detection. If the implementation chooses to use the existing exclusive MySQL lock for preview, document that UX tradeoff explicitly.
- Returns `423 Locked` if the scope is held by an active upload, validation, or other measurement operation.
- Runs all applicable rules, including DB reads to determine orphan status and cascade counts. No writes.

`POST /api/edits/apply`
- Body: `{ schema, plotID, censusID, dataType, targetID, newRow, planHash }`
- Returns: `{ updatedIDs, applyErrors, editOperationID, validationPending, postValidation?: { newErrors, clearedErrors } }`
- Requires authentication, validates schema and plot/census access, and enforces the same server-side editable-field allowlist as preview.
- Acquires a write-level plot+census scope lock.
- Fetches the authoritative current row by `targetID` inside the transaction, re-runs the analyzer against current DB state, re-computes `planHash`, compares:
  - Match → apply the plan inside a transaction.
  - Mismatch → return `409 Conflict` with the fresh plan; client re-renders the dialog and re-confirms.
- Creates a synchronous `edit_operations` record inside the same transaction before commit. The returned `editOperationID` is the undo handle.
- `postValidation` is returned only when apply runs the relevant validation synchronously. If validation is deferred/background, `validationPending: true` is returned instead.
- `bypassPreview` is not a public request flag. It is an internal helper option available only to server-side compatibility shims and tests; production client requests cannot skip the hash comparison.

`POST /api/edits/revert`
- Body: `{ schema, plotID, censusID, editOperationID }`
- Looks up the synchronous edit-operation ledger entry, verifies the authenticated user can access the plot/census, and builds a restore `EditPlan` from the recorded before/after state.
- Revert calls the same apply helper used by normal edits. If the restore plan now has `warn` or `destructive` effects because the database moved on, the endpoint returns `409 Conflict` with that plan and the client asks for confirmation.

Both endpoints call into the shared `config/editplan/` library so the detection logic has one home.

### Edit-operation ledger

Undo requires a synchronous operation record that groups all table mutations caused by one user action. Add either a new table or an equivalent durable structure with this minimum shape:

```ts
type EditOperation = {
  editOperationID: number;
  operationType: 'single-row-edit' | 'revert';
  dataType: EditPlanDataType;
  targetID: number;
  schemaName: string;
  plotID: number;
  censusID: number;
  planHash: string;
  beforeState: Array<{ table: string; primaryKey: string; primaryKeyValue: unknown; row: Record<string, unknown> | null }>;
  afterState: Array<{ table: string; primaryKey: string; primaryKeyValue: unknown; row: Record<string, unknown> | null }>;
  createdBy: string;
  createdAt: string;
  revertedByEditOperationID?: number;
};
```

The ledger is written inside the same DB transaction as apply. It should record affected `coremeasurements`, `stems`, `trees`, `cmattributes`, and any materialized row deletes/refreshes needed for duplicate cleanup. `unifiedchangelog` can still be generated for audit visibility, but revert never depends on finding or grouping changelog rows.

### Surface wiring

| Surface | Current path | After |
|---|---|---|
| Datagrid inline edit (`measurementscommons.tsx::updateRow`) | `PATCH /api/fixeddata/measurementssummary/...` | On Save, calls `POST /api/edits/preview`; if `SEVERITY_RANK[maxSeverity] > SEVERITY_RANK.info`, opens the shared preview dialog; otherwise calls `POST /api/edits/apply` directly and commits the row. |
| Errors Explorer row edit (`errorsexplorer.tsx`) | Same PATCH route with custom dialog | Same flow as datagrid. Existing `stripRowForUpdate` stays; the dialog becomes a thin wrapper over the shared preview component. |
| Failed-measurements grid (`isolatedfailedmeasurementsdatagrid.tsx`) | PATCH with `dataType=failedmeasurements` branch | Also uses `/api/edits/preview` + `/api/edits/apply`, passing `dataType: 'failedmeasurements'`. The analyzer branches on `dataType` to run the failed-row variant of rule processing — raw-column sync, re-validation, and failure-reason refresh — that currently lives in `coreapifunctions.ts::PATCH` (lines 628–705). The `EditPlan` shape is identical; only the apply-time SQL differs. |
| Revision upload (`/api/revisionupload`, `/api/revisionupload/apply`) | Returns `matchedRows` with pre-computed `existingValues` + `changes` | Open decision. If bulk revision remains row-local, the analyzer only runs rules for row-local fields plus attributes, duplicate survivor cleanup, and invalid duplicate match keys. If bulk revision expands to identity fields, match and apply must be updated to support the full measurement edit allowlist, and the bulk response returns a `BulkEditPlan`. Per-row plans let the drill-down lists resolve to actual row IDs. |

The `PATCH /api/fixeddata/measurementssummary/...` route stays as a compatibility shim that calls the internal apply helper with server-only preview bypass. It does not expose `bypassPreview` as a public client flag. Once all client surfaces are migrated, the shim is removed in a follow-up PR. Non-measurement dataTypes (`attributes`, `species`, `quadrats`, `personnel`, `alltaxonomiesview`, `plots`) continue using the existing PATCH handler unchanged.

Client grids must also stop using broad `isCellEditable={() => !locked}` behavior for measurement rows. Column editability should mirror the allowlist above so IDs and read-only taxonomy labels cannot enter edit mode.

### Single-row preview dialog

Structure, top to bottom:

1. Field diff table: field name, from, to, one row per changed field.
2. Effects list, grouped by severity (destructive first, then warn, then info). Each effect shows a severity label, title, detail sentence, and optional drill-down link when `affectedRowCount > 1`.
3. Footer with a note about undo availability, a Cancel button, and an Apply button.

No typed-confirm gate on single-row destructive effects; the severity label and explanatory text carry the weight.

### Bulk summary screen

Additions to the existing `REVISION_MATCH` screen:

1. A stats strip (rows to update, new rows, unchanged/skipped, invalid).
2. An effects list of aggregated `Effect` entries, same severity grouping as the single-row dialog. Counts are batch-level ("22 measurements will be reassigned to a different tree"). Drill-down links open a side panel listing the actual affected rows.
3. When any effect is `destructive`, the apply button is disabled until the user types `APPLY {N}` in a confirmation input.

### Revert affordance

Every successful single-row apply produces an `edit_operations` ledger entry with enough information to reconstruct the pre-edit state (field values and any linked-row changes). Two revert entry points:

- **Toast.** Shown on every successful single-row edit; visible for ~12 seconds with an "Undo" button. Clicking it calls `POST /api/edits/revert` with the `editOperationID`.
- **Row menu.** A "Revert last edit" item on the row's three-dot action menu, showing the relative timestamp of the last revertable operation. Available as long as the edit-operation ledger entry exists and has not already been superseded by a later revert.

Both affordances hit the same revert endpoint. Revert is itself a normal edit that goes through the shared apply helper; the analyzer runs on the restore, producing its own plan, ledger entry, and audit changelog. If the revert would itself cause a destructive effect (rare, but possible if the world has moved on), the dialog opens and the user confirms.

Bulk revision applies do not get a revert affordance.

### Error responses

- `400 Bad Request`: malformed body, invalid schema format, invalid `targetID`, or unsupported `dataType`.
- `401 Unauthorized` / `403 Forbidden`: unauthenticated user or user lacks access to the requested schema/plot/census.
- `409 Conflict`: planHash mismatch. Body includes the fresh `EditPlan`. Client re-renders.
- `423 Locked`: plot+census scope lock held by another process. Body includes holder description. Client surfaces a retry-in-a-moment message.
- `422 Unprocessable`: server-side field allowlist rejection, clear/no-op policy rejection, or rule R1c fired (species not found). Body lists safe user-actionable details such as unknown species codes. Dialog directs the user to the species grid when appropriate.
- `500`: an unexpected SQL or internal failure during apply. Transaction rolls back. Response includes a safe message and request/edit trace ID; detailed SQL and rule diagnostics stay in server logs.

Successful applies that run validation synchronously and surface new post-validation errors return `200` with `postValidation: { newErrors, clearedErrors }` in the body; the toast communicates this without treating the apply as a failure. If validation is deferred, successful applies return `200` with `validationPending: true`.

## Testing

### Unit tests — `config/editplan/` library (Vitest)

- Per-rule tests for R1a, R1c, R2, R3, R4, R5, R6 with representative `(oldRow, newRow, dbSnapshot)` fixtures. Each asserts the exact `Effect` (category, severity, counts, references).
- R9 bulk duplicate-key tests assert invalid-row output, not an `Effect`.
- `maxSeverity` composition with multi-rule plans.
- `planHash` stability (same inputs → same hash) and sensitivity (any meaningful change flips the hash).
- `planHash` excludes `generatedAt` and `planHash`, normalizes dates/decimals/nulls, and is stable under object key reordering.
- Orphan-promotion: R2 to `destructive` when source tree becomes empty; R3 the same for stems.
- Editable-field allowlist rejects internal IDs and read-only taxonomy labels before planning.
- Blank/null/clear policy is applied consistently before diffing and hashing.

### Integration tests — local MySQL

- `/api/edits/preview` emits no writes (row-count assertions before/after).
- `/api/edits/preview` and `/api/edits/apply` reject unauthenticated users, invalid schema values, inaccessible plot/census scopes, and disallowed fields.
- `/api/edits/apply` for each rule:
  - `TreeTag` change creating a new tree, leaving the source with and without remaining stems.
  - `StemLocalX` change propagates to every measurement/materialized row referencing that `stems` row in the scoped census.
  - `SpeciesCode` re-link updates the measurement's `SpeciesID` and leaves the species row unchanged (regression test for the R1b removal).
  - Unknown species code returns `422` and writes nothing.
  - Codes edit rebuilds `cmattributes` correctly.
- `planHash` drift: preview, mutate DB out-of-band, apply returns `409` with the fresh plan.
- Plot+census lock contention: hold the lock in one connection, assert apply returns `423`.
- Bulk revision apply with matched + unmatched + destructive rows — whole-batch rollback when one row fails.
- Revert test: apply an edit, verify `edit_operations` captures all table before/after states, POST to revert, verify the pre-edit state is restored.
- Revert drift test: apply an edit, mutate the target again, POST to revert, verify the endpoint returns a fresh restore plan instead of blindly overwriting.

### Component tests — Cypress

- Datagrid inline edit: preview dialog opens on identity change, does not open when only silent rules fire.
- Datagrid read-only enforcement: `SpeciesName`, `SubspeciesName`, and internal ID columns cannot enter edit mode.
- Typed-confirm gate on bulk destructive batch: apply button disabled until `APPLY {N}` typed correctly.
- Undo toast appears, clicking restores the row.
- Drift: submit preview, simulate `409`, dialog re-renders with updated effects.
- Row-menu revert item reachable after the toast dismisses and performs the revert.
- Apply response with `validationPending: true` is surfaced as pending validation, not as a completed validation result.

### Regression tests

- `failedmeasurements` branch behavior (raw-column sync + re-validation) continues to work through the new path.
- Non-measurement dataTypes retain their existing PATCH response shapes — snapshot tests on `attributes`, `species`, `quadrats`, `personnel`.
- Compatibility PATCH shim cannot be used by production client code to pass a public `bypassPreview` flag.

## Edge cases

- **Concurrent edits to the same measurement.** Covered by `planHash` drift detection. Second editor gets `409` with the fresh plan and re-confirms.
- **Revert while another edit is in flight.** Revert acquires the same lock; serialized with normal edits.
- **Species not found on bulk.** If bulk revision expands to identity edits, apply returns `422` with the list of unknown codes spanning all rows; the bulk screen surfaces them in the invalid-rows section without partial apply. If bulk remains row-local, species-code edits stay ignored/invalid according to the revision-upload contract.
- **Plan-hash mismatch because of post-validation state.** Validation-invalidation and ingestion-error refresh are silent rules and do not contribute to the hash, so post-validation drift does not trigger `409`.
- **Blank vs clear ambiguity.** The analyzer uses the field policy table above before diffing. Omitted fields are no-op; explicit clear markers are required where blank would otherwise be ambiguous.
- **Compatibility shim callers.** The PATCH shim may call the internal apply helper with preview bypass. No public client request can set `bypassPreview`, and no production client code should depend on the shim once migration completes.
- **Changelog delay.** Recent Changes may lag the edit response because `unifiedchangelog` is asynchronous. Undo uses `edit_operations`, so the toast and row-menu revert are available immediately after apply returns.
