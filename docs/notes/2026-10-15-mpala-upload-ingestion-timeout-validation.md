# Mpala upload ingestion timeout — implementation and validation

Date: 2026-10-15. Branch: `codex/mpala-upload-ingestion-timeout`.
Integration baseline: `aba6cf848eb5dee0c34e42bb95b83382f1b78352` from the then-current remote `forestgeo-app-development`.

The [implementation plan](2026-10-15-mpala-upload-ingestion-timeout-plan.md) and [specification](2026-10-15-mpala-upload-ingestion-timeout-spec.md) are the input requirements. Implementation used three Luna subagents in an isolated checkout; the original working tree and its unrelated changes were preserved.

## Result

- The shared HTTP/background ingestion boundary requires the caller-authorized plot/census and revalidates it with a current read after locking.
- Setup uses a scoped, ascending keyset walk with decimal-string BIGINT IDs, a fixed upper bound, affected-row checks, orphan checks, and atomic rollback on cancellation or mismatch.
- The existing 120-second callback timeout remains unchanged. Generic transaction lifecycle events distinguish callback, acknowledged COMMIT, rollback, unknown COMMIT outcome, and cleanup. Untrusted connections are discarded using existing bookkeeping.
- Unknown setup COMMIT outcomes produce `SETUP_COMMIT_OUTCOME_UNKNOWN`, terminal recovery-required worker failures, and non-retryable HTTP 409 responses. The synchronous client holds its session before showing an error, suppressing replay, failure transfer, and automatic unmount cleanup.
- Blob-reading workers validate local SDK construction before claiming. ArcGIS staged imports remain independent of blob configuration. SDK construction errors are sanitized.
- Setup diagnostics retain the unique claim, file, batch, step, attempted assignments, and lifecycle timings. Authoritative transitions and their events are atomic; list/detail failure summaries share a bounded attempt-aware selector.
- The visible status explains failure/retry/recovery and labels staging counts honestly. Keyboard interaction and stable live announcements are covered by rendered tests.

## Validation

