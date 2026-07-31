---
title: Failed Measurements Guide
description: Learn what failed measurements are, where they live, and how to fix and reingest them.
---

This guide explains what failed measurements are, where they live in the database, and the workflows for fixing and reingesting them.

---

## What are Failed Measurements?

Failed measurements are rows that came in through an upload but didn't pass validation. They are **not lost** and they are **not silently dropped** — they live in the same `coremeasurements` table as your successful rows, but with `StemGUID = NULL` so the app can tell them apart. Each failed row preserves the **original codes from your CSV** (the `RawCodes` column) so you can see exactly what you tried to upload.

:::note
**Architecture change (Feb 2026):** The old `failedmeasurements` and `cmverrors` tables were consolidated into the main `coremeasurements` table with a unified error log. A failed row keeps the **same row ID** through corrections — useful for audit trails. If you've worked with ForestGEO before this change, the workflow is similar but the data lives in one place now.
:::

---

## Where to see them

| Surface | What you see |
|---|---|
| **Census Hub → View Errors** | The main place to work. Every row with a validation error, with its consolidated reason and the original CSV codes. |
| **Census Hub → View Data** | Failed rows appear inline alongside successful ones, visually flagged. Use the status filter to show only failures. |

---

## Understanding failure reasons

Each failed row carries a **consolidated failure reason** built from one or more validations that didn't pass. Failures fall into two broad categories:

### Hard failures — the row can't be ingested as-is

| Reason | Field | How to fix |
|---|---|---|
| **Missing required field: TreeTag** | Tree Tag | Give every row a tree tag |
| **Missing required field: StemTag** | Stem Tag | Give every row a stem tag — most sites use `0` for a single-stemmed tree |
| **Missing required field: SpeciesCode** | Species Code | Supply a species code |
| **Missing required field: QuadratName** | Quadrat | Supply a quadrat name |
| **Missing required field: MeasurementDate** | Date | Provide a valid date (`YYYY-MM-DD`) |
| **Invalid species code: "X" not found in database** | Species Code | Add the species under **Stem & Plot Details → Species List**, then re-submit the row |
| **Invalid quadrat name: "X" not found in database** | Quadrat | Add the quadrat under **Stem & Plot Details → Quadrats**, then re-submit the row |
| **Invalid LocalX / Invalid LocalY** | Coordinates | A negative coordinate is rejected outright — correct it to a position inside the quadrat |
| **Missing measurement data: DBH and HOM both 0 with no codes** | DBH, HOM, Codes | A row must carry a measurement or at least one attribute code — supply one |

Cross-census position problems are hard failures too, not warnings: a quadrat that disagrees with
the previous census, or coordinates that have drifted beyond the allowed threshold, will stop a
row resolving. So will duplicate tag pairs within your file. See
[Upload Errors](/ForestGEO/errors/upload-errors/) for the full list of codes.

:::note
**`INTERRUPTED_UPLOAD` is not a data problem.** If you see it, the upload timed out or the
session was cancelled before that row was processed — the row was never judged and rejected.
Do not edit the data. Re-run the upload instead.
:::

### Soft warnings — the row is kept, but flagged

| Reason | What it means |
|---|---|
| **Invalid Codes** | One or more attribute codes weren't recognised. **As of April 2026 these are soft warnings, not hard rejections** — the row still goes into the database but the unknown codes are surfaced so you can either add them to the Attributes list or correct the value. |
| Cross-census growth / shrinkage findings | DBH or HOM changes that look implausible against the previous census. Reviewed and accepted or corrected case-by-case. |

See **[Validation Errors](/ForestGEO/errors/validation-errors/)** for the full validation reference.

---

## How to fix failed measurements

You have **three** workflows, each suited to a different scale of correction.

### Method 1 — Add the missing reference data, then re-upload

Best when many rows fail because the **app doesn't know about something yet** (a species, a quadrat, an attribute code).

1. Read the consolidated failure reasons under **Census Hub → View Errors**.
2. Add the missing references:
   - Missing species → **Stem & Plot Details → Species List**
   - Missing quadrats → **Stem & Plot Details → Quadrats**
   - Missing codes → **Stem & Plot Details → Stem Codes**
3. Re-upload the affected rows as a **Revisions** upload. They are pushed back through `bulkingestionprocess`; those that now pass move into the normal census stream, and any that still fail reappear under View Errors with updated reasons.

### Method 2 — Edit rows in place

