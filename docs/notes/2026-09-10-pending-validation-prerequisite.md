# Pending-validation prerequisite for annualised DBH release

This change fixes two existing normal-validation behaviors before the ordered DBH re-scoring in PR #473.

The shared cross-census location lookup now starts from the distinct keys of the measurements being checked, then looks up prior trees and stems. Explicit join order prevents a census-wide prior-tree scan from repeatedly searching the temporary key table. Matching predicates, the optional prior quadrat, and the “any matching prior row” behavior are unchanged.

Normal validation finalization now updates only active, stem-linked pending measurements. A pending row without a linked stem remains pending, including when it has only resolved ingestion errors. Inactive rows and rows outside the requested census/plot also retain their state. Eligible measurements still pass or fail according to unresolved validation errors.

## Verification

Direct MySQL tests call the shared procedure and the real normal-finalization helper. They cover predecessor absence, new recruits, species forks, duplicate-error prevention, the ten-metre boundary, missing coordinates, inactive prior quadrats, empty stem tags, and finalizer eligibility. A source-contract assertion protects the explicit lookup order. Private isolated-copy performance and result-equivalence evidence supplements these fixtures.

## Release sequence

Review and deploy this prerequisite under the established maintenance controls before running normal validation on pending scopes. Deployment and validation execution are separate operations; this change does not enqueue validation jobs or update measurement data during migration.

After normal validation completes, verify that eligible pending rows are zero and that excluded rows retained their state. Incorporate this prerequisite into PR #473 and rerun its checks before the annualised release. PR #473 extracts the finalizer into `finalizeValidatedRowsInTransaction`: preserve the normal caller's active/stem guard when resolving that integration, using `requireActiveStemGUID: true`.

A development merge triggers the existing shared-database deployment workflow. That workflow and its seed-refresh behavior are unchanged here. A merge still requires the agreed maintenance window, writer controls, and recovery preparation; successful CI alone does not authorize deployment.
