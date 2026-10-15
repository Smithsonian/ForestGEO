# Mpala upload ingestion timeout implementation plan

**Date:** 2026-10-15

**Status:** Implemented on `codex/mpala-upload-ingestion-timeout`; see the [validation record](2026-10-15-mpala-upload-ingestion-timeout-validation.md) for checks and remaining rollout/recovery gates.

**Integration baseline:** `forestgeo-app-development` at `aba6cf848eb5dee0c34e42bb95b83382f1b78352`.

**Specification:** [Mpala upload ingestion timeout fix specification](2026-10-15-mpala-upload-ingestion-timeout-spec.md).

Implement a scoped keyset splitter, useful setup diagnostics, storage readiness before claims, and accurate failure summaries. Preserve the shared HTTP/background ingestion path, atomic setup, biological rules, and the existing 120-second pre-commit callback timeout. A new index is conditional on evidence. Total setup timing includes COMMIT and cleanup, although the callback timer does not.

## Decisions carried into implementation

| Review issue                      | Implementation decision                                                                                                                                              | Required proof                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope changes after authorization | Require caller-authorized `expectedScope` at `ingestBatch`; compare before and after locking                                                                         | Both mixed scope and a complete change to another single scope fail before writes                                                              |
| Cancellation retention conflict   | Restore staging at the ingestion rollback boundary; preserve subsequent explicit user-cancellation cleanup; former lease owner does neither cleanup nor state writes | Separate ingestion-boundary and full-worker tests                                                                                              |
| COMMIT outside the callback timer | Preserve that timer boundary; observe COMMIT separately; treat lost commit acknowledgement as recovery-required                                                      | Distinguish acknowledged commit, confirmed rollback, and unknown commit outcome; no automatic replay or destructive cleanup on unknown outcome |
| Diagnostics from another attempt  | Correlate by unique per-claim worker ID and authoritative transition, including file/batch identity                                                                  | Consecutive different failures, unchanged retry count, late events, and missing history cannot produce stale summaries                         |
| Unconditional extra index         | Benchmark the new scoped queries with existing indexes first                                                                                                         | Comparable plans and timings justify reuse or an additive index, including write overhead                                                      |
| Index alias rejected by contract  | If an index is needed, narrowly support equivalent names for that requirement in migration and contract                                                              | A pre-existing differently named equivalent passes without creating a duplicate; unrelated exact-name checks remain intact                     |

## Preparation and dependencies

1. Record the then-current remote development SHA and use an isolated checkout based on it. Do not implement on the current `codex/issue-481-save-followup` checkout or overwrite its unrelated changes. Use a `codex/` branch when implementation begins.
2. Read the applicable repository instructions and graph report in that checkout. Audit every `ingestBatch` caller before changing its signature. The reviewed production callers are the setupbulkprocedure route and background worker; additional callers exist in integration fixtures for census collapse, coordinate ingestion/validation, and validation orchestration.
3. Confirm the deployed release SHA and enabled worker instances using read-only evidence. Keep that release identity separate from the implementation baseline. Record missing operational access as an outstanding rollout prerequisite rather than assuming the branch is deployed.
4. Archive the private reproduction materials named in the spec in the approved private evidence destination. Record the source checksum, runtime/lockfile revisions, MySQL versions, table/index definitions, and reproduction commands. Resolve the private destination before moving evidence; do not place the CSV, credentials, or raw research rows in Git.
5. Reconcile the current upload-audit/accounting work before editing worker retry or parse-reject handling. Reuse its reconciliation and reject-persistence helpers. If those changes are not integrated, record the exact dependency revision and leave end-to-end acceptance open until the six rejects survive the required retry scenarios.
6. Establish local-only MySQL fixtures and retain the integration suite's host guards. A full-size isolated Azure-representative run is a later acceptance gate, not permission to run tests against a live research database.

Implement the following steps in order. Storage readiness can be developed independently after preparation, but sequence edits to shared worker/repository files. This plan does not activate Forest Relay or require delegation.

## Step 1 Bind ingestion to the authorized scope

**Files:** `frontend/lib/uploads/ingest-batch.ts`, `frontend/lib/uploads/batch-family.ts`, `frontend/app/api/setupbulkprocedure/[fileID]/[batchID]/route.ts`, `frontend/lib/background-jobs/worker.ts`, and all direct-call fixtures.

