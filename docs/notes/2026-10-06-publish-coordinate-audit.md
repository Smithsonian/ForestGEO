# #475: site DefaultCoordinateUnits audit, and this branch's charset-only scope

## Audit: `DefaultCoordinateUnits` across catalogued site schemas

An authorized, read-only audit ran against the catalogued site schemas on
2026-10-07T01:57:23.168Z over a verified TLS connection, inside a single
`READ ONLY` transaction using bounded `SELECT`s, ending with a rollback/end
(no writes, no schema changes).

**Result:** 13 catalogued site schemas, 86 plots total, all reporting
`DefaultCoordinateUnits = m`. Of those, 2 are test schemas (5 plots) and 11
are real sites (81 plots). Zero errors and zero missing-column failures
across all 13 schemas.

### What this does and does not verify

This audit confirms only the **configured** source unit setting, read per
plot (`plots.DefaultCoordinateUnits`). It does **not** verify:

- Actual coordinate magnitudes in `quadrats`/`stems` rows match that
  configured unit (e.g., a plot could say `m` while individual rows were
  entered in different units).
- Whether the Smithsonian destination uses metres for `Stem.PX`/`Stem.PY`
  and shares the same coordinate origin as the source plot.
- Any historical backfill or rebuild of previously published data.

No production writes, backfill, or deployment occurred or is authorized by
this audit. It does not certify release or backfill readiness — it is one
input, scoped exactly as described above, nothing more.

Credentials and individual row contents are intentionally omitted from this
note; the counts above are the complete disclosure.

## This branch's implementation scope: charset only

The original #475 local plan/spec covers more than the character-set
mismatch (`cp850` client sessions vs. the UTF-8 artifact file vs. a latin1
destination). **This branch implements the charset fix only** —
`renderArtifact`'s procedure envelope now saves the caller's session
character set, declares `SET NAMES utf8mb4` before `CREATE PROCEDURE`, and
restores the session after a successful run (see
`frontend/lib/ctfs-export/render-procedure.ts`).

The plot-coordinate unit question the audit above speaks to, any historical
backfill, and the ViewFullTable rebuild path are out of scope for this
change and are preserved for the original #475 plan/spec to address
separately. This note does not supersede that plan.
