# Mpala upload ingestion timeout — fix specification

**Date:** 2026-10-15

**Status:** Proposed. Specification only; implementation and production recovery are not authorized by this document.

**Investigation baseline:** `369f0f90a5821cc3ac638fdf12693e966c5895db`. Reconcile this design with the current development branch before implementation, particularly the ingestion atomicity and upload audit changes already in progress.

**Reviewed integration baseline:** `forestgeo-app-development` at `aba6cf848eb5dee0c34e42bb95b83382f1b78352`, verified against the remote branch on 2026-10-15. Implementation sequence: [Mpala upload ingestion timeout implementation plan](2026-10-15-mpala-upload-ingestion-timeout-plan.md).

## Problem and evidence

Mpala's third-census CSV uploads successfully, but background processing fails during ingestion. The interface does not make the reason apparent without opening the upload-job details.

Read-only inspection of the live database found:

- Jobs 25 and 26 exhausted their retries at 45% with `Transaction … timed out after 120000ms`.
- Each staged 412,421 rows and reported six rejected rows from `Mpala_Tree_Census_2026-10-10.csv`.
- At inspection, census 3 had no core measurements or stems, and 412,421 rows remained in `temporarymeasurements` under the original batch ID. This is a snapshot, not a guarantee that future failed uploads leave no partial results.
- Job 24's final error was `AZURE_STORAGE_CONNECTION_STRING environment variable is not set`. Its file record also showed staging from another attempt. The configuration error is a separate worker problem, not the explanation for every attempt.
- The CSV contains 412,427 records and six empty species codes. Its size, 25,129,255 bytes, is below the corrected 100 MiB upload limit. Its headers and CSV structure are valid.

### What the reproduction established

The reproduction used the real CSV, a copy of the live staging-table definition and indexes, the shared measurement parser, the real `ingestBatch` function, and the real `ConnectionManager` with its unchanged 120-second transaction-callback timeout. This timeout ends before COMMIT; it is not a deadline for the entire setup lifecycle. Staging inserts were performed directly into an isolated local test schema. The run stopped deliberately after setup, before stored-procedure ingestion, and removed the schema afterward.

| Measurement                        |      Result |
| ---------------------------------- | ----------: |
| Accepted / rejected records        | 412,421 / 6 |
| Parsing and staging                |     21.92 s |
| Ingestion setup                    |     47.55 s |
| Time in 42 batch-splitting updates |     47.03 s |
| Other setup work, approximately    |      0.52 s |
| Timeout reproduced locally         |          No |

Local MySQL was 8.0.36 with a 256 MiB buffer pool. Azure reported 8.0.46-azure with a 5 GiB buffer pool. The local fixture did not reproduce Azure load, hardware, optimizer statistics, or the site's historical census data. Long statement-history collection was disabled on Azure; retained digests did not identify the slow statement from these attempts.

The production timeout is confirmed. Batch splitting is the dominant measured local cost and the leading optimization target. **The exact production timeout trigger remains unproven.** Neither the local benchmark nor the job's 45% milestone proves which statement was running at the timeout.

Private reproduction materials currently reside in `/private/tmp/mpala-diagnosis-20261015/`: `repro.test.ts`, `repro.config.mts`, `reproduction-evidence.json`, `production-schema.jsonl`, and `server-timings.jsonl`. Archive them in the project's private incident-evidence location before temporary files expire. Do not commit the raw census file or credentials.

Source CSV SHA-256: `700850f3200b745b299b9557b8b4fde81b2e9a705eb184e1b57c017bcf558102`.

## Goals and boundaries

1. Reduce setup work for large staged files while retaining the existing atomic setup transaction and 120-second pre-commit callback timeout.
2. Identify the precise setup step and useful progress when a timeout occurs.
3. Prevent a worker with missing or malformed storage configuration from claiming uploads and consuming their retry budgets.
4. Explain background failures on the visible upload status, with honest row-count labels.
5. Demonstrate correctness and performance on representative data before claiming that the Mpala incident is fixed.

Keep the existing 100 MiB source-file limit, default 10,000-row ingestion batch size, upload modes, authorization, lease fencing, session ownership, reconciliation, and shared synchronous/background ingestion mechanism. Do not change biological validation rules, invent species codes, add a new queue, or raise the global transaction timeout. Do not split setup into independently committed transactions in this change: that would introduce new partial-setup recovery semantics.