- Add required `expectedScope: { plotID: number; censusID: number }` to `IngestBatchParams`. Validate positive integer scope values at the shared boundary. Do not fall back to newly discovered scope if the expectation is absent or invalid.
- Have the HTTP route retain the exact family scope passed to `requireUploadSessionOwnership` and forward it after authorization succeeds. Have the worker forward `job.plotID` and `job.censusID` from its persisted job. No HTTP parameter may substitute for that authorization.
- Reuse `discoverBatchFamily` and the existing scope-error family. Compare discovery against the expectation before acquiring the application lock, derive the lock from the expected scope, then discover and compare again after acquisition. Only the second discovery supplies authoritative work counts. Preserve the genuinely empty-family result.
- Apply validated scope predicates to every new SELECT/UPDATE. A changed scope must fail before failed-initial-census recovery, unresolved-row cleanup, or splitting.

**Validation:** Extend route authorization and real-MySQL ingestion tests. Change a family to another internally consistent plot/census between authorization and entry, and while waiting for the lock. Verify rejection and unchanged staging, metrics, and census data. Cover mixed scope, missing expectation, and empty input separately.

## Step 2 Make setup outcomes explicit

**Files:** `frontend/lib/db/connectionmanager.ts`, `frontend/lib/db/primitives.ts` if needed for shared types, `frontend/lib/uploads/ingest-batch.ts`, worker/error modules, the setupbulkprocedure route, and `frontend/components/uploadsystem/segments/uploadfiresql.tsx`.

- Introduce a typed transaction-callback timeout at the existing timer rejection site; retain its original message/cause compatibility. Add setup context at the ingestion boundary without substring matching unrelated timeout errors.
- Add optional generic transaction lifecycle notifications for commit start, acknowledgement, rollback, and cleanup. They must be independent of upload jobs, cannot throw into database work, and cannot await event persistence. Existing callers retain their behavior unless they opt in, except for required connection-safety fixes.
- Keep the timer covering the callback only. Capture callback duration, commit duration, cleanup duration, and total setup duration with a monotonic clock. Do not infer commit success from callback return. Distinguish cleanup failure after an acknowledged commit from failure to establish whether COMMIT succeeded.
- When acknowledgement is lost after COMMIT was sent, preserve the original cause in a typed uncertain-outcome error with code `SETUP_COMMIT_OUTCOME_UNKNOWN`. Discard the connection before the existing unconditional release path can return it to the pool. Reuse `discardTransaction` and its bookkeeping rather than adding another connection/slot cleanup mechanism.
- Ensure callback timeout/rollback paths preserve the original error, stop in-flight statements through existing DB primitives, and never release an untrusted connection. Exercise failed KILL acquisition and rollback failures as well as the successful cleanup path. Do not equate socket destruction with confirmed server settlement.
- Map unknown commit outcome to an existing fenced failed-job transition, with a recovery-required summary and no automatic retry. Handle it before destructive user-cancellation finalization, while preserving lease-loss fencing. Do not execute the stored procedure or move/delete staged rows on this path.
- Return a structured recovery-required response from setupbulkprocedure, using a non-retryable conflict response rather than the generic transient-error response. Audit the synchronous client's response parsing, retry loops, failure transfer, and session-cancellation cleanup; preserve the typed condition through all of them so it stops replay and automatic cleanup. Ordinary user cancellation continues using existing cleanup.

**Validation:** Use the actual ConnectionManager for timeout and cleanup integration tests. Add controlled commit transport-failure tests for both server-committed/lost-acknowledgement and uncommitted outcomes, plus delayed acknowledgement and cleanup failure after acknowledgement. Where a transport shim is required, label it fault injection and inspect durable database state independently. Assert no procedure call, poisoned-connection reuse, automatic re-stage, or cancellation cleanup after an unknown outcome. Assert the original cause survives failed diagnostics and cleanup. Test the HTTP client's behavior as well as the worker.

## Step 3 Implement the advancing splitter and boundary checks

**Files:** `frontend/lib/uploads/ingest-batch.ts`, existing batch-family helpers, ingestion and worker integration suites.