Best for typos and one-off corrections in a handful of rows.

The grid uses the **unified row-editing pipeline** (rolled out in April–May 2026). Every edit — whether you started from View Data or View Errors — goes through the same flow:

1. Open the grid and click a row's edit action.
2. Make your changes.
3. For edits that carry a warning or are destructive, the app shows an **Impact Summary** dialog before writing: which fields will change, how many other rows are affected, and any validation warnings the change would raise. Routine edits apply directly without a dialog.
4. For **destructive** single-row edits you'll be asked to type `APPLY` as a guard against accidental clicks. The bulk revision screen asks for `APPLY` followed by the row count instead, e.g. `APPLY 42`.
5. Immediately after Apply, an **Undo** toast appears for about 12 seconds. That is the only one-click way back — once it disappears, correct the row with another edit.

Failed-row edits run validation immediately on Apply, so a row that now passes will move out of the failed state in the same transaction.

### Method 3 — Revision Upload (CSV)

Best when you have **many rows to fix** and prefer to work in a spreadsheet.

Export the data, fix the offending values, and submit as a **Revisions** upload. This is a separate upload mode from the original ingest — the app matches your file against existing rows and updates only the columns you changed.

- **Editable through Revisions:** DBH, HOM, Measurement Date, Codes (`RawCodes`), Comments.
- **Also editable, but identity-bearing:** Tree Tag, Stem Tag, Quadrat, and the Coordinates. Changing these re-points the measurement at a different tree or place, so check them carefully.
- **Restricted by role:** Species Code can only be changed by **global** and **database administrator** accounts. If your account lacks that role, the review screen blocks the upload and names the row and field rather than applying part of it.

See **[Upload Process Breakdown](/ForestGEO/upload-process-breakdown/)** for the full Revision Upload walkthrough.

---

## Reingestion explained

When corrected rows are pushed back through ingestion:

1. The rows are written back to the staging table.
2. `bulkingestionprocess` runs end-to-end on them.
3. Rows that now pass move into the active census stream.
4. Rows that still fail come back with **updated** consolidated reasons — the original reason may already be resolved and a new one surfaced.

:::caution
Each row keeps its **same row ID** through reingestion. This means audit history (who created it, when, in which upload batch) is preserved across multiple correction passes.
:::

---

## Common scenarios

### Many rows show "SpCode invalid"

The species code in your CSV isn't in the Species List for this site. Add the missing species under **Stem & Plot Details → Species List**, then re-submit those rows as a Revisions upload.

### Quadrat names don't line up

Either the quadrats aren't defined for the plot yet, or the names in your CSV use a different format (leading zeros, separators). Compare your file against **Stem & Plot Details → Quadrats**. You can either add the missing quadrats or correct the names — either through inline edits or a Revision Upload.

### Same failures keep coming back after reingest

The underlying reference data wasn't actually fixed. Common causes:

- Species was added but with a slightly different code — check for typos and stray whitespace (capitalisation is *not* the issue; codes are matched case-insensitively).
- Quadrat was added under a different plot.
- An edit didn't save because the Impact Summary dialog was cancelled.

Open one of the failed rows in the grid and check exactly what the app sees vs. what your supporting data actually holds.

### A code I've used for years is suddenly flagged

Attribute codes became **soft warnings** in April 2026. The row is in the database; the warning means the code isn't in the Attributes list. Either add the code under **Stem & Plot Details → Stem Codes** or correct the value via Revision Upload.

---

## FAQ

### Are my failed measurements lost if I close the browser?

No. They are persisted in `coremeasurements` and remain until you clear or reingest them.

### Can I edit failed measurements directly?

Yes. The unified edit pipeline works on failed rows the same way it works on successful rows — open the grid, edit the fields, confirm the Impact Summary, Apply.

### Will my row ID change after reingest?

No. The same row ID survives corrections. This is intentional — it lets audit history follow a row through multiple fix-up passes.

### Can I revert an accidental edit?

Yes — per-row revert is available from the row menu after an Apply.

### Should I Clear Failed before re-uploading?

If you intend to re-upload the **same** CSV after fixing reference data, no — reingest will pick the rows up. If you're going to upload a **corrected** CSV that contains the same rows, clear first to avoid duplicates, or use a **Revision Upload** which won't duplicate.

### Do I have to fix everything at once?

No. You can reingest in waves — fix what you can, reingest, review what's still failing, fix more, reingest again.
