# DBH release: four simplicity fixes required before merge

Mason explicitly added all four findings from the September 17 branch review as merge prerequisites. PR #473 remains unmerged; no production data or service state changed.

1. Atomic manager overrides were already implemented and copy-tested at `4396e313`: one authorized server operation, census lock, one transaction, bounded updates of both views, and rollback on failure.
2. Recovery evidence now has `validation_runs.RescoreAttemptID`; notices have `Notices`. Errors, notices and attempt identifiers no longer share a write path. The application reads legacy completed messages at the API boundary, filters old internal markers, and recovery can still reconcile older attempts. Apply the additive message-storage migration and contract check before starting the new runtime. Preserve these columns/history after one-time tool retirement.
3. Advisory and locked execution use one preflight with an injected executor. Both current and immediate-prior scope checks remain mandatory under the execution locks; shared code does not make dry-run approval sufficient.
4. Integrated schema-loader commit `8abbad6d` and replaced its local splitter with production provisioning's `splitSqlFile`. The loader independently checks every canonical table exists and restores foreign-key checks on failure. Removed compensating table definitions remain removed.

The September 17 protected copy rehearsal completed all 25 annual and legacy restoration scopes; all 75 run records and committed artifacts reconciled, both views passed, and the fault/unknown-commit recovery proofs passed. Archive: `frontend/backups/annual-dbh-20260917/rehearsal-32516ba3.tar.gz` (private, Git-ignored), SHA256 `b79e9caac2f283ed30a7b418fe0bd7e73b8285da18f4f49a83c3a9bff80121e3`, 856,209,692 bytes, 1,008 verified members. All six CI checks passed at `32516ba3`.

That archived packet is frozen. These follow-up changes require new verification and copy rehearsal at the final revision. Production maintenance timing, external/direct-writer inventory, rollback retention, reviewed timeout budget and disposition of 91 original-valid to annual-invalid measurements still need to be recorded. Merge deploys to the shared production database, so it remains held until the release prerequisites are resolved. The canonical execution and retirement instructions remain `frontend/docs/validation-rescore-runbook.md`.

## Review and verification

Reviewed in five separate passes:

1. Security/input validation: corrected message-array validation and rejected the reserved legacy recovery prefix in `frontend/app/api/validations/run/route.ts:116`. The endpoint never accepts `rescoreAttemptID`; regression coverage checks attempted metadata injection. No remaining findings identified in this pass.
2. Correctness/edge cases: verified new and old commit evidence in `frontend/lib/validations/dbh-rescore.ts:101`, repeated current/prior checks under locks at `frontend/lib/validations/dbh-rescore.ts:405`, and all-target message-column verification at `frontend/lib/validations/dbh-rescore-cli.ts:283`. No remaining findings identified.
3. Error handling/resource cleanup: the migration is additive and rerunnable after partial DDL; historical rows remain intact. Re-score rollback/unknown-outcome behavior is retained. The loader restores foreign-key checks in `frontend/tests/setup/local-db-setup.ts:350`. No remaining findings identified.
4. Testability/observability: persisted notices and errors have separate worker/API/store/UI tests; recovery has real-MySQL tests for both storage formats and lost commit acknowledgement. No remaining findings identified.
5. Complexity/reuse: removed the new preflight type cycle; cycles remain 33 (baseline 33), and `any` remains 483 (baseline 489). Shared preflight and parser replace duplicated implementations. No remaining findings identified.

Full unit gate: 249 files / 3,561 tests passed. Final focused checks: 100 unit tests and 13 API tests passed. Initial database pass: 107 tests passed. Production build, final formatting/lint, cycle/any gates and graph update passed. Standalone `tsc` retains the existing test-only diagnostics, with none in these changed source files. Full non-UTC integration and final-revision CI are still running/pending; record their final results separately.

A supplementary rehearsal will use `/private/tmp/forestgeo-dbh-simplicity-20260918` on the retained isolated copy. It must first verify all six saved projections against the prior successful legacy restoration, apply the additive run-storage migration, then run all annual scopes, inject the largest-scope rollback failure, restore legacy rules and compare every scope. This is a follow-up on the approved snapshot, not a new production extraction; the production recovery snapshot must still be taken under maintenance isolation.