- Preserve recovery and unresolved-row cleanup order. Recompute count and maximum original-row ID after those operations. Use the post-lock family and verify pre-existing orphan membership is unchanged.
- Keep the no-split path for a small original batch without orphans. Otherwise start ordinals after `highestSubBatchOrdinal`, using `buildSubBatchID` unchanged.
- Read at most the configured batch size of ascending IDs with the full file/batch/plot/census scope, strictly above the cursor and at or below the fixed upper bound. Use lossless decimal strings, including SQL casts where needed to avoid mysql2 decoding through JavaScript Number. Do not change global driver number handling merely for this splitter.
- Update the scoped interval from the prior cursor through the last selected ID. Require selected and affected counts to agree before advancing. Abort on an empty selection while unassigned rows are expected. Keep parameters bound and the interpolated LIMIT validated.
- Check cancellation/lease-loss probes between iterations and before returning for commit. Verify original count equals assigned count, no original rows remain, and orphan membership remains intact. A mismatch rolls back setup. The small-file fast path does not require its original BatchID to disappear because it never split.
- At the shared boundary, abort restores assignments and orphans. At the worker boundary, existing explicit cancellation removes non-completed families and preserves completed results; lease loss leaves staging and state alone. Unknown commit handling from step 2 takes precedence over destructive cleanup.

**Validation:** Extend `ingest-batch.test.ts` and worker coverage with empty/boundary/multiple/partial batches, sparse and interleaved IDs, IDs above `Number.MAX_SAFE_INTEGER`, existing orphan families, special family characters, and BatchID length limits. Compare exact ID-to-batch membership with a frozen test-only legacy splitter seeded with identical IDs; do not retain a second production splitter. Inject failure in a later iteration, affected-count mismatch, new rows, scope changes, cancellation, and lease loss. Exercise HTTP/background equivalence and interrupted setup recovery.

## Step 4 Measure existing indexes before proposing a migration

**Files:** A deterministic setup benchmark under `frontend/tests/integration/` and reusable fixtures under the existing benchmark/test helpers. Only if an index is justified: a new migration under `frontend/db/migrations/schema-contract-repair/`, `frontend/db/sql/tablestructures.sql`, `frontend/lib/db/schema-contract.ts`, and their unit/migration-contract tests.

Run an explicit comparison matrix on identical fixtures:

| Variant           | Splitter               | Indexes                                    | Purpose                                      |
| ----------------- | ---------------------- | ------------------------------------------ | -------------------------------------------- |
| A                 | Frozen legacy behavior | Existing canonical/live-equivalent indexes | Comparable baseline                          |
| B                 | New scoped keyset walk | Same indexes as A                          | Determine whether existing indexes suffice   |
| C, only if needed | New scoped keyset walk | Existing indexes plus candidate            | Establish incremental benefit and write cost |

Use 412,421 accepted rows for full-size acceptance and smaller deterministic fixtures for routine CI. Include sparse/interleaved IDs, historical table sizes, realistic and stale optimizer statistics, and cold/warm runs. Capture actual SELECT and UPDATE plans, optimizer settings including index extensions, rows examined/affected, per-step timing, commit/cleanup timing, and full staging cost. Keep the existing stored-procedure scale benchmark; a setup benchmark does not replace its regression coverage.

If B meets acceptance, record the evidence and ship no index or schema-contract changes. If C is justified, add a canonical `idx_tmpm_file_batch_id` definition and migration through the existing schema-contract-repair mechanism. Do not remove other indexes or use a forced-index hint to satisfy the benchmark.

For the conditional migration:

- Define an explicit equivalence rule for this requirement alone: visible, non-unique, ascending BTREE with full leading columns `(FileID, BatchID, id)`. Preserve exact-name behavior for existing required indexes.
- Extend schema-contract metadata only as needed to inspect visibility, index type, prefix lengths, and ordering. Match the migration's SQL predicate and the contract's comparison through shared fixture cases; do not assume equal column names prove equivalence.
- Accept a differently named equivalent without creating another index. Reject an incompatible index occupying the canonical name with an actionable migration error. Incompatible aliases do not satisfy the requirement.
- Test absent/canonical/equivalent/invalid cases, reruns, fresh provisioning, and upgrades through the real migration-contract suite. Include canonical DDL and relevant fixtures, and prove unrelated missing named indexes still fail.
- Measure migration locking/runtime on a representative copy. Applying it to a live schema remains a separate authorized rollout action.

**Acceptance:** Median total setup duration over three comparable local runs is at most half the same-run baseline, with identical membership/outcomes. Three isolated Azure-representative attempts under representative load each complete total setup within 60 seconds. Neither target changes the callback timeout. If the targets fail, use measured step evidence to revise the approach; do not raise the timeout or claim the incident resolved.

