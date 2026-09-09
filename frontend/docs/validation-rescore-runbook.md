# Annualised DBH re-score operator runbook

This procedure re-scores only validations 1 and 2, in census-number order. Each census is one transaction: reset, retirement, DBH checks, finalization, both materialized views, and the completed run record commit together. The database and artifact filesystem do not commit atomically; their outcomes must be reconciled separately.

Implementation and isolated-copy rehearsal do **not** authorize production deployment, a production sweep, or sending results. Mason owns the maintenance window and its release, or records a named delegate before starting. Push/PR and production operations require their separate handoff authorization.

## Rules and retained state

Growth flags above 65 mm/year; shrinkage flags at an annual relative change of −0.05 or below. Years are measurement-date days / 365.25. Both DBHs must be at least 10 mm (1 cm). Unequal non-NULL HOM suppresses a comparison; either HOM may be NULL. Missing, zero, and reversed intervals skip; short positive intervals remain eligible. The immediately preceding census **number** supplies valid prior measurements; a gap is not filled using the nearest older census.

Only DBH occurrences are resolved on rerun. An unchanged violation reopens the same occurrence, clears its resolution time, and updates its Prior* snapshot. Stale findings remain resolved, retaining their creation time and last comparison. These mutable rows are not an immutable history. Previously overridden DBH findings can reappear. Unrelated overrides are preserved by this DBH-only operation; unresolved non-DBH errors still affect final validity.

## Establish and retain writer isolation

The repository deploys Azure App Services `forestgeo-development` and `forestgeo-livesite` in `ForestGEO-ResourceGroup` (see `.github/workflows/dev-forestgeo-livesite.yml` and `main-forestgeo-livesite.yml`). Stopping these services is an available control for their ingress and in-process workers. A web page banner or the CLI host acknowledgement does not prevent writes.

Before deployment, Mason must inventory and stop or deny access to **every** additional writer: separately hosted workers, scheduler jobs, researcher SQL sessions, scripts, and other app versions. Confirm the deployed worker topology with the responsible operator. The repository alone cannot establish that this inventory is complete. **Do not apply while any writer or its isolation mechanism is unaccounted for.** Scope locks exclude cooperating callers, but raw-query mutations and older live code do not all honor them. Online re-scoring requires #465 or equivalent authoritative protection across all writers.

1. Freeze unrelated deployments and new submissions. Record the approved window, operator, target revisions, and writer inventory in the artifact directory.
2. Prevent new submissions to both apps using Azure ingress access restrictions approved for this environment; drain in-flight uploads/validations and database transactions. Do not stop a running validation and then treat its old run record as completed.
3. Stop both apps after draining. Where ingress restrictions cannot be established, stopping both apps prevents new app work, but any interrupted work must be explicitly reconciled and completed under controlled access before the sweep.

```sh
az webapp stop --resource-group ForestGEO-ResourceGroup --name forestgeo-development
az webapp stop --resource-group ForestGEO-ResourceGroup --name forestgeo-livesite
az webapp show --resource-group ForestGEO-ResourceGroup --name forestgeo-development --query state --output tsv
az webapp show --resource-group ForestGEO-ResourceGroup --name forestgeo-livesite --query state --output tsv
```

4. Verify separately hosted workers and direct writers are stopped/restricted too. Retain restrictions through deployment, verification, sweep, comparisons, reconciliation, and any rollback.
5. Deployment workflows restart apps. If deployment reopens ingress or restarts workers, immediately re-establish isolation and drain checks before continuing. Do not assume the pre-deploy stop persists.

A count of zero at one instant is evidence of a drained queue, not prevention of future work. The writer controls remain in force until explicit release.

## Read-only drain checks

Use each explicit target schema in place of `target_schema`; never paste arbitrary identifiers into SQL. Inspect existing table availability first. Missing required tables block revision verification; they are not evidence of zero work.

