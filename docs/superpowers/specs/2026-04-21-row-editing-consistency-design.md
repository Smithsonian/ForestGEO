# Row Editing Consistency and Ramification Surfacing

**Date:** 2026-04-21
**Status:** Draft
**Related spec:** [2026-04-14-measurement-revision-upload-design.md](./2026-04-14-measurement-revision-upload-design.md)

## Problem

Researchers edit measurement rows through four different surfaces today: the inline datagrid on the measurements view (`measurementscommons.tsx`), the Errors Explorer dialog (`components/errors/errorsexplorer.tsx`), the failed-measurements grid (`isolatedfailedmeasurementsdatagrid.tsx`), and the bulk revision CSV upload (`/api/revisionupload` + `/api/revisionupload/apply`, from the 2026-04-14 spec). Each surface reaches the database through a different code path, and all of them trigger downstream side effects silently.

The current `config/macros/coreapifunctions.ts::PATCH` handler performs several operations that affect rows other than the one the user is editing, with no user-visible indication at edit time:

- A `SpeciesName` or `SubspeciesName` cell edit on a measurement writes to the shared `species` row, renaming the species across every measurement and every census that references it.
- A `TreeTag`, `StemTag`, or `QuadratName` edit re-resolves the measurement to a different `TreeID` / `StemGUID`, potentially creating a new tree or stem and leaving the old one with no remaining children.
- A `StemLocalX` or `StemLocalY` edit writes to the `stems` row, so every census that references that stem gets the new coordinate.
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

### Ramification categories that surface at edit time

Cross-row and identity-changing effects are surfaced. Purely local effects that affect only the edited row are not shown. Validation invalidation and ingestion-error refresh are silent always: they always happen after any measurement edit, have no destructive impact, and add noise if displayed.

Identity changes (which tree / stem / species the measurement belongs to) get the highest severity tier because they are the category researchers most often want to catch before committing.

### Dialog gating

- **Single-row edit.** When the analyzer returns `maxSeverity === 'info'` (or the effect list is empty after filtering out silent rules), the edit saves inline with no dialog. Otherwise, the preview dialog opens and the user confirms once.
- **Bulk revision upload.** The existing `REVISION_MATCH` screen gains an aggregated impact summary. When any effect in the batch is `destructive`, the apply button is gated behind a typed confirmation (`APPLY {N}` where `N` is the row count).

### Revert affordance for single-row edits

Per-edit revert, reconstructed from `unifiedchangelog`, available via two surfaces:

- A success toast shown on every successful single-row edit, with an "Undo" button.
- A row-action menu item ("Revert last edit", with a timestamp) reachable from the three-dot menu on any row that has a revertable edit in its history.

Bulk revision applies do not get a revert affordance in this phase.

### Species editing behavior change

The measurement datagrid currently lets researchers edit `SpeciesCode`, `SpeciesName`, and `SubspeciesName` as separate cells. When `SpeciesName` or `SubspeciesName` is edited, the PATCH handler issues an `UPDATE species SET ...` against the resolved species row. This spec removes that branch and narrows the editable surface:

- `SpeciesCode` stays editable on the measurement grid and is the identity handle for re-linking.
- `SpeciesName` and `SubspeciesName` become read-only on the measurement grid. They reflect the linked species. To change a species definition, users go to the species fixed-data grid (out of scope for this spec, already existing).

Editing `SpeciesCode` is interpreted as "re-link this measurement to an existing species with the new code." If no species with the new code exists, the edit is rejected with a message directing the user to create the species in the fixed-data grid. No species rows are mutated from the measurement edit path after this change.

## Architecture

### `EditPlan` data model

The analyzer produces an `EditPlan` object that both the single-row dialog and the bulk summary render from:

```ts
type Severity = 'info' | 'warn' | 'destructive';

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
```

The `planHash` is the SHA-256 of the canonicalized plan (sorted keys, stable ordering). On apply, the server re-runs the analyzer and compares hashes to detect drift.

### Ramification rules catalog

