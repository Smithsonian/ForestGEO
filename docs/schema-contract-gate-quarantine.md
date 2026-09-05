# Quarantined schemas (deploy contract gate)

Operational runbook for `catalog.schema_contract_gate` — what a quarantine means, how a
schema gets released, and what to do when the deploy reports one. See issue #429.

---

## What the gate does

The deploy job `migrate-and-verify-*` (in `.github/workflows/dev-forestgeo-livesite.yml` and
`main-forestgeo-livesite.yml`) runs `apply-schema-migrations.ts --all-sites --apply` against
every `forestgeo_*` schema. Per schema it records an outcome in `catalog.schema_contract_gate`:

- **passed** — migrations applied and the contract audit is clean. `LastPassedAt` set, any
  quarantine cleared.
- **quarantined** — the schema has **never** passed and failed this run. The deploy continues
  for every other schema; the procedure and view sweeps skip this one; site-scoped API
  requests for it return `503 SCHEMA_QUARANTINED`. An issue labeled `schema-quarantine` is
  opened by the workflow.
- **BLOCKED** — the schema passed before and failed now: this deploy regressed it. The job
  fails and nothing ships, exactly as before quarantine existed.

If no schema passes, the job fails regardless (a bad migration must not ship as N quarantines).

The gate table is created by the catalog migration
`db/migrations/catalog/2026-09-02-01-schema-contract-gate.sql`, which the deploy applies in the
step before the site gate. Until that has run on a server, the site gate refuses to start and
names the catalog runner — that is correct fail-loud behavior, not an outage.

## Bootstrap window

On the first deploy after the gate table lands, every existing schema has no pass on record; a
failure on that run quarantines instead of blocking. All live schemas were green on the
previous deploy, so the expected outcome is that every schema is stamped passed. The window
closes after one green run.

## Repair and release

1. Read the reason on the `schema-quarantine` issue or in `catalog.schema_contract_gate`.
2. **Manifest gap** (the audit names an object no migration creates): add the migration to
   `frontend/db/migrations/manifest.ts`, extend
   `frontend/tests/integration/schema-manifest-convergence.integration.test.ts` (bump the
   baseline fixture if the gap came from a shape it predates), merge. The next deploy converges
   the schema and releases it. No manual step.
3. **A migration failed on that schema only**: fix the data condition it named, redeploy.
4. **The site is disposable**: tear it down from the provisioning admin page; the next
   `--all-sites` run prunes its gate row.
5. **Never hand-edit `QuarantinedAt`.** Release is earned by a passing gate run.

## Checking status

Read-only from a workstation (needs `AZURE_SQL_PASSWORD` in `frontend/.env.local`; writes
nothing):

```bash
cd frontend && npx tsx scripts/apply-schema-migrations.ts --all-sites --check
```

Ends in `Check summary: N checked, Q quarantined`, with each quarantined schema printed above
alongside the reason that put it there.

## Where the behavior lives

| Concern | File |
|---|---|
| Gate table DDL | `frontend/db/migrations/catalog/2026-09-02-01-schema-contract-gate.sql` |
| Gate reads/writes for the CLIs | `frontend/scripts/lib/schema-gate.ts` |
| Decision rule and apply loop | `frontend/scripts/apply-schema-migrations.ts` |
| Read-only check | `frontend/scripts/check-schema-contract.ts` |
| Sweeps that skip quarantined schemas | `frontend/scripts/deploy-validations-to-all-schemas.ts`, `deploy-taxonomy-views-to-all-schemas.ts` |
| App-side lookup and 503 responses | `frontend/lib/schema-quarantine.ts` |
| Enforcement chokepoints | `frontend/lib/route-authz.ts`, `frontend/lib/contextvalidation.ts` |