```sql
SELECT RunID, PlotID, CensusID, Status, StartedAt, CurrentStep
FROM target_schema.validation_runs
WHERE Status = 'running'
ORDER BY PlotID, CensusID, StartedAt;

SELECT session_id, plot_id, census_id, state, last_heartbeat
FROM target_schema.upload_sessions
WHERE state IN ('initialized', 'uploading', 'uploaded', 'processing', 'collapsing')
ORDER BY plot_id, census_id;

SELECT JobID, SchemaName, PlotID, CensusID, Status, WorkerID, WorkerHeartbeatAt
FROM catalog.background_jobs
WHERE Status IN ('queued', 'running', 'cancel_requested', 'waiting_retry')
ORDER BY SchemaName, PlotID, CensusID, JobID;

SELECT c.PlotID, c.CensusID, c.PlotCensusNumber, COUNT(*) AS EligiblePending
FROM target_schema.coremeasurements cm
JOIN target_schema.census c ON c.CensusID = cm.CensusID
WHERE c.IsActive = 1 AND cm.IsActive = 1
  AND cm.StemGUID IS NOT NULL AND cm.IsValidated IS NULL
GROUP BY c.PlotID, c.CensusID, c.PlotCensusNumber;

SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID() AND (DB LIKE 'forestgeo%' OR COMMAND <> 'Sleep');

SELECT trx_id, trx_state, trx_started, trx_mysql_thread_id, trx_rows_modified, trx_query
FROM information_schema.INNODB_TRX;

SELECT OBJECT_TYPE, OBJECT_NAME, LOCK_TYPE, LOCK_STATUS, OWNER_THREAD_ID
FROM performance_schema.metadata_locks
WHERE OBJECT_TYPE = 'USER LEVEL LOCK';
```

Current **and** immediate-prior pending work defer a scope. Running records block regardless of age. Verify stopped application work, absence of its server session/transaction, and released scope locks before an operator reconciles a stale normal run record through the normal lifecycle. Age alone is never permission for takeover. Do not use the manual reset button to recover a DBH attempt. Complete pre-existing pending work separately through normal validation and record any non-DBH override changes before restarting DBH preflight.

## Rehearsal and revision verification

Use a recoverable read-only production snapshot loaded onto an isolated server, with preserved procedures, seed definitions/descriptions, enabled states, and measurement/error/view data. Record snapshot start/end and consistency limits; source DDL during a single-transaction dump can invalidate consistency. Retain the original snapshot before any local definer rewrite.

Before production sign-off, the copy must demonstrate:

- Fixed-prior helper results and interval counts without durable changes, including Wytham.
- An ordered baseline, so earlier census validity can both enable and remove later comparisons.
- Confirmed rollback after reset, inside pair construction, after upsert, either view refresh, and before terminal recording, plus a direct DBH-only retry.
- Lost commit acknowledgement and post-commit artifact failure reconciliation.
- Old-rule rollback from the earliest affected committed census through every later census.
- The largest census transaction's row/pair counts, duration, artifact preparation, lock duration, commit/rollback time, and resource observations. Choose an explicit transaction timeout and full maintenance-window budget from these measurements. If cost is unacceptable, revise the design rather than adding intermediate commits.

Record unmeasured resources as unavailable. Historical counts (including 447 and Ngel Nyaki 7/313) are reference observations, not fixed acceptance targets. Explain differences using source changes, predicates, prior validity, and overrides.

The operator verifies every target schema before the first mutation: required tables, full definitions of both `BuildDBHChangePairs` and `RunSharedDBHChangeValidations`, both rule seeds and enabled states, and the executable revision. Verification compares parsed normalized bodies, allowing known SHOW CREATE/DEFINER formatting only; a marker substring is insufficient. The expected rollback manifest must describe the rollback bodies, not annualisation markers.

Deploy the reviewed development revision and DBH procedure/seed changes while preserving unrelated enabled configuration. The shared database gets the procedure change without a main promotion. The old live app retains its DELETE retirement until normal promotion; do not promise permanent occurrence retention across old-app reruns. Avoid the deploy script's legacy full reset, which truncates site-specific validations and resets unrelated settings.

## Measured isolated-copy budget

The completed isolated-copy rehearsal used MySQL 8.0.45 with a 2 GiB buffer pool and 100 MiB redo log. It is evidence for this copied snapshot, not a production-capacity guarantee. Re-measure before applying to a larger snapshot or a different host.