| ID | Trigger | Severity | Description |
|---|---|---|---|
| **R1a** | `SpeciesCode` edit resolves to a different existing `SpeciesID` | `warn` (identity) | Measurement re-linked from species A to species B. No species row is mutated. |
| **R1c** | `SpeciesCode` edit resolves to no existing species | (rejection, not effect) | Apply returns `422`. User is prompted to create the species in the fixed-data grid. |
| **R2** | `TreeTag` edit re-resolves to a different `TreeID`, or `SpeciesCode` change triggers a new tree | `warn` → `destructive` if source tree becomes orphaned | Measurement reassigned from tree A to tree B. Severity promotes when tree A has no remaining stems. |
| **R3** | `StemTag` / `QuadratName` edit re-resolves to a different `StemGUID` | `warn` → `destructive` if source stem becomes orphaned | Measurement reassigned from stem A to stem B. Severity promotes when stem A has no remaining measurements. |
| **R4** | `StemLocalX` or `StemLocalY` edit | `warn` (cross-row) | Stem coordinate propagates to all censuses referencing that stem. |
| **R5** | `Attributes` / codes edit | `info`, or `destructive` when any previously-valid code is removed | `cmattributes` rows removed and re-inserted. |
| **R6** | Revision apply detects duplicate measurements for the stem in this census | `destructive` | Survivor selected, duplicates deleted. |
| **R9** | Revision CSV has two rows with the same match key | `destructive` (invalid rows) | All colliding rows marked invalid so the user can reconcile before re-upload. |

Silent rules — always run, never surfaced:

- **R7 Validation invalidation.** Any measurement edit clears `IsValidated` and re-runs validations. Errors appear in `measurement_error_log` after apply.
- **R8 Ingestion-error refresh.** The existing `refreshIngestionErrorsForMeasurement` call runs on every edit.

`maxSeverity` is computed over the surfaced effects only (R7 and R8 never raise severity).

R1b (species row rename via measurement edit) is intentionally absent from this catalog. The behavior is removed as part of this spec (see "Species editing behavior change"). IDs R1b and R8-internal are reserved to keep existing references to these numbers unambiguous in the implementation plan.

### Endpoints

`POST /api/edits/preview`
- Body: `{ schema, plotID, censusID, dataType: 'measurementssummary' | 'failedmeasurements', oldRow, newRow }`
- Returns: `EditPlan`
- Acquires a read-level plot+census scope lock (existing mechanism from `ba5e71d9`). Returns `423 Locked` if the lock is held by an active upload or validation.
- Runs all applicable rules, including DB reads to determine orphan status and cascade counts. No writes.

`POST /api/edits/apply`
- Body: `{ schema, plotID, censusID, dataType, oldRow, newRow, planHash, bypassPreview?: boolean }`
- Returns: `{ updatedIDs, applyErrors, changelogID, postValidation: { newErrors, clearedErrors } }`
- Acquires a write-level plot+census scope lock.
- Re-runs the analyzer against current DB state, re-computes `planHash`, compares:
  - Match → apply the plan inside a transaction.
  - Mismatch → return `409 Conflict` with the fresh plan; client re-renders the dialog and re-confirms.
- `bypassPreview` is reserved for server-side callers and tests that don't render the dialog; it skips the hash comparison and applies whatever the oldRow/newRow imply.

Both endpoints call into the shared `config/editplan/` library so the detection logic has one home.

### Surface wiring

| Surface | Current path | After |
|---|---|---|
| Datagrid inline edit (`measurementscommons.tsx::updateRow`) | `PATCH /api/fixeddata/measurementssummary/...` | On Save, calls `POST /api/edits/preview`; if `maxSeverity > 'info'`, opens the shared preview dialog; otherwise calls `POST /api/edits/apply` directly and commits the row. |
| Errors Explorer row edit (`errorsexplorer.tsx`) | Same PATCH route with custom dialog | Same flow as datagrid. Existing `stripRowForUpdate` stays; the dialog becomes a thin wrapper over the shared preview component. |
| Failed-measurements grid (`isolatedfailedmeasurementsdatagrid.tsx`) | PATCH with `dataType=failedmeasurements` branch | Also uses `/api/edits/preview` + `/api/edits/apply`, passing `dataType: 'failedmeasurements'`. The analyzer branches on `dataType` to run the failed-row variant of rule processing — raw-column sync, re-validation, and failure-reason refresh — that currently lives in `coreapifunctions.ts::PATCH` (lines 628–705). The `EditPlan` shape is identical; only the apply-time SQL differs. |
| Revision upload (`/api/revisionupload`, `/api/revisionupload/apply`) | Returns `matchedRows` with pre-computed `existingValues` + `changes` | Match endpoint calls the analyzer for each matched row and returns an aggregated bulk `EditPlan`. Apply endpoint iterates via the shared library (single transaction per scope, same rollback behavior as today). Per-row plans let the drill-down lists resolve to actual row IDs. |

