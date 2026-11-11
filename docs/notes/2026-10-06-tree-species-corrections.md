# Issue #427: tree-wide species corrections

## Contract

Editing the species code on a measurement linked to an existing tree corrects that tree's `SpeciesID` for the census the
edited measurement belongs to — not a re-link of one measurement. The target is the linked `TreeID` within that census
only: the same `TreeTag` in a different census is a different `TreeID` and is untouched (no cross-census propagation, no
global tag uniqueness). `TreeID`, every `StemGUID`, and every measurement-to-stem link are preserved; no new trees, stems,
or orphans are created. Every stem and measurement on the tree — active or inactive — reflects the corrected species
afterward. Inactive rows are never reactivated by this fix, but their stored `RawSpCode` projection is synchronized too,
so a later reactivation cannot resurrect a stale species, and inactive membership counts toward affected-count reporting.

## Scope rules

- **Raw/canonical precedence.** The read model prefers a measurement's own raw snapshot (`RawSpCode`, `RawPlotX`/`RawPlotY`)
  over the shared stem/tree canonical value; this is why the correction projects `RawSpCode`.
- **Per-row vs. stem-level scope.** `DBH`, `HOM`, attributes, and comments keep single-row (`CoreMeasurementID`) scope and may
  be combined with a species correction in the same edit. `LocalX`/`LocalY` are `stems` columns, so editing them already
  affects every measurement on that `StemGUID` — unchanged by this fix. `PlotX`/`PlotY` follow the raw-precedence rule above.
- **Mixed-identity restriction.** A species correction cannot be combined with a `TreeTag`, `StemTag`, or `QuadratName` VALUE
  change in the same edit — ambiguous re-point vs. in-place correction. Unchanged identity fields present in a full-row
  payload do not trigger this, only an actual value change does, and the two operations must be submitted separately.
- **Destination occupancy / conservative tag overlap.** If another tree already occupies the destination `(TreeTag,
  SpeciesID, CensusID)` — active or inactive — the correction is blocked with a structured conflict naming both trees,
  never auto-merged; checks evaluate equivalence the way the database would, and an ambiguous overlap blocks rather than guesses.
- **Case-only no-op.** `resolveSpeciesByCode` is case-insensitive, so e.g. `"acerru"` → `"ACERRU"` resolves to the same
  `SpeciesID` and is a no-op, not a one-row allocation.

## Undo and batching

- **Captured membership + plan hash.** The plan captures full membership (per-stem/per-measurement link, scope, activity)
  plus each measurement's exact prior `RawSpCode` — including `NULL` and differing-case/spelling values — and this
  membership is part of the canonical plan hash.
- **What undo reverts, and its guards.** Undo restores exactly those values — only the local/single-row fields and semantic
  attributes the operation wrote — guarded by hard-drift detection and a check that the tree's original active canonical
  taxon is still intact.
- **Severity and confirmation.** A tree correction effect and an undo effect are `warn` severity, not destructive; what's
  required is an explicit whole-tree preview (scope + affected counts) and Apply confirmation. The typed `APPLY` token is
  required only when the overall plan's maximum severity is destructive — it is not a property of species corrections
  themselves.
- **Forward drift re-previews; undo drift blocks.** Forward: a membership/plan change between preview and apply —
  including an equal-count activity swap between two siblings, identical by count alone — changes the canonical plan hash
  and forces a fresh preview/re-confirmation before applying. Undo: hard post-correction drift — in membership, species,
  raw snapshots, the operation-changed local fields, semantic attributes, or references — blocks automatic undo outright.
  A confirmed or refreshed hash cannot waive hard drift; no new confirmation overrides it, and undo still requires the
  tree's original taxon to be active and canonical.
- **Committed undo vs. refresh failure.** Once the undo write commits it is reported as succeeded; a subsequent failure to
  refresh the view is surfaced as a refresh failure, not as a failed undo.
- **Grouped batch semantics.** Within one revision upload, corrections targeting the same source tree are grouped and
  applied once per tree, not once per row in file order. The row's local/measurement edits are written before the
  once-per-tree species correction and the subsequent error refresh, which is why revalidation runs against the final
  values. All preflight checks run before any writes; contradictory requested species inside a group, or an identity
  move/new-row resolution conflicting with a planned correction, blocks the batch before any write; non-revertable
  entries are reported as such in the batch summary.
- **Species corrections and brand-new rows are mutually exclusive within one upload.** A single revision upload may not
  combine a tree-wide species correction with one or more brand-new measurement rows, even when nothing else in the batch
  overlaps — the two must be submitted as separate uploads. This is refused at preview and enforced again at apply, before
  any write, because the new-row ingestion path commits its own writes independently, so a correction already written
  could not be rolled back if a later step in the same upload failed. The restriction applies regardless of whether the
  new-row confirmation checkbox is checked.

## Historical data: candidates only, no repair

A read-only audit (bounded `SELECT`s inside a `READ ONLY` transaction, rolled back, against the live schema catalog,
timestamped `2026-10-07T04:01:44.513Z`) scanned 13 schemas total (11 non-test, 2 test) with 0 query errors. Within the 11
non-test schemas: active `(CensusID, TreeTag)` groups carrying different `SpeciesID` values in two sites — Cook (2 groups,
4 trees) and Panama (1 group, 2 trees); active stems with no attached measurement in three sites — Cook (3 stems), Mpala
(54,543 stems), Panama (1 stem); 0 orphaned active trees. These are candidates for historical split-tree/data-quality
review, **not** proof this bug created them and not an attribution of cause; no winning species was chosen, nothing was
deleted or repaired, and no individual tree/stem identity was read beyond these aggregate counts. The 54,543 Mpala count is
reported exactly as measured, not characterized as negligible. Historical repair requires a separately reviewed mapping of
tree/stem identity and intended species, and is out of scope here.

## Limitation: error-history retention (unsupported/unknown rules, including ErrorCode 20/21)

A species correction only invalidates error occurrences for ordinary supported scientific rules, moving them into pending
status via the existing generic mechanism. Occurrences it cannot prove resolved — unsupported checks, unknown/unrecognized
rules, and ErrorCode 20 (previous-census species mismatch) / 21 (same-batch species conflict) as the concrete named
instances — are retained until an actual supported revalidation proves resolution, rather than being deleted on the
assumption the correction fixed the condition, and rather than inventing a new validation subsystem or auto-resolving them
merely because `ErrorSource` is `'validation'`. This checkout has no rerunnable site-specific validation definition
reproducing either the 20 or 21 check outside ingestion, so existing 20/21 occurrences specifically stay unresolved.
`frontend/tests/integration/editplan-species-correction.integration.test.ts` covers seeded unresolved 20/21 plus an
already-resolved occurrence and asserts resolution state is unchanged after a tree-wide correction, as a required
regression.

## Limitation: `IsValidated = TRUE` provenance

On this checkout's base (no `config/validationoverride.ts`), the legacy manager-override UI only set `IsValidated = TRUE`
and deleted the row's validation errors without recording a resolved `MANAGER_OVERRIDE` occurrence, so rows overridden
before provenance tracking are indistinguishable from ordinarily-valid rows by `IsValidated` alone. No historical
provenance is invented; only markers/history that *are* recoverable (including a resolved `MANAGER_OVERRIDE` occurrence
recorded going forward) are asserted to survive a correction. This fix also does not change when a correction is permitted
relative to validation state — it relies on the existing edit-scope guard (`ScopeBusyError`), which blocks any edit while
an upload session or validation run is in progress for the plot/census; that busy guard is distinct from a row's resting
`IsValidated`/pending state, and a correction does not require the row to already be pending/unresolved.
