# Annualised DBH development release preparation

Prepared on 2026-09-09 for `codex/annualised-dbh-validation-cluster` → `forestgeo-app-development`, incorporating merged PR #471 (`056de23b`). The development app uses the shared production database. This is a release preparation record, not authorization to merge, stop services, change production data, or run the sweep.

**Lifecycle update, 2026-09-17:** Mason chose a one-time historical re-score, followed by removal of its dedicated tooling after accepted completion and an agreed rollback window. See the [decision](2026-09-17-dbh-one-time-rescore.md), [lifecycle and completion record](../../frontend/docs/validation-rescore-runbook.md#one-time-migration-lifecycle), and [retirement inventory](../../frontend/docs/validation-rescore-runbook.md#retire-the-dedicated-migration-tool). Ordinary annualised validation and shared safety fixes remain. The observations below remain dated evidence; this update does not mark production readiness or execution complete.

## Release behavior

Validations 1/2 use measurement-date annual growth/shrinkage rules for intervals of at least 365 days; shorter or undated comparisons use the absolute legacy thresholds, and reversed or over-20-year intervals are skipped and counted. The re-score keeps manager-overridden valid rows and holds any census it would turn a valid row invalid in, until the operator reviews the listed IDs and reruns with `--allow-valid-to-invalid`. Reruns retain and resolve DBH occurrences. The operator re-scores exactly both enabled rules, one atomic transaction per census, in dependency order; both views and the completed run marker commit together. The tested legacy rollback assets preserve the atomic service and resolution behavior.

Both deployment workflows now deploy procedures without replaying the legacy `corequeries.sql` reset; migration `2026-09-13-01-annual-dbh-rule-text` updates only DBH `Description` and `Definition` to the canonical SQL. Existing enabled and disabled flags, metadata, and unrelated validation rows are preserved. The migration accepts disabled DBH rules and stops on a conflicting DBH identity; the later re-score sweep still requires both rules enabled. Procedure deployment reports and skips quarantined or unmigrated sites. The seed refresher is now an operator-only rollback tool. Schema/procedure DDL and the overall release remain non-atomic. A failed deployment must be reconciled under continued isolation.

Merging to development triggers deployment automatically: `development_temp` has no approval protection, and administrators can bypass branch checks. Required branch status contexts observed on 2026-09-09 are `unit`, `integration`, `e2e-tests`, and `realdb-smoke`. Require these plus the PR Gate `gates` and `component` jobs to pass; do not bypass them for this release. The CLI sweep remains a separate operator action and is not run by the deployment workflow.

## Read-only production readiness, 2026-09-09

The audit covered the approved 12 site schemas and 20 active censuses. It used a read-only transaction and made no production writes.

| Check                         | Observed result                                                          |
| ----------------------------- | ------------------------------------------------------------------------ |
| DBH validations 1/2           | Correct identities, both enabled in all 12 schemas                       |
| Schema contract gate          | All 12 previously passed; none quarantined                               |
| Active validation runs        | 0                                                                        |
| Active upload sessions        | 0                                                                        |
| Active catalog upload jobs    | 0 queued/running/cancel-requested/waiting-retry                          |
| Running provisioning jobs     | 0                                                                        |
| Eligible pending measurements | **156,492 in Mpala; 3 in testing_mason**                                 |
| All site migration manifests  | No pending, failed, or checksum-mismatched entries across all 12 ledgers |
| Catalog migration manifest    | No pending, failed, or checksum-mismatched entries                       |

The last recorded development Actions failure (2026-09-02, run 33678589318) was a validation-19 checksum mismatch. Current source and all 12 production ledgers now match, so that specific blocker has been resolved. The recorded contract passes and zero counts are observations at audit time, not a fresh migration execution or proof that future submissions are prevented.

## Writer inventory and maintenance controls

| Resource                                 | Resource group             | Observed state / relevance                                                                            |
| ---------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `forestgeo-development`                  | `forestgeo-rg`             | Running, unrestricted ingress; async upload admission enabled; in-process upload/provisioning workers |
| `forestgeo-livesite`                     | `forestgeo-rg`             | Running, unrestricted ingress; old app versions and in-process workers must be accounted for          |
| `submitingestionprocessor`               | `submitingestionprocessor` | Running; enabled HTTP ingestion function; same production database hostname                           |
| `polluserinformation`                    | `forestgeo-rg`             | Running; account lookup function, review any additional write behavior with its owner                 |
| `forestgeo-testing-app`                  | `forestgeo-testing-rg`     | Running against the separate testing database; outside the confirmed shared-database target           |
| Direct SQL users, scripts, other clients | Operator inventory         | **Not yet attested stopped or excluded**                                                              |

The resource group is `forestgeo-rg`, not the formerly documented `ForestGEO-ResourceGroup`. The runbook and workflow restart references have been corrected. App ingress restrictions are not currently in place. The Node startup path starts job recovery/sweeping; an admission feature flag alone does not stop existing-work consumers. Deploy/restart can resume workers, so recheck them after deployment and before the sweep.

## Operator sequence and remaining blockers

- [ ] **Reverify main's deploy hold at release:** promotion #478 (`b790f684`, 2026-09-14) removed main's legacy validation-deploy step; the original instruction to merge that hold is superseded. Confirm the current main workflow and relevant deployment run still cannot replay the old seeds/procedures onto the shared database. The later dev → main promotion must retain this PR's procedures-only deployment plus the DBH rule-text migration, not restore the legacy seed reset or add the operator rollback refresher to deployment.
- [ ] Record the owner, exact source/runtime and evidence archive, intended scope ledger, and rollback-window start/end. Disposition the non-atomic override and recovery-marker notice findings described in the runbook before apply; these documentation changes do not fix them.
- [ ] Re-run the isolated production-copy rehearsal at the final PR head. The recorded rehearsal, timings and rollback projections predate the minimum-interval rule, the override marker and the valid-to-invalid hold, so they are not evidence for the current rules.
- [ ] Name the maintenance owner (Mason or a recorded delegate), reserve the window, and attest the complete writer inventory.
- [ ] Complete the 156,495 pending measurements separately through normal validation under the current rules. Capture before/after validity and non-DBH override effects. Do not reset pending rows to bypass preflight. The isolated Mpala preparation needed a separately reviewed cross-census-location query-plan adjustment; its diagnostic SQL/performance evidence is retained privately and is not included as an unreviewed application change in this release.
- [ ] Repeat the read-only readiness checks against the current target, including scope ordering, active work, enabled rules, and migration ledger/contract verification.
- [ ] Establish ingress restrictions, drain in-flight work, stop the two shared-database apps and ingestion function, and confirm direct writers are excluded. Preserve the prior controls for restoration. Freeze other deployments.
- [ ] Capture a fresh recoverable snapshot/configuration record under those controls before merge/deployment. The September 6 rehearsal snapshot is historical evidence, not the rollback snapshot for new intervening production writes.
- [ ] Confirm the final PR head and all required checks; merge only within the approved maintenance window. Observe schema migration, contract verification, the DBH rule-text migration, procedures-only deployment, and application deployment.
- [ ] Perform authenticated application smoke checks under controlled access. Re-establish and verify writer isolation after any deployment restart.
- [ ] Verify the exact annual manifest, run the read-only DBH sweep, then explicitly apply the ordered sweep with `DBH_RESCORE_TIMEOUT_MS=300000` and a private artifact directory.
- [ ] Reconcile every outcome, both views, counts, prior snapshots, and later dependent scopes. If rollback is needed, restore the reviewed legacy two-procedure manifest, refresh only its two seed fields, and re-score in order under continued isolation. Do not revert the transaction safety fixes or force historical counts.
- [ ] Release restrictions only after all requested and affected scopes succeed and the operator records sign-off. Restore only resources that were running before maintenance. Results messages remain a separate operator action.
- [ ] After acceptance and the recorded rollback window, obtain retirement sign-off and remove only dedicated migration tooling using the runbook inventory. Preserve runtime validation, applied migrations, evidence, and a recoverable tool revision; update memory only after removal is integrated.

## Evidence and operating budget

The original isolated production-copy rehearsal completed all 20 scopes under legacy baseline, annual rules, and legacy rollback. All recorded rollback validation projections matched baseline. Killing the largest prepared transaction proved full-state rollback and a successful direct retry; commit acknowledgement and artifact failure reconciliation have regression coverage.

Measured full phases: baseline 627.008 seconds, annual 576.703 seconds, rollback 757.282 seconds. Largest successful transaction: 161.238 seconds for 363,983 eligible measurements. Use an explicit five-minute transaction timeout and reserve 90 minutes for the release window **after** separate pending-work preparation. Re-measure if the target changes materially; never split the census transaction or release isolation with unknown outcomes.

Canonical operator commands, retained limitations, and rollback steps are in [the runbook](../../frontend/docs/validation-rescore-runbook.md). The detailed rehearsal and current read-only reports are retained in the private local store; raw production data and credentials are excluded from this repository. Local release checks passed on the prepared source: 4,127 unit tests (4 skipped), 1,151 MySQL integration tests (3 skipped), production build including formatting/lint, and the 25-page documentation build. The typing ratchet is 487 against a 489 baseline; dependency cycles are 33 against a 33 baseline. Workflow parsing/order checks and the PR #471 local-document guard passed, and the code graph was refreshed. Browser/component checks remain required on the final PR; these local results do not replace them. The exact legacy two-procedure file was also imported with the MySQL client into a disposable local schema; both normalized procedure definitions matched the rollback manifest. The fixture was removed. The final Git revision and file checksums are recorded in the private release handoff.
