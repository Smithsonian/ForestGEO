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

| Check                                         | Result                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test:unit:ci`                        | Passed: 261 files, 4,177 tests.                                                                                                      |
| `npm run test:integration`                    | Full guarded-local suite in progress; final result below.                                                                            |
| `npm run build`                               | Passed, including formatting, lint, Next compilation/type checking, and 69 static pages. Existing warning-only lint messages remain. |
| Standalone `tsc --noEmit --incremental false` | Same 90 test-file diagnostics as the clean baseline; no additional normalized diagnostics.                                           |
| `graphify update .`                           | Passed: 4,785 nodes, 8,290 edges, 582 communities; generated output remains ignored.                                                 |
| `git diff --check`                            | Passed.                                                                                                                              |

Full-size setup measurements deliberately stop before the stored procedure; they are not full-source upload acceptance. The benchmark is synthetic and includes controlled transport/timeout fault injection in separate correctness tests. Fault injection is not reproduction of the original Azure performance failure.

Runtime: Node `v25.2.1`, npm `11.6.2`, MySQL `8.0.36`, InnoDB buffer pool `268435456` bytes. Package-lock SHA-256: `7a07d18cdf95027343657ea506ba5b322ec711e6d170433182bd9a02e50ab769`.

The initial focused baseline had six existing setup-route test failures; those fixtures were updated. A clean baseline TypeScript snapshot reports 90 diagnostics, all in tests. Final checks compare against that snapshot rather than treating those failures as new implementation defects.

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

Codex completed five separate review passes in this order. Review findings were corrected and rechecked before the final result:

1. Security and input validation: no remaining actionable findings. Authorized scope is retained across callers, SQL values remain bound, and storage SDK failures do not expose credentials.
2. Correctness and edge cases: no remaining actionable findings. Numeric ID ordering, current reads after locking, small-file behavior, orphan isolation, interval counts, scope drift, and cancellation/lease boundaries are covered.
3. Error handling and resource cleanup: no remaining actionable findings. Unknown COMMIT outcomes are held for recovery; failed KILL/rollback/unlock/release paths discard untrusted sessions and retain original errors.
4. Testability and observability: no remaining actionable findings. Terminal diagnostics freeze, asynchronous telemetry cannot replace work outcomes, lifecycle timings survive persistence, and transition events retain authoritative claim identity.
5. Technical debt, complexity, and reuse: no remaining actionable findings. The shared ingestion mechanism, naming helpers, connection bookkeeping, readiness constructor, and server failure selector are reused; the legacy splitter exists only in test tooling.

Remaining operational acceptance gates are listed above; a clean code review does not waive them.