## Step 5 Persist diagnostics for the correct attempt

**Files:** `frontend/lib/uploads/ingest-batch.ts`, `frontend/lib/background-jobs/{worker,repository,types,errors}.ts`, uploadjobs routes, and their tests.

- Add a typed optional setup-progress callback for discovery, lock waiting, post-lock validation, recovery, cleanup, splitting, and commit lifecycle. Set the active step before its first query and freeze the terminal diagnostic snapshot when setup exits. Distinguish attempted assignment counts from committed state.
- In the worker, use its already-unique `workerID` as attempt identity. Correlate events by job/attempt/file/batch, with safe schema/plot/census, step, timing, count, and outcome fields. Reuse existing logging and `background_job_events.Details`; bound sampling and buffering. A terminal snapshot must not depend on every progress write succeeding.
- Extend existing transition APIs to receive the captured attempt ID and optional safe failure context. Retain identity in waiting-retry/failed/cancelled/completed events even when the row clears WorkerID. For system reclaim, use the displaced claim only when it can be reliably tied to that guarded transition; otherwise leave context unknown. Do not weaken fencing or convert authoritative state-write failures into optional telemetry errors.
- Add one server-side failure-context selector shared by job list/detail responses. Resolve the transition for the current job state, then prefer its diagnostic snapshot or diagnostics matching that attempt and file/batch. Use bounded queries over already-authorized jobs. Do not fall back to the latest setup event from any attempt.
- On a new active claim, suppress old failure context. On missing, malformed, truncated, or ambiguous transition history, use a safe `lastError` fallback and omit an invented step. Late events from prior claims cannot supersede a newer transition. RetryCount is never the attempt key.

**Validation:** Extend repository and uploadjobs route tests with successive splitting-timeout/blob-failure attempts, unchanged retry counts, new claims, old-worker late events, system reclaim, incomplete event history, and malicious/malformed detail values. Assert scope/authorization and query bounds. Inject failed/slow diagnostic persistence and verify ingestion and authoritative job transitions retain their semantics.

## Step 6 Gate blob-reading claims on local readiness

**Files:** `frontend/config/macros/azurestorage.ts`, `frontend/lib/background-jobs/{worker,sweeper,errors}.ts`, startup/health integration only where existing surfaces need the readiness result, and worker/sweeper tests.

- Reuse `getBlobServiceClient` for validation/client construction. Sanitize SDK construction failures at their origin so neither logs nor returned causes expose credentials. Keep construction independent of container creation and network probes.
- Add an explicit injectable readiness dependency alongside `fetchFileText`. Validate before claims on direct dispatch and sweeper paths; a failure leaves the job and retry count unchanged. Keep the check inside the shared worker entry path as the backstop, not solely in a route.
- Determine the job's server-controlled pipeline before applying a blob-specific gate. The existing ArcGIS worker commits already-staged import-session rows and performs no blob download; missing storage configuration must not block that unrelated pipeline. Recheck the claimed pipeline before executing it if pre-claim metadata was read separately.
- Report a stable local configuration-error code through existing operational logging/health surfaces and use bounded log suppression. Keep sweeper stale-lease reconciliation and capacity limits functioning; an unavailable blob reader must not disable all sweeper duties.
- Preserve runtime handling for access/network failures after valid construction. Validate recovery after configuration correction and process restart/revalidation. No HTTP input may bypass readiness.

**Validation:** Missing/malformed configuration, safe logging of secret-bearing SDK failures, unchanged job state and retry budget, a healthy competing worker, correction/restart, direct dispatch and sweeper coverage, injected readers/readiness, and an ArcGIS job without blob configuration. Deployment verification separately checks every enabled worker/slot and read access to an approved test blob without container creation.

## Step 7 Render actionable upload status

**Files:** `frontend/components/client/uploadjobstatusbadge.tsx`, its tests, uploadjobs response types, and the synchronous upload client coverage from step 2.

- Show the safe failure summary on the visible card and include job ID, failed step when known, retry state, and safe technical detail in its modal. Distinguish automatic retry, retry exhaustion, and recovery-required unknown commit outcome.
- Label staging-derived processedRows as Rows staged; use Rows handled when provenance is ambiguous. Only display Measurements saved from authoritative reconciliation. Do not subtract failedRows from processedRows.
- Preserve active-job headline preference and discovery of prior failed jobs. Keep keyboard interaction and announce status transitions rather than every poll. Use the shared server-selected failure context so list and detail cannot disagree about attempts.

