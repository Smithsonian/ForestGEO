# DBH adversarial review verification

Review target: draft PR #473, originally `1f7cda00`, against `forestgeo-app-development`. Findings were checked against source, the original pre-feature predicates, and real MySQL behavior. No production mutations were performed.

| Finding | Verdict | Resolution |
| --- | --- | --- |
| 1. Full-census pair materialization | Confirmed | Bulk calls materialize pending measurements only. An explicit measurement ID retains diagnostics for every validation state; pair predicates and the three-argument interface remain shared. |
| 2. Silent DBH-floor exclusions | Confirmed observability gap; the 10 mm floor itself is required | Added a separate failed-floor counter (including missing DBH), parser support, re-score run/artifact counts, and post-commit operator warnings for normal single/combined DBH execution. Tests cover unit conversion, status exemptions and pending-only counts. Valid but incorrectly configured units cannot be inferred automatically. |
| 3. Disabled rules block routine deployment | Confirmed | Seed refresh accepts existing disabled rules and preserves flags. The actual re-score sweep still rejects disabled rules. |
| 4. Unmigrated deployment targets disagree | Confirmed | Reused the procedure deployment migration check, reported/skipped unmigrated all-site targets, and rejected explicit stale targets or missing migration status. |
| 5. Remote certificate validation disabled | Confirmed | Both DBH CLIs share remote TLS options requiring certificate-chain and hostname verification. Local loopback fixtures retain their existing plaintext connection. |
| 6. Unbounded non-measurement upload request | Not introduced by PR #473 | The committed PR still has the quadrats-only exception. The reported line belongs to pre-existing uncommitted issue #472 work. Preserved those edits separately; restoring ordinary chunking there would reintroduce #472's per-chunk deletion bug. Any inclusion needs a bounded file/session design that also preserves atomic replacement. |
| 7. Scrub reset/resolve stem mismatch | Confirmed | Both halves now consistently exclude rows with no StemGUID. Retained this ingestion-state protection instead of expanding reset to rows the DBH comparator cannot evaluate. |
| 8. Legacy growth missing positive-prior gate | Confirmed | Restored the original shared `MeasuredDBH > 0` gate for both rule kinds. Regression cases use 0→100 and -1→100, which would otherwise trigger growth, plus zero-prior shrinkage. |
| 9. Raw rollback seed SQL re-enables rules | Confirmed in standalone asset; automated rollout already used the targeted refresher | Duplicate-key updates preserve existing IsEnabled values. Real-DB replay tests cover disabled rules. |
| 10. Diagnostics depend on connection default schema | Confirmed | Explicitly qualified temporary-table SELECT and DROP with the requested schema. Real-DB diagnostics pass while the connection default is another database. |

The release hold and operator preparation remain in force. The new fixes do not change the annual thresholds, raw measurements, atomic census boundary, commit-outcome reconciliation, or legacy rollback transaction protections. The previous production-copy rehearsal remains historical evidence at its recorded revision; current acceptance is recorded below after the regression gates complete.


## Validation and revision provenance

Runtime fixes are in `7ad28bb7`, rollback corrections in `87bc1fc1`, and deployment/TLS corrections in `bfcca579`. The production build, formatting/lint, 32 focused unit tests, typing ratchet (486 against 489), and cycle ratchet (33 against 33) passed. The full workspace unit suite passed 4,140 tests with 4 skipped; that workspace also contained the separately preserved #472 upload edits. The PR checks verify the committed source independently of those edits.

The first full local MySQL pass completed 131 suites and exposed three mistakes in newly added fixture expectations/parameterization. Both affected suites passed after correction (6 diagnostics tests and 5 deployment tests); the other 129 suites had passed. A fresh complete serialized pass is part of the final handoff, with its log and PR checks retained in the private release packet.

The shared TLS helper also completed a real read-only connection to the approved Azure target with certificate-chain and hostname verification enabled: `SET SESSION TRANSACTION READ ONLY`, `BEGIN`, `SELECT 1`, and `ROLLBACK`. No production data was modified. Existing tests continue to cover lost commit acknowledgement, delayed InnoDB undo, atomic artifacts/views, and the largest-scope rollback boundary.
