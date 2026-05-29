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
| **View Data → Measurements** | Failed rows appear inline alongside successful ones, visually flagged. Use the status filter to show only failures. |
| **View Errors** | Dedicated view of every row with a validation error, plus the consolidated reason and the original CSV codes. |
| **Failed Measurements modal** | Appears automatically after an upload if anything failed, so you can triage immediately. |

---

## Understanding failure reasons

Each failed row carries a **consolidated failure reason** built from one or more validations that didn't pass. Failures fall into two broad categories:

### Hard failures — the row can't be ingested as-is

| Reason | Field | How to fix |
|---|---|---|
| **SpCode missing** | Species Code | Add a valid species code |
| **Quadrat missing** | Quadrat | Add a valid quadrat name |
| **Missing X / Missing Y** | Coordinates | Provide coordinates (a value of `-1` is treated as missing) |
| **Missing Tag** | Tree Tag | Provide a tree tag |
| **Missing StemTag** | Stem Tag | Provide a stem tag |
| **Missing Date** | Date | Provide a valid date (`YYYY-MM-DD`) |
| **SpCode invalid** | Species Code | Add the species to the Species List, then reingest |
| **Quadrat invalid** | Quadrat | Add the quadrat under Fixed Data, then reingest |

### Soft warnings — the row is kept, but flagged

| Reason | What it means |
|---|---|
| **Invalid Codes** | One or more attribute codes weren't recognised. **As of April 2026 these are soft warnings, not hard rejections** — the row still goes into the database but the unknown codes are surfaced so you can either add them to the Attributes list or correct the value. |
| Cross-census growth / shrinkage warnings | DBH, HOM, or status changes that look implausible compared with the previous census. Reviewed and accepted or corrected case-by-case. |

See **[Validation Errors](/ForestGEO/errors/validation-errors/)** for the full validation reference.

---

## How to fix failed measurements

You have **three** workflows, each suited to a different scale of correction.

### Method 1 — Add the missing reference data, then reingest

Best when many rows fail because the **app doesn't know about something yet** (a species, a quadrat, an attribute code).

1. Read the consolidated failure reasons.
2. Add the missing references under **Fixed Data**:
   - Missing species → **Fixed Data → Species List**
   - Missing quadrats → **Fixed Data → Quadrats**
   - Missing codes → **Fixed Data → Attributes / Stem Codes**
3. Return to **Failed Measurements** and click **Reingest All**. Rows are pushed back through `bulkingestionprocess`; those that now pass move into the normal census stream, the ones that still fail come back here with updated reasons.

### Method 2 — Edit rows in place

Best for typos and one-off corrections in a handful of rows.

The grid uses the **unified row-editing pipeline** (rolled out in April–May 2026). Every edit — whether you initiated it from View Data, View Errors, or the Failed Measurements view — goes through the same flow:

1. Open the grid and click a row's edit action.
2. Make your changes.
3. The app shows an **Impact Summary** dialog before any write: which fields will change, how many other rows are affected (if any), and any validation warnings that the change would raise.
4. For **destructive** edits (deletes, mass changes), you'll be asked to type `APPLY N` (where N is the affected row count) as a guard against accidental clicks.
5. After Apply, you can **revert** an individual row from its row menu if you change your mind.

Failed-row edits run validation immediately on Apply, so a row that now passes will move out of the failed state in the same transaction.

### Method 3 — Revision Upload (CSV)

Best when you have **many rows to fix** and prefer to work in a spreadsheet.

Export the data, fix the offending values, and submit as a **Revisions** upload. This is a separate upload mode from the original ingest — the app matches your file against existing rows and updates only the columns you changed.

- **Editable through Revisions:** DBH, HOM, Measurement Date, Codes (`RawCodes`), Comments.
- **Not editable through Revisions:** Species Code, Tree Tag, Stem Tag, Quadrat, Coordinates. Edits to these columns surface in an **Ignored Edits** tab so you'll see what wasn't applied.

See **[Upload Process Breakdown](/ForestGEO/upload-process-breakdown/)** for the full Revision Upload walkthrough.

---

## The Failed Measurements modal

When failed rows exist, the modal offers these actions:

| Button | What it does | When to use |
|---|---|---|
| **Reingest All** | Pushes every failed row back through `bulkingestionprocess` | After adding missing reference data or fixing rows |
| **Clear Failed** | Permanently deletes failed rows | When failures are not recoverable or you're about to re-upload from scratch |
| **Clear Temporary** | Drops anything left in the staging table | Cleaning up after an aborted upload |
| **Close** | Dismiss without action | When you want to investigate before deciding |

---

## Reingestion explained

When you click **Reingest**:

1. The selected rows are written back to the staging table.
2. `bulkingestionprocess` runs end-to-end on them.
3. Rows that now pass move into the active census stream.
4. Rows that still fail come back with **updated** consolidated reasons — the original reason may already be resolved and a new one surfaced.

:::caution
Each row keeps its **same row ID** through reingestion. This means audit history (who created it, when, in which upload batch) is preserved across multiple correction passes.
:::

---

## Common scenarios

### Many rows show "SpCode invalid"

The species code in your CSV isn't in the Species List for this site. Add the missing species under **Fixed Data → Species List**, then **Reingest All**.

### Quadrat names don't line up

Either the quadrats aren't defined for the plot yet, or the names in your CSV use a different format (leading zeros, separators). Compare your file against **Fixed Data → Quadrats**. You can either add the missing quadrats or correct the names — either through inline edits or a Revision Upload.

### Same failures keep coming back after reingest

The underlying reference data wasn't actually fixed. Common causes:

- Species was added but with a slightly different code (case-sensitive!).
- Quadrat was added under a different plot.
- An edit didn't save because the Impact Summary dialog was cancelled.

Open one of the failed rows in the grid and check exactly what the app sees vs. what's in Fixed Data.

### A code I've used for years is suddenly flagged

Attribute codes became **soft warnings** in April 2026. The row is in the database; the warning means the code isn't in the Attributes list. Either add the code under **Fixed Data → Attributes** or correct the value via Revision Upload.

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
