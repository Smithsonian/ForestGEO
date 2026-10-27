# Post-validation Statistics Queries Repair (S1 #506)

Migration `2026-10-14-01-repair-postvalidation-statistics-queries` fixes three
buggy post-census statistics query definitions (`Number of all trees`, `All dead
or missing stems and count by census`, `All trees outside plot limits`) seeded
into `postvalidationqueries` by `corequeries.sql`.

## Migration behavior

**Guarded repair**: each query's `QueryDefinition` is compared (case-sensitive,
whitespace-normalized) against the known buggy signature.
- Verbatim match → repaired to the fixed text; cached results cleared
- Missing row → inserted with the fixed text
- Any other text (including case-only differences) → **untouched** and counted
  as a site customization

**Idempotent**: subsequent runs repair/insert zero rows.

## Inspecting customizations

The migration runner discards all result sets, so the summary SELECT is not
visible in deployment logs. To inspect retained customizations after deployment:

```sql
SELECT QueryName, QueryDefinition FROM postvalidationqueries
 WHERE QueryName IN ('Number of all trees',
                     'All dead or missing stems and count by census',
                     'All trees outside plot limits');
```

## Deployment paths

| Path | Effect on `postvalidationqueries` |
|------|-----------------------------------|
| `scripts/deploy-validations-to-all-schemas.ts` **without flags** (legacy-full-reset, current default) | Executes `corequeries.sql`, which **TRUNCATEs** the table and **replaces** all rows. Site customizations are lost. |
| `scripts/deploy-validations-to-all-schemas.ts --procedures-only` | Does **not** read `corequeries.sql`. Existing rows, including customizations, are preserved. |
| This guarded migration (applied via schema-migrations ledger) | Repairs only verbatim-buggy rows; inserts only missing rows; preserves customizations. |

To preserve per-site customizations while repairing bugs, apply the migration
through the normal schema-migration ledger, then (if needed) run
`--procedures-only` to update stored procedures without touching
`postvalidationqueries`.

---

*No deployment is authorized by this note; it is documentation only.*
