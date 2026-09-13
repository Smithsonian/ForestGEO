# Annualised DBH re-score operator runbook

This procedure re-scores only validations 1 and 2, in census-number order. Each census is one transaction: reset, retirement, DBH checks, finalization, both materialized views, and the completed run record commit together. The database and artifact filesystem do not commit atomically; their outcomes must be reconciled separately.

Implementation and isolated-copy rehearsal do **not** authorize production deployment, a production sweep, or sending results. Mason owns the maintenance window and its release, or records a named delegate before starting. Push/PR and production operations require their separate handoff authorization.

## Rules and retained state

Growth flags above 65 mm/year; shrinkage flags at an annual relative change of −0.05 or below. Years are measurement-date days / 365.25, applied only to intervals of at least 365 days. Intervals under 365 days (including same-day) and missing dates use the absolute legacy thresholds: growth above 65 mm, or `presentDBH < priorDBH * 0.95`. Both DBHs must be at least 10 mm (1 cm). Unequal non-NULL HOM suppresses a comparison; either HOM may be NULL. Reversed intervals (`SkippedNegativeInterval`) and intervals over 7,305 days / 20 years (`SkippedImplausibleInterval`) skip; `SkippedNoInterval` is their total. Diagnostics report each pair's `ComparisonBasis` (`annualised`, `absolute`, or NULL when skipped). The immediately preceding census **number** supplies valid prior measurements; a gap is not filled using the nearest older census.

Only DBH occurrences are resolved on rerun. An unchanged violation reopens the same occurrence, clears its resolution time, and updates its Prior* snapshot. Stale findings remain resolved, retaining their creation time and last comparison. These mutable rows are not an immutable history. Unresolved non-DBH errors still affect final validity.

**Manager overrides.** The validation override modal resolves a row's validation occurrences instead of deleting them and records a resolved `MANAGER_OVERRIDE` occurrence on each overridden row. The re-score does not reset a valid row carrying that marker and reports them as `preservedOverrideCount`. Normal finalization deletes the marker from any row being re-validated (for example after "reset validation states"), so an override lasts only until the row is judged on its data again. Overrides made before this change left no marker and cannot be told apart from rows that passed on their own; they are caught by the valid-to-invalid hold below.

**Valid-to-invalid hold.** When re-scoring a census would turn any previously valid row invalid, the attempt rolls back with outcome `held-valid-to-invalid`, lists the measurement IDs as `validToInvalidMeasurementIDs` in its outcome artifact, and defers later censuses in that plot. Review those rows (a pre-marker override is the case to look for), then rerun the census with `--allow-valid-to-invalid`. Allowed runs still record the IDs and `validToInvalidCount` in the `prepared` artifact.

## Establish and retain writer isolation

The repository deploys Azure App Services `forestgeo-development` and `forestgeo-livesite` in `forestgeo-rg` (see `.github/workflows/dev-forestgeo-livesite.yml` and `main-forestgeo-livesite.yml`). Azure inventory verified both apps in this resource group on 2026-09-09. Stopping these services is an available control for their ingress and in-process workers. A web page banner or the CLI host acknowledgement does not prevent writes.

Before deployment, Mason must inventory and stop or deny access to **every** additional writer: separately hosted workers, scheduler jobs, researcher SQL sessions, scripts, and other app versions. Confirm the deployed worker topology with the responsible operator. The repository alone cannot establish that this inventory is complete. **Do not apply while any writer or its isolation mechanism is unaccounted for.** Scope locks exclude cooperating callers, but raw-query mutations and older live code do not all honor them. Online re-scoring requires #465 or equivalent authoritative protection across all writers.

1. Freeze unrelated deployments and new submissions. Record the approved window, operator, target revisions, and writer inventory in the artifact directory.
2. Prevent new submissions to both apps using Azure ingress access restrictions approved for this environment; drain in-flight uploads/validations and database transactions. Do not stop a running validation and then treat its old run record as completed.
3. Stop both apps after draining. Where ingress restrictions cannot be established, stopping both apps prevents new app work, but any interrupted work must be explicitly reconciled and completed under controlled access before the sweep.