All 20 ordered scopes completed in 627.008 seconds under legacy rules, 576.703 seconds under annual rules, and 757.282 seconds after restoring legacy rules. The rollback comparison matched the legacy baseline for measurement validity IDs and `IsValidated`, unresolved DBH identities and `Prior*`, summary IDs/`IsValidated`/`Errors`, and full-view IDs/`IsValidated`; it did not claim full-row equality or immutable occurrence history.

The largest successful scope was Mpala census 1 during rollback: 363,983 eligible measurements, no prior pairs, and 161.238 seconds. The largest annual scope was Rabi at 103.389 seconds; the largest baseline scope was 102.320 seconds. About 147.84 MB (141 MiB) of durable artifacts were written across that scope’s artifact events; transaction timing includes the before/prepared writes. Peak sampled database state was 2,183,899 modified rows, 1,469,383 locked rows, 9 locked tables, and 1,908,856 lock bytes. Temp and undo byte use were unavailable.

The largest prepared transaction was also killed after both view refreshes. Its first outcome was unknown; an observer confirmed rollback only after 76 checks at 500 ms, then verified exact full-state hashes and a direct retry in 42.323 seconds. This proves the reconciliation path, not a safe shortcut for unknown outcomes.

Use `DBH_RESCORE_TIMEOUT_MS=300000` (five minutes) for this target, after completing pending work separately through normal validation. Reserve a 90-minute maintenance window for drain, deployment, verification, the observed annual-plus-rollback 22.23-minute sweep time, reconciliation, and contingency. Do not release isolation while any scope is deferred or has an unknown outcome.

## Operator commands

Run from `frontend/` in the verified checkout with the configured database environment. Never print passwords. Confirm the printed host, user, fixed IDs, revision, ordered scopes, and advisory preflight. Provide a private writable artifact directory for apply and retain every attempt's files.

Set `AZURE_SQL_SERVER`, `AZURE_SQL_USER`, `AZURE_SQL_PASSWORD`, and `AZURE_SQL_PORT` explicitly in the operator environment. Both verification and the application connection pool use these settings; `TEST_DB_*` does not select the sweep target. Apply also requires `DBH_RESCORE_TIMEOUT_MS`, a positive integer chosen from the completed rehearsal measurements. The CLI refuses apply when that budget is missing. The examples below assume these variables have already been set; do not paste credentials into command history.

Keep the operator machine awake and connected throughout the sweep and reconciliation. On macOS, prefix the command with `caffeinate -i` to prevent idle sleep while the CLI runs. The isolated rehearsal demonstrated that machine sleep can suspend both database work and the operator's timeout timer; exclude such interrupted timings when choosing the transaction budget.

```sh
export DBH_RESCORE_TIMEOUT_MS=300000

npx tsx scripts/rescore-dbh-validations.ts --all-sites

npx tsx scripts/rescore-dbh-validations.ts --all-sites \
  --apply --i-understand-this-writes-to forestgeo-mysqldataserver.mysql.database.azure.com \
  --artifact-dir /absolute/private/path/dbh-annualised-run

npx tsx scripts/rescore-dbh-validations.ts --schema forestgeo_wytham --plot 1

npx tsx scripts/rescore-dbh-validations.ts --schema forestgeo_wytham --plot 1 --census 2 \
  --apply --i-understand-this-writes-to forestgeo-mysqldataserver.mysql.database.azure.com \
  --artifact-dir /absolute/private/path/dbh-census-retry
```

Plot/census IDs above are command-shape examples: substitute IDs from discovery, never assume those IDs identify the intended census. No `--validations`, `--recover-pending`, or full-validation fallback exists. Dry-run checks are advisory until rechecked under apply locks. Argument errors exit 2; any verification failure, deferral, database/artifact failure, or incomplete requested scope exits 1. A clean dry run or fully completed apply exits 0.

