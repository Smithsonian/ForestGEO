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

## Explicitly NOT yet contracted (blocked)

- **DBH/HOM precision** (round vs preserve vs reject beyond `DECIMAL(12,6)` scale):
  awaiting the scientific-data owner's decision; `coremeasurements` has no
  `RawDBH`/`RawHOM` provenance column today, so a "preserve raw" choice must first
  define where provenance lives.
- **Cross-site authentication cookie behavior**: awaiting a reproduced root cause.
- **Publish gating** (warning-vs-blocking validation tiers): awaiting the tier feature.