```sh
az webapp stop --resource-group forestgeo-rg --name forestgeo-development
az webapp stop --resource-group forestgeo-rg --name forestgeo-livesite
az webapp show --resource-group forestgeo-rg --name forestgeo-development --query state --output tsv
az webapp show --resource-group forestgeo-rg --name forestgeo-livesite --query state --output tsv
```

4. Verify separately hosted workers and direct writers are stopped/restricted too. Retain restrictions through deployment, verification, sweep, comparisons, reconciliation, and any rollback.
5. Include the separately hosted `submitingestionprocessor` function app in resource group `submitingestionprocessor`: the verified enabled `ingestionprocessor` function has an HTTP trigger. Drain it and stop it under the same maintenance authorization; record its prior state for restoration. `forestgeo-testing-app` was verified to target the separate `forestgeo-testing-mysql.mysql.database.azure.com` database, so it is outside this target’s confirmed writer set. Confirm direct SQL users and other scripts before signing off the inventory.

```sh
az functionapp stop --resource-group submitingestionprocessor --name submitingestionprocessor
az functionapp show --resource-group submitingestionprocessor --name submitingestionprocessor --query state --output tsv
```

6. Deployment workflows restart apps. If deployment reopens ingress or restarts workers, immediately re-establish isolation and drain checks before continuing. Do not assume the pre-deploy stop persists.

The current Node startup instrumentation starts the provisioning recovery worker and upload-job sweeper; disabling async upload admission alone does not stop these existing-work consumers. Both apps had unrestricted ingress in the 2026-09-09 inventory, so no maintenance restriction is currently established by this document. A count of zero at one instant is evidence of a drained queue, not prevention of future work. The writer controls remain in force until explicit release.

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

Deploy the reviewed development revision and DBH procedure/seed changes while preserving unrelated enabled configuration. The shared database gets the procedure change without a main promotion. The old live app retains its DELETE retirement until normal promotion; do not promise permanent occurrence retention across old-app reruns. The corrected development and main workflows run `deploy:procedures` followed by `refresh:dbh-rules`. The second step reads the two DBH seeds from the canonical SQL and updates only their `Description` and `Definition`, preserving `IsEnabled`, `Criteria`, `ChangelogDefinition`, and all unrelated rows. It rejects missing or conflicting DBH identities, preserves enabled and disabled flags, and verifies the expected procedure/seed revision before each schema’s seed transaction commits. Enabling both DBH rules is a separate requirement of the re-score sweep, not of routine deployment. An explicitly selected quarantined schema is rejected; all-site deployment reports and excludes quarantined schemas and schemas missing the measurement-error migration tables, consistently with the existing procedure deployment. Explicitly selecting an unmigrated schema fails. Missing migration-status results also fail. The later DBH sweep still requires every intended target to pass its own revision checks; deployment success with a quarantine is not network re-score completion. All selected schemas pass preflight before the first seed write. The legacy no-flag deploy command still exists for its old use cases; do not use it for this rollout because it truncates site-specific validations.

The seed refresh is repeatable after a partial deployment, but stored-procedure DDL is not transactional and a multi-schema release is not one atomic transaction. A failure must block app deployment. Keep writers isolated, inspect the failed scope, and rerun the reviewed procedure/seed deployment; never treat an app restart or a failed Actions job as a database rollback. The workflow does not re-score existing measurement rows.

Once reviewed procedures have been installed, the targeted seed commands are:

```sh
npm run refresh:dbh-rules -- --all-sites
npm run refresh:dbh-rules -- --all-sites --apply \
  --i-understand-this-writes-to "$AZURE_SQL_SERVER"
```

The `development_temp` GitHub environment had no approval protection on 2026-09-09. A development merge can therefore immediately reach shared-database DDL. Establish the maintenance window **before merging**, and require the PR's `unit`, `integration`, `e2e-tests`, and `realdb-smoke` checks plus the `gates` and `component` jobs to be green. Do not use an administrator bypass for this release. After deployment, perform an authenticated smoke check of census selection, measurements, validation configuration, and DBH diagnostics under controlled access, then re-establish the recorded writer controls before the ordered sweep.