A failed/locked/pending scope defers all later requested censuses in that plot. Ordinary failures may allow other plots to continue. Unknown database outcomes, failed artifact storage, or lost writer isolation halt the whole sweep. Reconcile before retrying, then start at the earliest unfinished/uncertain census in each plot and include all later affected censuses. A single-census request changes no later rows and reports follow-on work; its success cannot establish network completion.

## Artifacts and reconciliation

Keep the sweep arguments, source/procedure digests, ordered scopes, timestamps, attempt IDs, provisional run IDs, initial per-row validity, before/after DBH occurrences (`MeasurementID`, `ErrorID`, `CreatedAt`, `IsResolved`, `ResolvedAt`, `Prior*`), interval diagnostics, errors, and earliest unfinished census. Unobserved counts are unavailable, not zero.

| Outcome | Required action |
| --- | --- |
| Not started / deferred | Remove the documented blocker separately, repeat prerequisite verification, and retry in order. |
| Confirmed rolled back | Original durable scope state remains. Preserve the failure artifact and retry DBH directly after verifying prerequisites. No inserted run row should persist. |
| Unknown | Halt. On a fresh connection, verify the completed run row belongs to this attempt. A matching completed row proves commit; an absent row proves rollback only after the original server session and transaction have ended. Do not cancel a possibly live attempt or infer rollback from a network error. |
| Committed | Keep the completed run row and reconcile the required outcome artifact before proceeding. |
| Artifact failed before commit | Roll back and repair storage; verify the database outcome before retry. |
| Artifact failed after commit | Database remains committed. Exit nonzero and stop; repair/reconstruct the outcome artifact using the verified attempt/run record. Never change the completed record to failed or rerun blindly. |

The `before` artifact is captured under locks and durably written before reset. `prepared` means the writes are ready inside the transaction, not that they committed. Only acknowledged commit or successful reconciliation permits a committed outcome. A provisional run ID is not a persisted record.

## Rollback and release

Prepare and test the old-rule manifest/procedure and seed patch **before** rollout. Old growth is absolute >65 mm; old shrinkage is strict `presentDBH < priorDBH * 0.95`. Remove the new floor/HOM/interval eligibility gates in that revision. Keep resolve retirement, the pair/diagnostic interfaces, transaction correctness fixes, and the atomic sweep. Changing threshold numbers alone is not rollback; reverting all feature commits removes required safety fixes.

For a committed census, procedure rollback alone does not restore validity. Under continued isolation, deploy and verify the tested old-rule manifest, then re-score from the earliest affected committed census through every later census. Verify both views, occurrence extracts, artifacts, and old-rule fixtures. Reconcile unknown commits first. Deleted history or erased override intent cannot be reconstructed automatically; compare saved snapshots and limit any restoration to verified unchanged rows. Never overwrite subsequent edits to force historical counts to match.

The reviewed rollback assets are `db/rollback/2026-09-02-dbh-legacy-rules-procedures.sql` and `db/rollback/2026-09-02-dbh-legacy-rules-corequeries.sql`. Install only their two procedures and two seeds using the approved deployment connection. Preserve unrelated configuration. Then select those exact files for verification and the same atomic CLI:

```sh
export DBH_RESCORE_PROCEDURES_SQL="$PWD/db/rollback/2026-09-02-dbh-legacy-rules-procedures.sql"
export DBH_RESCORE_COREQUERIES_SQL="$PWD/db/rollback/2026-09-02-dbh-legacy-rules-corequeries.sql"
npx tsx scripts/rescore-dbh-validations.ts --all-sites
npx tsx scripts/rescore-dbh-validations.ts --all-sites \
  --apply --i-understand-this-writes-to forestgeo-mysqldataserver.mysql.database.azure.com \
  --artifact-dir /absolute/private/path/dbh-legacy-rollback
```

Unset both manifest variables before verifying or applying annual rules again. These variables choose the expected SQL manifest; they do not deploy SQL or change which two validation IDs execute.

Mason releases isolation and the deployment freeze only after every target and affected later census succeeds, artifacts reconcile, discrepancies are explained, and spot checks cover thresholds, HOM, interval skips, Prior* and non-DBH overrides. Record release time and the operator's decision. Then restore the recorded ingress/worker controls and start both apps. Results mail is a separate operator action.
