# Regression Contracts — Upload, Error Correction, and Reference-Data Editing

**Status: RATIFIED by the maintainer on 2026-07-20.** These behaviors are frozen contracts.
A future change that breaks one of them is a regression, not a redesign — the enforcing
tests listed per contract are the executable form of this document and must not be
weakened to accommodate a violating change. If a contract itself must change, update this
document and the named tests in the same PR.

Origin: the Mar–Jul 2026 incident remediation
(`docs/superpowers/plans/2026-07-13-forestgeo-regression-test-hardening.md`, local-only)
implemented these behaviors in Phase 1; the maintainer ratified them, with the display
delimiter question resolved, on 2026-07-20.

## The contracts

### 1. Duplicates surface; they never vanish

An exact duplicate source row produces **one successful measurement plus one persisted
failed row** carrying `DUPLICATE_ENTRY`, and the upload gets a `DUPLICATE_RECORDS`
(informational) integrity alert. Every source row remains countable.

Enforced by: `tests/integration/ingestion-invariants.integration.test.ts`,
`tests/integration/published-stemid-inheritance.integration.test.ts`.

### 2. Unknown reference data fails loudly with the exact reason

A row citing a species or quadrat that cannot be resolved is persisted as a failed
measurement (`StemGUID IS NULL`) linked through `measurement_error_log` to the exact
error code (e.g. invalid species / invalid quadrat), and is visible through the errors
read path. Invalid and (defensively) ambiguous reference matches alert under a single
`INVALID_REFERENCE_DATA` alert type; the per-row error code distinguishes the cases.

Enforced by: `tests/integration/ingestion-invariants.integration.test.ts` (including the
throwaway-schema ambiguity fixtures with the unique-active constraints dropped).

### 3. A bad attribute code never sinks the measurement — and is never silently applied

Ingestion splits the Codes cell on **semicolons only** (`ATTRIBUTE_CODE_DELIMITER`,
matching `bulkingestionprocess` STAGE 9). An unmatchable token (e.g. the comma list
`"A,D"`, which is one token to the database) does not block ingestion: the row lands as a
real measurement with a non-null `StemGUID`, zero `cmattributes` rows for the bad token,
and a validation/14 (`ValidateFindInvalidAttributeCodes`) link in
`measurement_error_log`. Correcting the code through the Errors Explorer edit flow
removes the link, materializes the corrected codes, and preserves the measurement's
`CoreMeasurementID` and `StemGUID` (in-place fix, not delete + recreate).

**Display decision (ratified):** the Errors Explorer *display and edit-seed* split on
both `;` and `,` (`parseCodesString`) is intentional. Showing `"A,D"` as two chips is a
correction affordance that recovers the user's likely intent; the mismatch warning under
the chips states what actually materialized. This display divergence from the
semicolon-only ingestion tokenizer is accepted, not a bug.

Enforced by: `tests/integration/ingestion-invariants.integration.test.ts` (SQL
materialization), `config/editplan/rules/attributes.ts` unit tests (shared tokenizer),
`cypress/e2e/column-mapping-realdb/resolve-and-remove.cy.ts` (full browser correction
loop), `components/errors/errorsexplorer.test.tsx` (edit-cell seeding without
cross-field contamination).

### 4. The books must balance — any gap is an integrity failure

For every upload batch: `source rows = successful rows + persisted failed rows`, with
zero rows left in staging and `missingRecords = 0`. Because contracts 1–3 persist every
duplicate and invalid row, **no count discrepancy has an innocent explanation**: any gap
raises `RECONCILIATION_MISMATCH` and the upload UI fails closed (no clean completion
state). "Differences may be normal due to deduplication" is retired language.

Enforced by: `lib/ingestion/reconciliation.test.ts` (production evaluator),
`tests/integration/ingestion-invariants.integration.test.ts` (batch accounting +
fault-injected mismatch), `tests/setup/ingestion-outcome.ts` (the batch-scoped outcome
reader all scenarios assert through).

### 5. Zero-row reference-data edits cannot report success

A species/quadrat PATCH that matches no row returns `HTTPResponses.NOT_FOUND`; the
transaction rolls back and nothing else mutates. Re-saving an existing row with its
current value ("no-op edit") is distinguished from "row does not exist" and returns OK.
UI-only fields (e.g. `CensusID` on species/quadrat payloads) are stripped before SQL.

Enforced by: `tests/integration/reference-data-patch.integration.test.ts` (production
route + mapper against real MySQL, read back through the production read path).

### 6. Upload counters mean what they say

The semantics of `uploadmetrics.sourceRecords` / `processedRecords` / `failedRecords` /
`missingRecords` are pinned by the shared outcome helper and its scenarios; a change in
counter meaning fails tests rather than silently redefining reports.

Enforced by: `tests/setup/ingestion-outcome.ts` +
`tests/integration/ingestion-invariants.integration.test.ts`.

## Incident → contract → coverage map

| Incident class (Mar–Jul 2026) | Contract | Primary coverage |
|---|---|---|
| Exact duplicate rows silently dropped | 1 | ingestion-invariants, published-stemid-inheritance |
| Unknown species/quadrat rows lost | 2 | ingestion-invariants |
| Attribute code whitespace / wrong delimiter | 3 | ingestion-invariants + attributes tokenizer tests |
| Fixed error remains visible / correction lost | 3 | resolve-and-remove.cy.ts (nightly realdb-full) |
| Rows missing at file boundaries / count mismatch | 4 | reconciliation tests + ingestion-invariants |
| Reference edit "saved" but changed nothing | 5 | reference-data-patch |
| Report counters drifting from reality | 6 | ingestion-outcome scenarios |