Normal DBH execution materializes pending comparisons only. A diagnostic for a specific measurement still examines pending, failed, and validated rows using the same comparison predicates. Temporary-table diagnostic reads and cleanup explicitly name the target schema.

`SkippedBelowDbhFloor` reports non-exempt, pending comparisons where either diameter is missing or below 10 mm after conversion (the two conditions both fail the floor eligibility check). The API parser exposes `skippedBelowDbhFloor`; re-score artifacts and run counts retain it, and normal single/combined validation logs an operator warning after commit when it is nonzero. This count is separate from the interval skip counts and does not prove the configured units are wrong. Review the plot's units and raw values when an exclusion count is unexpected; do not change units or waive the floor based on a count alone. The two operator CLIs verify remote TLS certificate chains and server identities.

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

# Only after reviewing a held census's validToInvalidMeasurementIDs:
npx tsx scripts/rescore-dbh-validations.ts --schema forestgeo_wytham --plot 1 --census 2 \
  --apply --i-understand-this-writes-to forestgeo-mysqldataserver.mysql.database.azure.com \
  --artifact-dir /absolute/private/path/dbh-census-reviewed --allow-valid-to-invalid
```

Plot/census IDs above are command-shape examples: substitute IDs from discovery, never assume those IDs identify the intended census. No `--validations`, `--recover-pending`, or full-validation fallback exists. Dry-run checks are advisory until rechecked under apply locks. Argument errors exit 2; any verification failure, deferral, database/artifact failure, or incomplete requested scope exits 1. A clean dry run or fully completed apply exits 0.

A failed/locked/pending scope defers all later requested censuses in that plot. Ordinary failures may allow other plots to continue. Unknown database outcomes, failed artifact storage, or lost writer isolation halt the whole sweep. Reconcile before retrying, then start at the earliest unfinished/uncertain census in each plot and include all later affected censuses. A single-census request changes no later rows and reports follow-on work; its success cannot establish network completion.

## Artifacts and reconciliation

Keep the sweep arguments, source/procedure digests, ordered scopes, timestamps, attempt IDs, provisional run IDs, initial per-row validity, before/after DBH occurrences (`MeasurementID`, `ErrorID`, `CreatedAt`, `IsResolved`, `ResolvedAt`, `Prior*`), interval diagnostics, errors, and earliest unfinished census. Unobserved counts are unavailable, not zero.

| Outcome | Required action |
| --- | --- |
| Not started / deferred | Remove the documented blocker separately, repeat prerequisite verification, and retry in order. |
| Held valid-to-invalid | Confirmed rollback. Review the listed measurement IDs, then rerun that census and all later censuses in its plot with `--allow-valid-to-invalid`. |
| Confirmed rolled back | Original durable scope state remains. Preserve the failure artifact and retry DBH directly after verifying prerequisites. No inserted run row should persist. |
| Unknown | Halt. On a fresh connection, verify the completed run row belongs to this attempt. A matching completed row proves commit; an absent row proves rollback only after the original server session and transaction have ended. Do not cancel a possibly live attempt or infer rollback from a network error. |
| Committed | Keep the completed run row and reconcile the required outcome artifact before proceeding. |
| Artifact failed before commit | Roll back and repair storage; verify the database outcome before retry. |
| Artifact failed after commit | Database remains committed. Exit nonzero and stop; repair/reconstruct the outcome artifact using the verified attempt/run record. Never change the completed record to failed or rerun blindly. |

The `before` artifact is captured under locks and durably written before reset. `prepared` means the writes are ready inside the transaction, not that they committed. Only acknowledged commit or successful reconciliation permits a committed outcome. A provisional run ID is not a persisted record.

## Rollback and release

Prepare and test the old-rule manifest/procedure and seed patch **before** rollout. Old growth is absolute >65 mm; old shrinkage is strict `presentDBH < priorDBH * 0.95`. Remove the new floor/HOM/interval eligibility gates in that revision. Keep resolve retirement, the pair/diagnostic interfaces, transaction correctness fixes, and the atomic sweep. Changing threshold numbers alone is not rollback; reverting all feature commits removes required safety fixes.

For a committed census, procedure rollback alone does not restore validity. Under continued isolation, deploy and verify the tested old-rule manifest, then re-score from the earliest affected committed census through every later census. Verify both views, occurrence extracts, artifacts, and old-rule fixtures. Reconcile unknown commits first. Deleted history or erased override intent cannot be reconstructed automatically; compare saved snapshots and limit any restoration to verified unchanged rows. Never overwrite subsequent edits to force historical counts to match.

The reviewed rollback assets are `db/rollback/2026-09-02-dbh-legacy-rules-procedures.sql` and `db/rollback/2026-09-02-dbh-legacy-rules-corequeries.sql`. Keep every writer isolated and reconcile unknown outcomes before using this exact 12-schema rollback sequence. It installs only the two legacy procedures and refreshes only the two seed text fields; it does not re-score measurements. The MySQL client import was verified against a disposable local schema, and both normalized procedure definitions matched the rollback manifest.

Configure a MySQL login path once on the operator machine. `mysql_config_editor` prompts for the password and writes its local login file; never put the password on a command line or in this document.

```sh
mysql_config_editor set --login-path=forestgeo-dbh-rollback \
  --host=forestgeo-mysqldataserver.mysql.database.azure.com \
  --user=azureroot --password