| Check                                         | Result                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:unit:ci`                        | Passed: 261 files, 4,177 tests.                                                                                                                      |
| `npm run test:integration`                    | Full run: 139 files passed; one authorization fixture failed. Corrected fixture and final focused rerun: 6 files / 49 checks passed (details below). |
| `npm run build`                               | Passed, including formatting, lint, Next compilation/type checking, and 69 static pages. Existing warning-only lint messages remain.                 |
| Standalone `tsc --noEmit --incremental false` | Same 90 test-file diagnostics as the clean baseline; no additional normalized diagnostics.                                                           |
| `graphify update .`                           | Passed: 4,793 nodes / 8,305 edges from the final AST-only refresh; generated output remains ignored.                                                 |
| PR dependency-cycle / any-escape gates        | Passed at their existing baselines: 33 cycles / 489 any escapes.                                                                                     |
| `git diff --check`                            | Passed.                                                                                                                                              |

Full-size setup measurements deliberately stop before the stored procedure; they are not full-source upload acceptance. The benchmark is synthetic and includes controlled transport/timeout fault injection in separate correctness tests. Fault injection is not reproduction of the original Azure performance failure.

Final implementation/benchmark source revision: `082b2529a3b241e43d80fb661d63f1bf4cc86f47` (the evidence-only commit follows it).

Runtime: Node `v25.2.1`, npm `11.6.2`, MySQL `8.0.36`, InnoDB buffer pool `268435456` bytes. Package-lock SHA-256: `7a07d18cdf95027343657ea506ba5b322ec711e6d170433182bd9a02e50ab769`.

The initial focused baseline had six existing setup-route test failures; those fixtures were updated. A clean baseline TypeScript snapshot reports 90 diagnostics, all in tests. Final checks compare against that snapshot rather than treating those failures as new implementation defects.

## Local setup performance and index decision

The full-size benchmark uses 412,421 synthetic accepted rows plus 50,000 interleaved, untouched history rows. Each arm starts with a truncated test-only staging table, reset AUTO_INCREMENT, and independently inserted identical IDs. Exact staged/final membership hashes agree across every arm. Three A/B pairs alternate order; no other test or database workload ran concurrently. Cache conditions are explicitly **warm after staging in a shared local buffer pool**; no cold-cache claim is made.

A is the frozen test-only legacy LIMIT loop. B runs the actual shared ingestion setup, including discovery, locks, recovery checks, cleanup checks, split verification, COMMIT and connection cleanup, stopping before the stored procedure. A includes the application lock and transaction lifecycle but omits B's additional setup validation queries; this is a conservative timing comparison for B. The configured 10,000-row split size and 120-second callback timeout are unchanged.

| Statistics                                              | Legacy A median | Keyset B median | B / A | Local ≤ 0.50 target |
| ------------------------------------------------------- | --------------: | --------------: | ----: | ------------------- |
| Frozen while empty, auto-recalc disabled before staging |        43.744 s |        17.442 s | 0.399 | Passed              |
| Fresh ANALYZE after each staging, auto-recalc disabled  |        38.925 s |        17.403 s | 0.447 | Passed              |

The frozen runs were A = 43.744 / 43.975 / 43.321 seconds and B = 17.550 / 17.442 / 16.742 seconds. The fresh-statistics runs were A = 38.786 / 40.718 / 38.925 seconds and B = 17.403 / 17.056 / 18.474 seconds. Both three-pair acceptance assertions passed. The [machine-readable evidence archive](2026-10-15-mpala-setup-benchmark-evidence.json) retains the failed exploratory run and both final comparisons with complete emitted phase/event fields. In the first pair, the captured setup-thread statement events examined 9,124,106 rows for A and 2,621,810 for B; both affected exactly 412,421 rows. These are actual MySQL performance-schema counts, not EXPLAIN estimates. Prepared Execute events have null SQL text; the archive retains their raw per-thread sequence without inventing a statement mapping. Actual SELECT/UPDATE shapes, first/last-window EXPLAIN plans, optimizer settings (including index extensions), index definitions, staging cost, and callback/commit/cleanup/total durations are also retained. Capturing the transaction thread adds one small SELECT to both arms; its measured overhead is included and reported.

The first exploratory full-size run reused rows through repeated in-place resets and missed the target (median B 34.653 s / A 47.750 s, ratio 0.726). It is retained as failed exploratory evidence, not silently discarded. The final harness restages each arm to avoid unequal physical fixture histories. Setup was also revised to combine the post-recovery original count and upper-ID snapshot. Review retained the final whole-family current read because READ COMMITTED row locks do not exclude phantoms; a late-family-row fault-injection test verifies rollback.

The existing-index B result supports shipping **no new index or schema-contract migration**. The optional candidate-C arm remains test-only tooling; a small diagnostic run does not justify a production index. Canonical indexes must still be present in the deployment environment. These local, setup-only results do not waive cold-cache, representative Azure, or full-source pipeline acceptance.

## Additional verification detail

The full integration run completed 140 files: 139 passed; the only failure was the setup authorization fixture's stale query sequence (1,345 passing checks, one failure, seven pre-existing skips). The fixture was corrected to respond to query meaning and a scope-drift regression added. After the final setup changes, the six relevant ingestion/worker/authorization integration files passed all 49 checks. The full run also passed the real transaction timeout/COMMIT fault-injection, repository transition atomicity, schema migration contract, and stored-procedure scale suites. This records the full run and targeted rerun honestly rather than claiming a second full-suite execution.

The failed-census recovery regression seeds failed metrics for the original batch, its orphan, and an adjacent wildcard-like family, then proves exact current-family preservation and neighbor cleanup. An optional temporary production-code mutation was rejected by automatic approval review; production code remained intact. A safer negative control executed the old and new predicates only on synthetic TEMPORARY tables in a uniquely named local test schema, then removed that schema: old exact-batch exclusion deleted the orphan; escaped-family exclusion retained it. No real staging table or private research row participated.

## Operational evidence and remaining rollout gates

Read-only inspection found the latest successful development workflow used the integration SHA above: [deployment workflow](https://github.com/Smithsonian/ForestGEO/actions/runs/38478773222). Azure reported one development instance, no additional deployment slots, and an active successful deployment ending `2026-10-13T22:50:23.5029634Z` (deployment ID `525b3c96-3a3a-457a-882d-5fdc6c8cec1b`). Storage and async-worker settings are present. These observations do not establish the loaded revision or syntax/read access on every running process; verify those before rollout.

The approved private evidence destination remains unresolved. The original reproduction artifacts remain in `/private/tmp/mpala-diagnosis-20261015/`; no research CSV, credentials, raw research rows, or private reproduction logs were added to Git. Archive those materials before temporary-file expiry. Source CSV SHA-256: `700850f3200b745b299b9557b8b4fde81b2e9a705eb184e1b57c017bcf558102`.

Before deployment/recovery:

1. Archive the private source/reproduction evidence and confirm every enabled worker's loaded release, configuration, and read access to an approved test blob.
2. Complete controlled cold-cache and Azure-representative full-size runs, including three total setup times under 60 seconds and representative concurrent load.
3. Run the complete 412,427-source-record worker pipeline with reference data/census history and reconcile all persisted outcomes, including six parser rejects. Smaller synthetic tests prove retry preservation but do not satisfy this full-source acceptance gate.
4. Reinspect live ownership, family state, completed batches, reconciliation, prior censuses, and replacement markers. For unknown COMMIT outcomes, establish server settlement and durable state before a separately authorized recovery action.

The original Azure timeout trigger remains unproven. This branch is not incident closure and authorizes no production deployment, migration, research-data cleanup, or live retry.

## Rollback

Restore the previous application release while retaining compatible batch IDs, diagnostic history, source blobs, and private evidence. Keep recovery-required jobs failed and outside automatic replay, including across rollback. Confirm server transaction settlement and ownership before another worker runs. Application rollback does not undo committed measurements. There is no request-time schema repair.

## Review

Codex completed and repeated the five separate review passes on the final code revision in this order. Review findings were corrected and rechecked before the final result:

1. Security and input validation: no remaining actionable findings. Authorized scope is retained across callers, SQL values remain bound, and storage SDK failures do not expose credentials.
2. Correctness and edge cases: no remaining actionable findings. Numeric ID ordering, current reads after locking, small-file behavior, orphan isolation, interval counts, scope drift, and cancellation/lease boundaries are covered.
3. Error handling and resource cleanup: no remaining actionable findings. Unknown COMMIT outcomes are held for recovery; failed KILL/rollback/unlock/release paths discard untrusted sessions and retain original errors.
4. Testability and observability: no remaining actionable findings. Terminal diagnostics freeze, asynchronous telemetry cannot replace work outcomes, lifecycle timings survive persistence, and transition events retain authoritative claim identity.
5. Technical debt, complexity, and reuse: no remaining actionable findings. The shared ingestion mechanism, naming helpers, connection bookkeeping, readiness constructor, and server failure selector are reused; the legacy splitter exists only in test tooling.

Remaining operational acceptance gates are listed above; a clean code review does not waive them.