The `PATCH /api/fixeddata/measurementssummary/...` route stays as a compatibility shim that forwards to `/api/edits/apply` with `bypassPreview: true`. Once all client surfaces are migrated, the shim is removed in a follow-up PR. Non-measurement dataTypes (`attributes`, `species`, `quadrats`, `personnel`, `alltaxonomiesview`, `plots`) continue using the existing PATCH handler unchanged.

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

Every successful single-row apply produces a changelog entry with enough information to reconstruct the pre-edit state (field values and any linked-row changes). Two revert entry points:

- **Toast.** Shown on every successful single-row edit; visible for ~12 seconds with an "Undo" button. Clicking it calls a new `POST /api/edits/revert` endpoint with the changelog ID.
- **Row menu.** A "Revert last edit" item on the row's three-dot action menu, showing the relative timestamp of the last edit. Available as long as the changelog entry exists.

Both affordances hit the same revert endpoint. Revert is itself a normal edit that goes through `/api/edits/apply` — the analyzer runs on the restore, producing its own plan and changelog entry. If the revert would itself cause a destructive effect (rare, but possible if the world has moved on), the dialog opens and the user confirms.

Bulk revision applies do not get a revert affordance.

### Error responses

- `409 Conflict`: planHash mismatch. Body includes the fresh `EditPlan`. Client re-renders.
- `423 Locked`: plot+census scope lock held by another process. Body includes holder description. Client surfaces a retry-in-a-moment message.
- `422 Unprocessable`: rule R1c fired (species not found). Body lists the unknown codes/names. Dialog directs the user to the species grid.
- `500`: an SQL failure during apply. Body includes the failing rule ID and message. Transaction rolls back.

Successful applies that surface new post-validation errors return `200` with `postValidation: { newErrors, clearedErrors }` in the body; the toast communicates this without treating the apply as a failure.

## Testing

### Unit tests — `config/editplan/` library (Vitest)

- Per-rule tests for R1a, R1c, R2, R3, R4, R5, R6, R9 with representative `(oldRow, newRow, dbSnapshot)` fixtures. Each asserts the exact `Effect` (category, severity, counts, references).
- `maxSeverity` composition with multi-rule plans.
- `planHash` stability (same inputs → same hash) and sensitivity (any meaningful change flips the hash).
- Orphan-promotion: R2 to `destructive` when source tree becomes empty; R3 the same for stems.

### Integration tests — local MySQL

- `/api/edits/preview` emits no writes (row-count assertions before/after).
- `/api/edits/apply` for each rule:
  - `TreeTag` change creating a new tree, leaving the source with and without remaining stems.
  - `StemLocalX` change propagates to every census referencing that stem.
  - `SpeciesCode` re-link updates the measurement's `SpeciesID` and leaves the species row unchanged (regression test for the R1b removal).
  - Unknown species code returns `422` and writes nothing.
  - Codes edit rebuilds `cmattributes` correctly.
- `planHash` drift: preview, mutate DB out-of-band, apply returns `409` with the fresh plan.
- Plot+census lock contention: hold the lock in one connection, assert apply returns `423`.
- Bulk revision apply with matched + unmatched + destructive rows — whole-batch rollback when one row fails.
- Revert test: apply an edit, POST to revert, verify the pre-edit state restored from `unifiedchangelog`.

### Component tests — Cypress

- Datagrid inline edit: preview dialog opens on identity change, does not open when only silent rules fire.
- Typed-confirm gate on bulk destructive batch: apply button disabled until `APPLY {N}` typed correctly.
- Undo toast appears, clicking restores the row.
- Drift: submit preview, simulate `409`, dialog re-renders with updated effects.
- Row-menu revert item reachable after the toast dismisses and performs the revert.

### Regression tests

- `failedmeasurements` branch behavior (raw-column sync + re-validation) continues to work through the new path.
- Non-measurement dataTypes retain their existing PATCH response shapes — snapshot tests on `attributes`, `species`, `quadrats`, `personnel`.

## Edge cases

- **Concurrent edits to the same measurement.** Covered by `planHash` drift detection. Second editor gets `409` with the fresh plan and re-confirms.
- **Revert while another edit is in flight.** Revert acquires the same lock; serialized with normal edits.
- **Species not found on bulk.** Apply returns `422` with the list of unknown codes spanning all rows; the bulk screen surfaces them in the invalid-rows section without partial apply.
- **Plan-hash mismatch because of post-validation state.** Validation-invalidation and ingestion-error refresh are silent rules and do not contribute to the hash, so post-validation drift does not trigger `409`.
- **Compatibility shim callers.** The PATCH shim with `bypassPreview: true` is reserved for server-internal and test-only callers. No production client code should depend on it once migration completes.