```

From `frontend/` in the reviewed checkout, start **Bash** first. This is intentional: the block uses Bash arrays and `read -s -p`; do not paste it into an interactive zsh session line by line. It remains compatible with macOS’s Bash 3.2. The client invocation deliberately repeats host, user, port, and database even though the login path has defaults. TLS verifies both the certificate chain and server hostname; use the approved CA trust configuration if the local client does not already trust the server certificate. Do **not** add `--force`: the MySQL client returns nonzero on SQL errors, and Bash stops on that failure.

```sh
/bin/bash --noprofile --norc
```

Then run this single fail-fast block inside that Bash shell:

```bash
set -euo pipefail

MYSQL=/opt/homebrew/opt/mysql-client/bin/mysql
ROLLBACK_PROCEDURES="$PWD/db/rollback/2026-09-02-dbh-legacy-rules-procedures.sql"
ROLLBACK_SEEDS="$PWD/db/rollback/2026-09-02-dbh-legacy-rules-corequeries.sql"
ROLLBACK_SCHEMAS=(
  forestgeo_cooksbranch forestgeo_harvard forestgeo_ldw forestgeo_mpala
  forestgeo_ngel_nyaki forestgeo_niobrara forestgeo_panama forestgeo_rabi
  forestgeo_serc forestgeo_testing forestgeo_testing_mason forestgeo_wytham
)
test -r "$ROLLBACK_PROCEDURES"
test -r "$ROLLBACK_SEEDS"

# Fail closed if discovery is not exactly the audited 12-schema target. Query
# every `forestgeo_` prefix, even an otherwise malformed name, so no new or
# unaccounted target can be omitted. Command substitutions preserve mysql's
# failure status under `set -e`; they are not process substitutions.
discovered=$("$MYSQL" --login-path=forestgeo-dbh-rollback \
  --host=forestgeo-mysqldataserver.mysql.database.azure.com \
  --user=azureroot --port=3306 --ssl-mode=VERIFY_IDENTITY --batch --skip-column-names \
  --execute "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE LEFT(SCHEMA_NAME, 10) = 'forestgeo_' ORDER BY SCHEMA_NAME")
expected=$(printf '%s\n' "${ROLLBACK_SCHEMAS[@]}" | LC_ALL=C sort)
[[ "$discovered" == "$expected" ]] || { printf 'Refusing unexpected schema scope: %s\n' "$discovered" >&2; exit 1; }

# Quarantine is a deployment exception, never permission to include a site in
# this explicit rollback scope.
quarantined=$("$MYSQL" --login-path=forestgeo-dbh-rollback \
  --host=forestgeo-mysqldataserver.mysql.database.azure.com \
  --user=azureroot --port=3306 --ssl-mode=VERIFY_IDENTITY --batch --skip-column-names \
  --execute "SELECT SchemaName FROM catalog.schema_contract_gate WHERE QuarantinedAt IS NOT NULL AND SchemaName IN ('forestgeo_cooksbranch','forestgeo_harvard','forestgeo_ldw','forestgeo_mpala','forestgeo_ngel_nyaki','forestgeo_niobrara','forestgeo_panama','forestgeo_rabi','forestgeo_serc','forestgeo_testing','forestgeo_testing_mason','forestgeo_wytham')")