## Proposed design

### 1. Instrument the setup transaction

Add a small typed setup-progress callback to the shared ingestion mechanism. It is optional for existing callers and has no dependency on the background-job repository or UI.

Report these steps separately:

- Family discovery and scope validation.
- Application-lock acquisition, followed by authoritative family revalidation.
- Failed-initial-census recovery.
- Cleanup of matching unresolved ingestion failures.
- Batch splitting.
- Setup commit, followed by stored-procedure ingestion.

For each step, record monotonic elapsed time, attempt correlation, schema/plot/census, file/batch identity, row count when known, and outcome. Splitting additionally reports completed batch count, rows assigned, and the current statement's operation name. Track the active step before awaiting its first query so timeout reporting identifies in-flight work.

Preserve the original exception and cause. Add a typed setup-timeout context at the ingestion boundary; do not classify all errors containing the word “timeout” as this condition. Reuse or minimally extend the shared transaction-timeout error type if the implementation branch has one. Distinguish waiting for a lock from executing a query and rolling back.

Use existing structured application logging and `catalog.background_job_events.Details`. Persist step transitions and a bounded sample of splitting progress, plus one terminal diagnostic event. Do not persist one event per source row, raw CSV values, connection strings, or SQL parameter dumps. No new phase enum or telemetry table is required.

Diagnostic events describe attempted work until setup commits. After rollback, do not display attempted batch assignments as durable progress. Timing callbacks must not silently extend the transaction budget or alter its outcome; event-write failures are logged and must not replace the original ingestion error. Preserve existing authoritative job-state-write requirements.

#### Commit boundary and uncertain outcomes

Preserve the existing timeout boundary: `withTransaction` times the setup callback, then clears that timer before COMMIT. Connection acquisition/configuration, COMMIT, and final cleanup are outside that timer. This change does not add a COMMIT timeout or claim a 120-second wall-clock bound for all setup work. Record callback, commit, cleanup, and total setup durations separately. Performance acceptance measures through acknowledged commit and connection/lock cleanup, not merely callback return.

Observe COMMIT at the connection-manager boundary, with optional generic lifecycle notifications that cannot throw into the transaction or await diagnostic persistence. Report commit started before sending COMMIT, committed only after acknowledgement, and commit outcome unknown when a transport failure after sending COMMIT prevents determining its result. Preserve the original error as the cause of a typed uncertain-outcome error; a later rollback attempt or socket close does not prove that COMMIT failed.

On an uncertain commit outcome, discard the untrusted connection using the existing `discardTransaction` mechanism before it can be returned to the pool. Do not start the stored procedure, report a confirmed rollback, delete staged families, or automatically re-stage/retry the upload. The worker records a fenced terminal failure with stable code `SETUP_COMMIT_OUTCOME_UNKNOWN` and a recovery-required summary, using the existing failed status. This condition takes precedence over destructive cancellation cleanup; lease loss still forbids writes by the old worker. The HTTP caller receives the same recovery-required classification and must not automatically replay it. Recovery must establish server transaction settlement, ownership, and durable family state before a separately authorized retry. Ordinary failures with confirmed rollback retain the existing bounded retry policy.

### 2. Make batch splitting advance through row IDs

Today, every split executes a scoped `UPDATE … ORDER BY id LIMIT 10000`, starting again from the original batch predicate. All 42 updates share the setup transaction. The repeated selection and ordering is a performance risk; the local measurements establish cost, not a verified Azure query plan.

Replace this loop with a keyset walk: each iteration starts strictly after the last assigned row ID. Keep the existing batch-family naming helpers and batch-size configuration.

Within the existing setup transaction and application lock:

1. Require an `expectedScope` containing the caller's authorized plot/census in `IngestBatchParams`. The HTTP route passes the exact scope checked by `requireUploadSessionOwnership`; the worker passes its persisted job scope. Do not derive this expectation from a new ingestion-side discovery or accept an unverified HTTP scope. Compare the discovered family to that expectation before acquiring a lock, lock the expected scope, and discover/compare again after acquisition, before recovery or cleanup. Reject both mixed families and a completely different but internally consistent scope with a typed scope conflict. Do not act on counts obtained before waiting for the lock. Update every caller, including tests, rather than allowing an omitted scope to bypass the check.
2. Run existing recovery and cleanup in their established order. Derive the original batch's count and maximum row ID after any step that can change staged rows. The maximum ID is the fixed upper boundary for this split.
3. Preserve existing orphaned sub-batches. Start new ordinals after `highestSubBatchOrdinal`, retaining the current no-split fast path for a small original batch without orphans.
4. Select at most the configured batch size of IDs, ordered ascending, from the original file/batch and validated plot/census, with `id > lastAssignedID` and `id <= upperBoundaryID`.
5. Update only that scoped interval, from the prior cursor through the last selected ID, to the next `buildSubBatchID` value. Keep file, original batch, plot, and census predicates on the update. Rows belonging to other files or censuses inside the numerical interval must remain untouched.
6. Require the affected-row count to equal the selected-row count. Advance the cursor only after that update succeeds. Check cancellation and lease-loss signals between iterations and before commit.
7. When splitting was required, verify that the original count equals the sum assigned, that no original-batch rows remain, and that existing orphan membership was preserved. The no-split fast path retains its original BatchID and instead verifies the unchanged scoped membership. A mismatch, unexpected new row, or scope change fails and rolls back setup. Never “repair” the count by ignoring rows.

Treat IDs as MySQL unsigned BIGINT values throughout. Return decimal strings or use lossless bigint handling; do not convert IDs to JavaScript `Number`, including cursors and interval endpoints. SQL values stay parameterized; schema identifiers retain existing validation/escaping, and any interpolated LIMIT uses the existing validated positive-integer configuration.

The cursor is transaction-local. It is not a new persisted checkpoint. If an iteration fails, all newly assigned batch IDs roll back together. Previously committed orphan batches remain discoverable through the existing family resolver. A restart uses that resolver rather than a client-side cursor.

#### Index support