**Validation:** Failed/retrying/legacy/current-active states, multiple jobs, count provenance, missing context, recovery-required wording, keyboard access, and stable announcements across identical polls. Include a rendered interaction test where the existing pure helper tests cannot exercise accessibility behavior.

## Validation sequence and commands

Run focused checks after each step. The commands below use existing scripts from the reviewed integration baseline and run from `frontend/` in the isolated implementation checkout. Add new test filenames to the focused commands as they are created.

```sh
npm run test:unit -- lib/uploads/batch-family.test.ts lib/db/connectionmanager.test.ts 'app/api/setupbulkprocedure/[fileID]/[batchID]/route.test.ts' app/api/uploadjobs/route.test.ts 'app/api/uploadjobs/[jobId]/route.test.ts' components/client/uploadjobstatusbadge.test.ts components/uploadsystem/segments/uploadfiresql.test.tsx

npm run test:integration -- tests/integration/ingest-batch.test.ts tests/integration/setupbulkprocedure-authz.integration.test.ts tests/integration/withtransaction-timeout-cancellation.integration.test.ts tests/integration/ingest-batch-kill-boundary.test.ts tests/integration/upload-worker.test.ts tests/integration/upload-sweeper.test.ts tests/integration/background-jobs-repository.test.ts tests/integration/upload-pipeline-equivalence.test.ts

npm run test:integration -- tests/integration/ingestion-scale-benchmark.integration.test.ts tests/integration/schema-migration-contract.integration.test.ts
```

Before integration, run the applicable full unit/integration suites and build once focused failures are resolved:

```sh
npm run test:unit:ci
npm run test:integration
npm run build
```

Retain local-database host guards; do not substitute `test:integration:azure`. Run component/browser checks appropriate to the new rendered UI coverage. The full build includes type checking; formatting/lint checks alone do not. Record failures and environmental blockers separately from regressions. After modifying code, run `graphify update .` from the isolated repository root and inspect generated changes.

Full-size performance runs require a dedicated reproducible harness and archived results; do not imply the existing stored-procedure benchmark measures setup. Keep its old splitter only in test tooling. Record runtime/lockfile, fixture checksum/seed, resource limits, statistics, plans, run order/cache conditions, and every phase duration. Exercise the complete worker with reference data and census history, accounting for all 412,427 source records including six parser rejects. A deliberately setup-only run cannot satisfy end-to-end acceptance.

## Completion and rollout gates

1. **Implementation ready:** All six review decisions are represented in code and tests; the full pipeline preserves accepted rows and parse rejects across retries; scope and cancellation semantics agree across callers; unknown commit outcomes cannot be replayed automatically; diagnostics never borrow another attempt's failure; the index decision has evidence. Complete a final review in the same five passes and record findings or an explicit clean result for each pass.
2. **Local validation complete:** Focused and required broader checks pass, graph output is current, and local performance evidence is archived. Keep the original Azure cause unresolved unless comparable evidence identifies it. Local completion is not incident closure.
3. **Publication ready:** Prepare the exact PR title/body, diff, validation results, unresolved gates, and rollback instructions. Ask Mason before opening the PR, as required by AGENTS.md. No email is part of this work.
4. **Deployment ready:** Verify the deployed release and worker configuration, complete the isolated representative-environment tests, and prepare the concrete release action. If an index is justified, validate/apply it through the separately approved migration path before code relies on it. Confirm existing-index reuse explicitly otherwise. Account for releases that deploy automatically on integration.
5. **Recovery ready:** Refresh live job/staging/census counts and inspect source identity, completed batches, parse rejects, ownership, and replacement markers. For an unknown commit outcome, prove server transaction settlement and durable state first. Present a separate concrete recovery action for authorization; never blindly requeue a clean replacement, reset retry counters, or delete residual staging.
6. **Incident closure:** After authorized recovery, reconcile all source outcomes, verify earlier censuses are unchanged, archive evidence, and record unresolved row issues. A completed job label alone does not close the incident.

Rollback restores the previous release while retaining compatible family IDs, diagnostics, any justified additive index, and private source/evidence artifacts. Confirm interrupted transaction settlement and ownership before another worker runs. Keep recovery-required jobs failed and excluded from automatic replay across rollback. Application rollback does not undo committed ingestion data.