[[ -z "$quarantined" ]] || { printf 'Refusing quarantined rollback target(s): %s\n' "$quarantined" >&2; exit 1; }

# mysql handles DELIMITER directives in this reviewed two-procedure file.
for schema in "${ROLLBACK_SCHEMAS[@]}"; do
  "$MYSQL" --login-path=forestgeo-dbh-rollback \
    --host=forestgeo-mysqldataserver.mysql.database.azure.com \
    --user=azureroot --port=3306 --ssl-mode=VERIFY_IDENTITY \
    --database="$schema" < "$ROLLBACK_PROCEDURES"
done

# mysql2 does not consume mysql_config_editor login paths. Read the same secret
# into this process only; it is never echoed or written to disk.
export AZURE_SQL_SERVER=forestgeo-mysqldataserver.mysql.database.azure.com
export AZURE_SQL_USER=azureroot
export AZURE_SQL_PORT=3306
read -r -s -p 'Azure MySQL password: ' AZURE_SQL_PASSWORD; echo
export AZURE_SQL_PASSWORD

export DBH_RESCORE_PROCEDURES_SQL="$ROLLBACK_PROCEDURES"
export DBH_RESCORE_COREQUERIES_SQL="$ROLLBACK_SEEDS"

# Verify every exact schema with no writes. This uses the existing normalized
# manifest verifier for legacy procedure bodies while allowing current seed text.
for schema in "${ROLLBACK_SCHEMAS[@]}"; do
  npm run refresh:dbh-rules -- --schema "$schema"
done

# Apply only the two seed text fields. The helper verifies each full legacy
# manifest before its seed transaction commits.
for schema in "${ROLLBACK_SCHEMAS[@]}"; do
  npm run refresh:dbh-rules -- --schema "$schema" --apply \
    --i-understand-this-writes-to "$AZURE_SQL_SERVER"
done

# Do not re-score until every schema verifies the final legacy manifest and the
# DBH sweep’s own read-only preflight succeeds.
for schema in "${ROLLBACK_SCHEMAS[@]}"; do
  npm run refresh:dbh-rules -- --schema "$schema"
  npx tsx scripts/rescore-dbh-validations.ts --schema "$schema"
done
```

DDL is not transactional. If a client invocation fails, leave writer isolation in place, inspect `SHOW CREATE PROCEDURE` for that schema, correct the specific client/SQL failure, and rerun the same reviewed file for the failed schema and every subsequently unverified schema. Do not infer rollback from an Actions failure or restart an app as recovery. If a seed apply fails, retain isolation and rerun the dry verification for all 12 schemas. Seed updates are individually transactional and repeatable; procedures are not.

Only then use the separately approved ordered re-score apply command from the runbook, starting at the earliest affected committed census in every plot and continuing through later dependent censuses.

After the block succeeds, use the same Bash shell and manifest environment for the approved ordered rollback sweep. Set a new private artifact directory for this attempt:

```sh
export DBH_RESCORE_TIMEOUT_MS=300000
npx tsx scripts/rescore-dbh-validations.ts --all-sites \
  --apply --i-understand-this-writes-to forestgeo-mysqldataserver.mysql.database.azure.com \
  --artifact-dir /absolute/private/path/dbh-legacy-rollback
```

Unset both manifest variables before verifying or applying annual rules again. These variables choose the expected SQL manifest; they do not deploy SQL or change which two validation IDs execute.

Mason releases isolation and the deployment freeze only after every target and affected later census succeeds, artifacts reconcile, discrepancies are explained, and spot checks cover thresholds, HOM, interval skips, Prior* and non-DBH overrides. Record release time and the operator's decision. Then restore the recorded ingress/worker controls and start both apps. Results mail is a separate operator action.