First evaluate the new scoped SELECT and UPDATE using existing indexes. The canonical table already has `(FileID, BatchID, PlotID, CensusID)` and `(FileID, BatchID, CensusID)`. Because the new queries constrain plot/census by equality and InnoDB extends secondary indexes with the primary key `id`, those intervening columns do not inherently prevent an ordered ID walk. They are candidates for reuse, not proof of the actual chosen execution plan. See [MySQL index extensions](https://dev.mysql.com/doc/refman/8.0/en/index-extensions.html).

Add `(FileID, BatchID, id)`, canonically named `idx_tmpm_file_batch_id`, only if comparative plans and timings demonstrate that it is needed to meet acceptance. Include its staging-insert and BatchID-update maintenance cost in the comparison. If existing indexes suffice, ship no index migration or new contract requirement.

If the additional index is justified, use the established migration/contract mechanism and canonical table definition. The migration and contract must share the same equivalence rule: a usable visible, non-unique ascending BTREE index with those full, ordered leading columns may satisfy this particular requirement under a different name. Extend the contract narrowly for this requirement; retain exact-name checks for all existing required indexes. Do not accept prefix-indexed columns, hidden indexes, or incompatible shapes, and fail explicitly on an incompatible index occupying the canonical name. Test migration and contract together with a differently named equivalent index: migration creates no duplicate and the contract passes. Do not create or alter indexes inside an upload transaction. Preserve existing indexes in this change; removing overlaps needs a separate caller/query audit.

Inspect the actual SELECT and UPDATE execution plans before and after the change, including sparse/interleaved IDs and realistic statistics. Require evidence that the index and advancing cursor avoid repeated scanning of the already-assigned prefix. Do not add a forced-index hint or claim linear performance solely from the proposed SQL shape. If plans or timings disprove this design, revise it before implementation acceptance.

### 3. Preserve ingestion and recovery guarantees

The shared `ingestBatch` entry point remains the only implementation used by HTTP uploads and background jobs. The stored procedure starts only after setup commits.

Maintain these invariants:

- Ascending staging-ID order produces the same batch membership as the old splitter for the same initial state and configured batch size, including a short final batch.
- File/batch family isolation, escaped LIKE patterns, batch-ID length limits, and mixed-scope rejection are unchanged.
- Existing sub-batch IDs and completed-batch/idempotency behavior remain compatible across deployment and rollback. No new suffix format or source-row identity is introduced.
- At the shared ingestion boundary, cancellation or lease loss detected before COMMIT rolls back setup, restoring original assignments and pre-existing orphan membership. It must not enter the later procedure-failure path that transfers rows into unresolved measurements. At the worker boundary, explicit user cancellation then retains the existing cleanup policy: delete non-completed staged families while preserving completed results. Lease loss performs no such cleanup or state writes by the former owner. Test both boundaries separately; retention after setup rollback is not a promise of retention after worker cancellation finalization. Unknown commit outcomes use the recovery-required handling above instead of destructive cleanup.
- A timeout preserves the original error while the shared connection manager kills/discards the timed-out connection and releases its locks. Do not return that connection to the pool while work may still be running.
- Keep parse-reject persistence and census-replacement ordering intact. In particular, the six parser rejects must not disappear or be counted twice on a successful retry. Coordinate with the pending upload-audit/accounting work instead of recreating its helpers.

Keep the current bounded job retry policy for transient failures. Do not add another nested setup retry loop. Record each timeout's step and progress so repeated deterministic failure is visible rather than masked by a new attempt.

### 4. Check storage configuration before claiming work

Reuse `getBlobServiceClient`'s configuration parsing; do not introduce a second connection-string parser. Separate validation/client construction from any container creation and ensure errors cannot expose credential values or SDK messages containing secrets.

Check configuration before the real blob-reading worker starts claiming jobs, on both direct dispatch and sweeper paths. A missing or malformed configuration must:

- Leave the job unclaimed and its retry count unchanged, allowing a correctly configured instance to process it.
- Mark the local worker as unavailable in existing operational health/logging surfaces, with a stable configuration-error code. Apply existing sweeper backoff or bounded log suppression so an unhealthy instance does not spin or flood logs.
- Leave unrelated app functions available. Do not mark every queued job permanently failed because one instance is misconfigured.
- Recover when configuration is corrected and the affected process is restarted/revalidated.

Tests using an injected file reader must explicitly inject the corresponding readiness dependency; a caller-controlled HTTP flag must never bypass production readiness checks. Credential/network access failures after valid client construction remain distinguishable from missing local configuration and retain appropriate existing runtime failure handling.

A deployment check must verify configuration on every enabled upload-worker instance/slot. Constructing an SDK client validates configuration syntax only; separately verify read access to an approved test blob, without creating containers or touching a researcher's file.

### 5. Surface useful failure information

Extend the existing job response with optional structured failure context derived from stored job events: stable error code, last attempted phase/setup step, and a safe user-facing summary. Keep `lastError` compatible for existing consumers and use a fallback for older jobs with no structured context. This requires no new database column. Queries must retain current authorization, scope filtering, limits, and bounded event lookup.

Use the existing unique per-claim `workerID` as the attempt ID. Store it in setup diagnostics and carry the captured ID into the event for the corresponding waiting-retry, failed, cancelled, or completed transition even when that transition clears the job row's WorkerID. System reclaim events must identify the displaced claim when available; otherwise their failure context remains unknown. Do not use retry count as an attempt identity because scope-conflict retries need not increment it.

Select failure context from the authoritative failure/retry transition for the job's current state and that transition's attempt, file, and batch. Prefer a safe diagnostic snapshot attached to that transition; otherwise use only matching diagnostics from the same claim. Once a new claim starts, an older attempt's failure must not describe the active attempt. A later blob-read failure must not inherit an earlier setup timeout, and a delayed event from an old worker must not override a newer outcome. If the transition or matching context is missing, outside the bounded lookup, or ambiguous, use the safe `lastError` fallback without guessing a setup step. Optional diagnostic failures must not prevent the authoritative job transition; preserve existing state-write fencing and failure handling.

Show a concise summary on the visible failed-job card/badge, not only inside its modal. Details should include the job ID, failed step, retry state, and technical error. For a setup timeout, use wording such as:

> The file uploaded, but preparing its measurements took too long. Job 26 failed after its automatic retries. Contact support with this job number.

During automatic retry, say that the system is retrying. After exhaustion, do not encourage another identical upload. Do not promise that zero measurements were saved unless the job's persisted reconciliation proves it; another file or earlier batch may have committed.

The current `processedRows` value is incremented during staging. Label that value “Rows staged” where its provenance is staging, including a failure after staging. Where a legacy or mixed-pipeline record has ambiguous provenance, use a neutral “Rows handled” label. Show “Measurements saved” only from an authoritative ingestion/reconciliation count. Do not calculate it as `processedRows - failedRows`.

Preserve the current preference for an active job as the headline, but keep prior failed jobs discoverable. Support keyboard access and accessible status announcements without repeated announcements on every poll. No full job-dashboard redesign is required.

## Implementation areas

| Area                                               | Existing owner / expected change                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Setup, splitting, timeout context                  | `frontend/lib/uploads/ingest-batch.ts`                                                                                                 |
| Authorized scope and HTTP recovery response        | `frontend/app/api/setupbulkprocedure/[fileID]/[batchID]/route.ts` and its callers                                                      |
| HTTP recovery-required behavior                    | `frontend/components/uploadsystem/segments/uploadfiresql.tsx`; stop replay and automatic session cleanup for an unknown commit outcome |
| Family identity and scope                          | `frontend/lib/uploads/batch-family.ts`; reuse helpers                                                                                  |
| Transaction lifecycle and uncertain commit cleanup | `frontend/lib/db/connectionmanager.ts`; reuse `discardTransaction`, add typed outcomes and optional generic notifications              |
| Worker events, fencing, configuration readiness    | `frontend/lib/background-jobs/{worker,sweeper,repository,errors}.ts`                                                                   |
| Storage client validation                          | `frontend/config/macros/azurestorage.ts`                                                                                               |
| Job response and visible error                     | `frontend/app/api/uploadjobs/`, `frontend/components/client/uploadjobstatusbadge.tsx`                                                  |
| Conditional index and equivalence rule             | Established migrations, table definition, and schema contract; only if existing indexes fail the measured acceptance gate              |
| Regression coverage                                | Existing ingestion, worker, cancellation, transaction, and job-status suites                                                           |

Before coding, verify the live application's actual release SHA and worker configuration; the local investigation baseline is not proof of the deployed revision. Implement in an isolated checkout based on the current integration target and preserve unrelated working-tree changes. Follow the repository's graph-update requirement for code changes.

## Verification and acceptance

### Correctness tests

Use real local MySQL for SQL behavior and the actual ConnectionManager for transaction-timeout/cleanup tests. Required cases:

1. Empty input; below, exactly at, and just above one batch; multiple batches; final partial batch; and the unchanged small-file fast path.
2. Byte-for-byte batch membership equivalence between old and new splitters using identical seeded IDs. Include sparse IDs, interleaved unrelated files/censuses, IDs above `Number.MAX_SAFE_INTEGER`, and an existing orphan family.
3. Mixed scopes, special characters in family IDs, maximum supported BatchID length, and concurrent attempts for the same scope. Change an entire family to a different internally consistent scope between HTTP authorization and ingestion, and separately while waiting for the lock. Both HTTP and worker callers must reject the mismatch before recovery, cleanup, or splitting; absence of an expected scope is not an authorization bypass.
4. An error during a later split, an affected-row mismatch, cancellation, and lease loss. At the ingestion boundary, assert rollback restores all original assignments and pre-existing orphans, releases locks, and leaves no reused poisoned connection. At the worker boundary, assert explicit cancellation cleans non-completed families and preserves completed results; lease loss leaves retained staging and job state untouched by the old worker.
5. A real blocked-query/transaction-timeout test, with a disposable lock-holder and cleanup in `finally`. A shorter test timeout may validate the timeout handler, but must be identified as fault injection, not as reproduction of the Mpala performance failure.
6. Worker restart/retry after interrupted setup; equivalent outcomes from shared HTTP and background callers; no duplication or loss of accepted rows or parse rejects.
7. Missing/malformed storage configuration leaves jobs unclaimed; a healthy worker can claim them; no secret leakage; corrected configuration restores readiness.
8. Failed/retrying/legacy job UI states, visible error summaries, correct count labels, authorization of details, and multi-job display behavior.
9. Delayed COMMIT acknowledgement, COMMIT transport loss, and cleanup failure after acknowledged COMMIT. Assert separate timing/outcome reporting, preservation of the original cause, connection discard when untrusted, and no procedure execution or automatic retry/cancellation cleanup when commit outcome is unknown. Model both a server commit followed by lost acknowledgement and an uncommitted transaction; client-side error text alone cannot distinguish them. Test HTTP classification as well as worker finalization.
10. Different errors on successive attempts, a retry without incrementing RetryCount, a new running claim, a late event from an old worker, system reclaim, and missing/truncated/malformed diagnostic history. Assert displayed context belongs to the relevant transition and attempt, or falls back without a fabricated step. Fault-inject diagnostic writes to prove they do not change ingestion or authoritative state transitions.
11. If an index is added, test absent, canonical, differently named equivalent, prefix-indexed, hidden, descending, and incompatible same-name indexes through both migration and contract. Verify unrelated required-index name checks remain unchanged and rerunning the migration is idempotent.

### Performance and incident closure

Use deterministic synthetic fixtures in CI; keep the real census file private. Preserve the original 120-second callback timeout during the full-size acceptance run and record commit/cleanup time separately.

- Run old and new setup paths against equivalent 412,421-row staged fixtures with matching table definitions, indexes, and initial ID assignments. Record versions, resource limits, historical table sizes, optimizer statistics, query plans, per-step timings, rows examined/affected, and rollback time. Compare cold and warm runs rather than comparing different cache states as if equivalent.
- Compare the old splitter and new scoped splitter with existing indexes first. Evaluate the new splitter with the candidate additional index only if needed, including full-pipeline staging and index maintenance costs. Record the decision to reuse existing indexes or add the index before changing the schema contract.
- Local target: median setup duration over three comparable runs is at most half the same-run baseline, with no correctness difference. The historical 47.55-second result is context, not a portable pass/fail threshold.
- On an isolated environment representative of Azure, run three full-size attempts including representative concurrent load. Target total setup completion, including acknowledged COMMIT and cleanup, within 60 seconds in each run. This is a measured acceptance target, not a new runtime deadline; the callback timeout remains 120 seconds. If this fails, use the new timing evidence to address the actual slow step; do not raise the timeout to make acceptance pass.
- Exercise the complete worker pipeline with the necessary reference data and census history. Account for every one of the 412,427 input records through the existing reconciliation contract, including six missing-species parser rejects and any additional ingestion failures or duplicates. Do not require all 412,421 staged records to become valid saved measurements, and do not alter biological rules to reach a target count.
- A synthetic injected timeout proves error handling. A fast local run proves local behavior. Neither proves the original Azure performance failure was reproduced or removed. Record the original cause as unresolved until comparable-environment timing or an explicitly authorized instrumented retry identifies it and verifies the remedy.

Acceptance requires the relevant existing integration/unit/UI suites, new correctness and performance coverage, migration-contract checks, formatting/type/build checks appropriate to changed files, and archived evidence. A green test that deliberately stops after setup is not an end-to-end upload acceptance test.

## Rollout, recovery, and rollback

1. Archive private incident evidence and the source checksum. Confirm the actual deployed release and all worker instances. Record current Mpala job, staging, and census counts again; earlier snapshots may have changed.
2. If benchmark evidence justified an additional index, validate its additive migration and equivalent-index contract on a representative copy, including locking/runtime characteristics. Apply it through the approved migration path before enabling code that relies on it. Otherwise record reuse of existing indexes and omit the migration. Do not perform request-time schema repair.
3. Verify worker readiness across enabled instances, deploy the code through the normal release process, and inspect step timing/error reporting on test uploads before research-data recovery. Avoid old/new workers acting on the same job during rollout; use existing claim/fencing and deployment controls.
4. Prepare a separate, concrete Mpala recovery action for authorization. Inspect completed batches, residual staging, job ownership, source identity, parse rejects, and clean-reupload replacement markers first. Select the supported retry/recovery path based on that state; do not blindly enqueue a clean replacement, manually mark jobs successful, delete staged rows, or reset retry counts.
5. After an authorized recovery, reconcile source rows and persisted outcomes, verify that earlier censuses are unchanged, and record any unresolved row issues. An upload-job “completed” label alone is insufficient evidence.

Rollback restores the prior application release while retaining any additive index, compatible batch-family names, and diagnostic events. A setup transaction interrupted during rollback must finish or roll back before another worker takes ownership. A job with an unknown commit outcome remains held for recovery review; an older release must not automatically replay it. Retain source blobs, staging, and failure evidence. Verify outcome and ownership before any retry; code rollback does not undo data already committed by ingestion.

No email, pull request, production deployment, index change, or live upload retry is authorized by this specification. Communication and publication follow the repository's existing approval requirements.