## CI placement

- PR gate: unit + integration suites; `realdb-smoke` (upload anchor
  `csv-mapping-to-coremeasurements.cy.ts` against a hermetic MySQL service).
- Nightly: `realdb-full` runs the whole `cypress/e2e/column-mapping-realdb/` directory —
  including the contract-3 correction loop — with `AUTH_FUNCTIONS_POLL_URL` pointed at
  the hard-gated test-only `/api/e2e-auth-poll` stub (404 outside e2e; the production
  authorization path is unchanged).

### 7. DBH/HOM over-precision is rounded quietly to the stored scale

**Ratified 2026-07-20 by the scientific-data owner (Option A: round).** An uploaded DBH or
HOM value carrying more precision than the `DECIMAL(12,6)` column stores is rounded to 6
decimal places and ingested as a normal success — no failure row, no warning. The
rounding happens at the `DECIMAL(12,6)` boundary (staging → coremeasurements). This is
accepted because 6 decimal places is below instrument-meaningful resolution for the units
in use. The exact submitted value is NOT preserved (there is no `RawDBH`/`RawHOM`
column); if provenance is needed later, that is a separate, larger change (Option B).

Note this contract is about *precision only*. Negative and out-of-range (≥ 1 km) values
are a separate validation concern (`NEGATIVE_DBH`/`NEGATIVE_HOM`), not covered here.

Two consequences of rounding at the 6-decimal boundary:

- **Dedup collapse.** The `coremeasurements` uniqueness key includes `MeasuredDBH` and
  `MeasuredHOM`, so two rows that differ only past the 6th decimal round to identical
  values and collapse to one measurement. This is intended (sub-6-decimal difference is
  below meaningful resolution), but it means such near-duplicates are silently deduped
  rather than both stored.
- **Downstream `viewfulltable` is narrower.** `coremeasurements.MeasuredDBH/MeasuredHOM`
  are `DECIMAL(12,6)`, but `viewfulltable.MeasuredDBH/MeasuredHOM` are `DECIMAL(10,6)`
  (max `9999.999999`). The max-in-range case this contract blesses (`999999.999999`) is
  storable in `coremeasurements` but exceeds the view column, so a `viewfulltable` rebuild
  carrying it would error under strict `sql_mode` or truncate otherwise. The precision
  contract stops at `coremeasurements`; reconciling the two column widths is a separate,
  untracked follow-up.

Enforced by: `tests/integration/ingestion-invariants.integration.test.ts` → "DBH/HOM
precision" block.

### 8. CTFS publish gate warns on data-quality, blocks on destination-integrity

**Ratified 2026-07-20 (interim of the full validation-tier feature).** "Publish census"
(the CTFS `.sql` export loaded into the on-prem CTFS MySQL) runs 8 "Finished Census"
preconditions, now split into two policies:

- **Warnings (publish proceeds):** `not-validated`, `unresolved-error`, `no-stem-guid`,
  `inactive-join`. These describe rows the export already excludes
  (`exportableMeasurementBaseWhere`), so the operator is told what won't be exported and
  the publish continues, surfacing the warnings in `X-CTFS-Precondition-Warnings`.
- **Blocking (publish 400s):** `unknown-attribute-code`, `missing-taxonomy-fields`,
  `string-too-long`, `zero-exportable-rows`. Each would produce an artifact that fails to
  load into, or silently truncates data in, the destination CTFS DB, so these still stop a
  real publish. A dry run continues to surface everything (blockers included) as a
  non-blocking preview.

The "nothing left to export" check still runs even when only warnings are present, so a
warn-only census cannot slip through as an empty publish. The full warning-vs-blocking
validation-tier feature (authorized+audited override, server-side gate stale UI can't
bypass) remains a TODO in `lib/ctfs-export/precondition.ts`.

Enforced by: `lib/ctfs-export/precondition.test.ts` (classification + warning-plus-zero-
rows interaction) and the CTFS export route test (`app/api/export/ctfs-sql/.../route.test.ts`:
quality warning → 200 + header; blocker → 400 with only blocking reasons).

## Explicitly NOT yet contracted (blocked)

- **Full publish validation-tier feature**: an authorized, audited operator override that
  can consciously publish past a destination-integrity blocker, enforced server-side so
  stale UI cannot bypass it. Contract 8 is the ratified interim; the override remains a
  TODO in `lib/ctfs-export/precondition.ts` and gets its own contract when built.

## Resolved without a contract

- **Cross-site authentication cookie behavior**: the observed cross-site login is
  **ratified as expected/acceptable** single sign-on (2026-07-20) — browser cookie-bleed
  was ruled out (host-only cookies + `azurewebsites.net` Public Suffix). No regression
  contract needed. Separately, the suspected shared `AUTH_SECRET` was **ruled out on
  2026-07-21**: replaying a live production session token against dev returned `null`,
  so dev and production already use distinct secrets and no rotation is required
  (see `docs/auth-environment-variables-runbook.md`).
