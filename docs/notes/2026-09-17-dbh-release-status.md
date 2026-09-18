# Annualised DBH release progress — 2026-09-17

Mason requested reconciling PR #473 with current development, merging it, and executing the [one-time migration runbook](../../frontend/docs/validation-rescore-runbook.md). This authorizes the release work; maintenance timing, complete external-writer inventory, and the rollback retention window still need resolution before the dependent production steps. No production writes or service stops have occurred in this session.

## Source reconciliation

- PR branch: `codex/annualised-dbh-validation-cluster`, targeting `forestgeo-app-development`.
- Development revision `369f0f90` integrated without conflicts by merge `57bee9ea`. Development advanced during rehearsal to `10b9f7de` (PR #486); merge `d82528a1` reconciles that update. Its only changes are the failed-measurement CSV route and its regression tests. DBH execution, SQL, transaction, and view-refresh files are byte-identical to the rehearsed runtime revision `4396e313`.
- Lifecycle annotations and retirement instructions committed as `a96b46bb`.
- Subsequent correction: one authenticated, admin-only override endpoint replaces four independent SQL requests. It reuses the census lock, scope conflict checks, transaction owner, and materialized-view refresher. Error resolution, manager markers, validity, and views now commit or roll back together.
- Rehearsal follow-up: the first atomic override implementation rebuilt every row in a census, then its UI callback rebuilt the summary again. Testing Mason's ordinary census-wide refresh took over two minutes, so the override now uses the existing measurement-ID view helper in bounded batches within its transaction; its UI only reloads rows/counts. This removes the duplicate work and limits refreshes to overridden rows.
- Subsequent correction: public validation-run responses omit reserved recovery markers but retain genuine notices. Database markers remain available for uncertain-commit reconciliation, including after tool retirement.

## Verification

- Reconciled branch before the two runtime corrections: 247 unit-test files, 3,548 tests passed.
- Corrections: 248 unit-test files / 3,558 tests passed, followed by 17 targeted endpoint, policy and UI tests after the final census-selection/error-feedback correction; 42 focused integration tests passed under `TZ=Europe/Bratislava`. Coverage includes a late view-refresh failure rolling back all override state and a successful retry, and notices retaining real warnings without mutating stored metadata.
- Formatting, ESLint and production build: passed. Dependency cycles remained 33 (baseline 33); production `any` usage remained below its baseline. Standalone `tsc` still reports inherited test-file diagnostics, with no added diagnostic compared with an isolated checkout of `57bee9ea`; the DBH test transaction adapter now conforms to the shared generic executor type. No production-source type diagnostics remain. Full integration suite: 137 files passed, 1,268 tests passed and 7 skipped, under `TZ=Europe/Bratislava` (659 seconds).
- Override refresh follow-up: 249 unit-test files / 3,560 tests passed; 35 focused MySQL integration tests and the production build passed. All six CI jobs passed on `4396e313`: unit, integration, gates, component, e2e-tests, and realdb-smoke. The integration job took substantially longer than the previous run; it still passed. Fresh CI is required on the final CSV-reconciled/documented head.
- `graphify update .`: completed after code changes.

Local validation logs and read-only readiness evidence are in the private operator directory `/private/tmp/forestgeo-dbh-release-20260917` and sibling `/private/tmp/forestgeo-dbh-sept17-*.log` files. These temporary locations are working evidence, not the durable archive required for acceptance.

## Review of the reconciliation corrections

1. Security/input validation: no remaining findings. The endpoint preserves admin-only writes and site/quarantine checks; schema and positive safe integer IDs are checked before mutation (`frontend/app/api/validations/override/route.ts:13`, `frontend/lib/validations/override.ts:59`).
2. Correctness/edge cases: corrected the initial modal CensusID lookup to match the measurement grid's newest selected date range; a multi-ID census fixture covers it. No remaining findings in the correction.
3. Error handling/cleanup: no remaining findings. The shared transaction owner controls rollback/lock cleanup. The injected late failure proves atomicity and retry; uncertain success asks the user to refresh rather than promising rollback. Failed overrides now show visible feedback.
4. Testability/observability: no remaining findings. API authorization/error tests, real-MySQL rollback coverage, and modal request/error tests cover the new boundary. Genuine run notices remain visible; durable recovery metadata remains unchanged.
5. Complexity/reuse: no remaining findings. The operation reuses existing lock, scope-conflict, transaction, and view helpers. Recovery metadata needs only a shared prefix/filter, with no new table, migration, scheduled job, or permanent re-score endpoint.

## Current production observations

At 17:48 UTC, read-only queries found 13 site schemas and 25 active census scopes. `forestgeo_sinharaja` is additional to the September 9 rollback list and has no active census. Both DBH rule identities were present and enabled in every site schema. The runbook's explicit rollback list now includes this schema and still refuses unexpected discovery results.

Eligible pending rows requiring ordinary validation before a DBH-only sweep:

| Schema                  | Plot | Census | Census number | Eligible pending |
| ----------------------- | ---- | ------ | ------------- | ---------------: |
| forestgeo_harvard       | 1    | 13     | 1             |                1 |
| forestgeo_harvard       | 1    | 15     | 2             |           85,641 |
| forestgeo_mpala         | 1    | 2      | 2             |          156,492 |
| forestgeo_testing_mason | 1    | 19     | 1             |                3 |

No nonterminal catalog jobs were observed. SERC run IDs 3/5 and upload sessions in Panama and Testing Mason still report nonterminal states outside the active-census inventory. The restored copy shows that all four refer to census records that no longer exist; the SERC run scopes contain no measurements. No lifecycle rows were relabeled or deleted. Repeat this observation under production isolation. Their old timestamps alone are insufficient to declare them complete or safe to erase. Reconcile current census activity, workers, sessions, and transactions under the final maintenance controls.

Both production-connected web apps and the ingestion function are currently running. A point-in-time read-only audit does not attest all writers or establish isolation. The testing app's configuration was rechecked and targets `forestgeo-testing-mysql.mysql.database.azure.com`, outside this rollout. The separate `polluserinformation/polluserstate` function has an HTTP trigger; its trigger metadata alone does not attest its writer behavior. Include it in isolation unless its deployed behavior is verified read-only. At 20:11 UTC there were no active catalog provisioning runs; recheck these independently of upload jobs before deployment.

## Execution progress and remaining release sequence

1. The protected production-copy export was explicitly approved and completed at 19:24 UTC. The 157,930,784-byte gzip archive passed integrity verification (SHA-256 `8b8c075489bda6b3f3af53d19e67bdad4e7ee59699976894bb7f25097ba05f08`). It remains read-only in the private evidence directory. Restore to isolated `127.0.0.1:3307` completed at 19:37 UTC, with local-only definer replacements and no changes to the source archive. All 13 schema migrations/contracts and both procedure manifests passed. Ordinary validation prepared all 242,137 pending rows in the four scopes without failed steps. All 25 legacy baseline scopes completed in 860.341 seconds. The fixed-prior comparison removed 922 growth and 7,948 shrinkage findings and added none; these are pair findings, not final validity changes. All 25 annualized scopes subsequently completed across two attempts. The initial attempt timed out at Testing Mason census 55 after 300 seconds; the sweep correctly halted with an unknown outcome while server rollback continued. Fresh-connection reconciliation proved rollback, six saved projections matched, and no provisional run persisted. The 600-second retry covered only the ten unfinished scopes and completed census 55 in 601.399 seconds including commit/artifact work. A separate one-row upsert also waited over 150 seconds for commit during that slow period. These observations require a reviewed production timing budget, rather than treating five minutes as sufficient. The largest-census injected pre-commit failure also rolled back successfully: full view rows, occurrence history, run records, and saved projections matched. The full legacy restoration comparison remains in progress at this tracked checkpoint.
2. Complete final-head CI and record the exact revision. The 15 completed scopes reviewed before resumption included 91 original-valid to annual-invalid rows (Niobrara 53, Panama 38). Finish the full row-level review; older override intent cannot be inferred from missing markers. Keep the default production hold until reviewed. Preserve the failed attempt, recovery, final scope ledger, fixed-prior facts, floor exclusions, timings, and full legacy comparison in the private completion packet. The protected, Git-ignored local archive destination is `frontend/backups/annual-dbh-20260917/`; it is not populated or accepted merely by being named here.
3. Confirm maintenance timing, direct SQL users/scripts/schedulers, and rollback-window start/end. Refresh readiness; isolate and drain every writer. Take and verify a fresh recoverable snapshot under these controls.
4. Merge PR #473 only after these prerequisites. The development workflow deploys to the shared production database, so merging is a production-release step. Verify deployment and restore isolation if workflow restarts reopen access.
5. Complete normal validation for pending scopes under controlled access, verify every deployed rule/migration and dry run, then run the ordered annual re-score. Reconcile all attempts, holds, downstream scopes, views, and artifacts before releasing maintenance.
6. Record owner acceptance and the rollback window. Retire only the dedicated tool after that window and explicit retirement signoff; retain annual rules, shared runtime helpers, override functionality, historical metadata filtering, tests, and archived recovery revision.

Nothing in this progress record marks an unexecuted scope, approval, rehearsal, merge, or production sweep as complete.

This tracked checkpoint records verified progress, not final operational acceptance. The private completion packet and PR release status must carry subsequent rehearsal outcomes and production decisions; no pending item becomes complete by inference.
