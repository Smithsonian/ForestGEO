# ForestGEO major user-path UX audit

Date: 2026-07-11

## Executive summary

The main data-browsing surfaces are usable once a site, plot, and census are fully loaded, and the CSV/ArcGIS mapping harnesses handle several important malformed and recovery cases correctly. The largest risks are around navigation/state trust rather than basic rendering:

1. Plot management routes to a real 404.
2. Account changes can retain a prior user's selected site and then cascade into 403s and false empty states.
3. The app reports 23,322 unresolved measurement errors in View Data while View Errors reports zero rows.
4. Upload history shows successful uploads while Uploaded Files says no files exist.
5. “Start New Census” creates a database record immediately, without a form or confirmation.
6. The shared site/plot/census selector is duplicated in the DOM, blocking a large portion of the browser regression suite before those workflows can begin.

These are high-trust workflows: users are deciding whether data exists, whether it is valid, and whether a destructive upload is safe. Contradictory counts and one-click creation are likely to produce support requests or accidental records.

## Remediation status

All findings in this report were remediated on `ux/walkthrough-remediation` after the original working tree was preserved in baseline commit `4c8fff7e`. Browser verification on 2026-07-11 confirmed:

- Plot creation and editing stay on the dashboard and use an explicit form.
- Census creation requires dates/description review and an explicit Create action; deletion accurately describes census-wide effects.
- Logout/account changes clear persisted selection state, and the displayed role matches the signed-in role.
- View Data and View Errors now share the same census scope and both report 23,322 failed rows in the test census.
- Uploaded Files distinguishes retained source files from Recent Changes audit history and provides a useful empty state.
- Exactly one site/plot/census selector is rendered at each breakpoint.
- CSV mode advertises CSV/TSV/TXT only; ArcGIS accepts one `.xlsx` workbook and has dedicated preflight guidance.
- Manual entry focuses the first editable cell, explains the save flow, validates required fields, and disables Finalize until rows are valid.
- Audited routes expose one non-empty page `h1`; branding uses subordinate or non-heading semantics.
- Add User and Provision New Site expose immediate accessible validation feedback.
- Routine context/validity requests no longer invoke the global blocking overlay, and transient counts/empty states use loading UI.
- At 390 × 844, the mobile drawer has one selector set, wrapped context labels, and no horizontal document overflow.
- A clean diagnostic reload produced no new browser warnings/errors; the conditional link-root, fragment-prop, and mysql2 promise warnings were removed.

## Scope and method

- Tested checkout: branch `ux/walkthrough-remediation`, HEAD `410f442d377690755b562e98c86afc9c0277a6da`.
- The checkout was not a clean branch-tip baseline: it contained 39 modified tracked files plus pre-existing untracked notes. The browser therefore tested the current working tree (branch tip + local uncommitted remediation), not a reproducible clean commit.
- Browser-controlled walkthrough against the local development app at `http://localhost:3000`.
- Local E2E accounts were used for global-admin and field-crew roles.
- Live test context: `forestgeo_testing` → plot `serc` → Census 1.
- Desktop and 390 × 844 mobile layouts were exercised.
- Realistic behavior included deep links, hard reloads, account switching, keyboard submission, searching, menu use, opening creation/edit/destructive dialogs, mobile navigation, and temporary record creation/cleanup.
- Upload behavior was supplemented by the project's Cypress browser harness because the in-app browser controller cannot populate a native file chooser.
- A temporary planned Census 2 was created by the one-click “Start New Census” path and deleted during cleanup. No clean re-upload, site deletion, validation override, or other destructive final action was committed.

The app was run in development with `NEXT_PUBLIC_E2E_TESTING=true`. Development error badges are not production UI, and middleware behavior in E2E mode is not a valid production authorization audit. API-level 403 behavior and cross-account state leakage were still observable.

The error-count and upload-history/file-list discrepancies below are runtime observations against the current test data. They require contract/data-retention triage before being classified as code regressions.

## Coverage matrix

| Area | Paths and behaviors exercised | Result |
| --- | --- | --- |
| Authentication | `/login`, local E2E sign-in, logout, signed-out deep link | Login/logout worked. Signed-out protected deep links render a blank protected shell in E2E mode rather than redirecting. |
| Selection | Site → plot → census, clear/reselect, hard reload, account switch | Core selection worked. Loading states are blocking and misleading; account switching retained an unauthorized prior site selection. |
| Dashboard | Empty, partially loaded, and populated states; site/plot/census cards; Help; settings; mobile | Populated metrics loaded, but false “No Census Data Yet” states appeared for retained/unauthorized context. Help and settings menus can remain open together. |
| Plot management | Dashboard “Add New Plot”/plot-edit destination, `/fixeddatainput/plots` | Broken: 404 “Not Found”. |
| Census creation/deletion | “Start New Census”, delete newly created empty census | Creation happened immediately with no form/confirmation. Cleanup deletion required a confirmation dialog and succeeded. |
| Stem Codes | `/fixeddatainput/attributes`, search/grid, add-record dialog, new row, upload mode chooser | Grid loaded. Manual entry is hard to discover after “New Row”; upload chooser opened. |
| Personnel | `/fixeddatainput/personnel`, grid and upload entry | Loaded after blocking global initialization. |
| Quadrats | `/fixeddatainput/quadrats`, grid and upload entry | Loaded after blocking global initialization. |
| Species | `/fixeddatainput/alltaxonomies`, grid, species limits, add/upload entry | Loaded. Repeated “Add Species Limits” controls make the wide grid visually noisy. |
| Census overview | `/measurementshub/censusoverview`, tools, publish/rebuild/delete controls | Metrics and tools loaded. Page-level heading is blank in the accessibility tree; destructive affordances are visually inconsistent. |
| View Data | `/measurementshub/summary`, quick search, status filters, More menu, manual entry, CSV upload, ArcGIS import | Search correctly reduced `20015` to one row. Major error-count contradiction; upload guidance issues described below. |
| View Errors | `/measurementshub/errors`, source/filter controls, row-details empty state | Loaded but returned zero rows while View Data reported 23,322 unresolved errors. |
| Statistics | `/measurementshub/postvalidation`, statistic list, run/download/print/query controls | Loaded and controls were present. |
| Recent Changes | `/measurementshub/recentchanges`, user/table/upload filters, load-more | Loaded and showed multiple upload events. Duplicate page headings. |
| Uploaded Files | `/measurementshub/uploadedfiles`, refresh, empty table | Loaded but showed “No data available” despite upload history elsewhere. Blank page heading. |
| Historical data | `/measurementshub/viewfulltable`, pagination, filters, read-only notice | Loaded 657 pages and clearly stated the read-only constraint. |
| Validations | `/measurementshub/validations`, add/edit/download/test affordances | Loaded with validation controls. |
| Admin users | `/admin/users`, add-user dialog, invalid email state | Loaded. Invalid email did not mark the field invalid and the submit button became enabled. |
| Admin sites | `/admin/sites`, grid/filter/export | Loaded. |
| Assignments | `/admin/userstosites`, role filters, details/removal affordances | Loaded. Removal actions are prominent; final destructive actions were not executed. |
| Provisioning | `/admin/provision`, blank Next action, `/admin/provision/runs`, `/admin/provision/3`, teardown confirmation | Pages loaded. Blank Next produced no feedback. Exact-schema teardown confirmation was appropriately guarded. |
| Mobile | Dashboard and mobile drawer at 390 × 844 | Menu opened and was keyboard-addressable. Long selection labels clip; top/bottom content competes with fixed UI. |

## Findings

### Critical — plot management is a dead route

The dashboard exposes “Add New Plot” and plot-edit behavior, but `/fixeddatainput/plots` returns the framework 404: “Not Found — Could not find requested resource.” The source also pushes to that path from the dashboard.

Impact: users can discover plot management and then hit a dead end in a foundational setup workflow.

Recommendation: either implement the route or keep plot creation/editing inside an existing modal. Add an end-to-end assertion that follows the actual dashboard card/button rather than visiting a presumed route directly.

### Critical — Start New Census creates a record immediately

Clicking “Start New Census” immediately displayed “Creating new census…” and added “Census 2 — Planned — Dates not set — No description.” No form, confirmation, or explanation preceded the write.

The delete flow then described removal as “Delete Measurements,” even for an empty planned census, which obscures whether the census record itself will be removed.

Impact: exploratory clicks create junk censuses; users cannot enter dates or a description before creation; cleanup terminology does not match the object being deleted.

Recommendation: make the first click open a creation form with dates, description, and an explicit Create action. For an empty planned census, label deletion “Delete census,” and summarize exactly what will be removed.

### High — cross-account selection state leaks and produces false data states

After logging out of the admin account and signing in as field crew, the sidebar retained `Testing Schema` from the previous user. Plot/census loading then failed with 403s, the dashboard said “No Census Data Yet,” and the profile area still emphasized “Administration.”

Impact: a user can inherit another account's context, see a false empty-state message, and generate repeated forbidden requests. This is both confusing and a trust/security smell, even if the APIs correctly reject access.

Recommendation: scope persisted selection by user ID/email, clear it on logout/account change, and validate access before hydrating any selected site. Replace raw 403-driven states with “You do not have access to this site” and return the user to site selection.

### High — View Data and View Errors disagree by 23,322 rows

For the same site/plot/census:

- View Data showed `Errors 23,322` and the alert “23,322 row(s) with unresolved errors.”
- View Errors showed `Page 1 of 0`, no rows, and “Select a row to inspect its errors.”
- The dashboard simultaneously said validations had not been run.

Impact: users cannot know whether the census has errors, whether validations are pending, or where to resolve the reported failures.

Recommendation: define and label the states separately: validation failed, validation pending, and error-log row. If View Errors intentionally includes only logged errors, View Data must not call all failed/not-validated states “unresolved errors.” Provide a direct breakdown and keep counts sourced from the same contract.

### High — upload history and file management disagree

Recent Changes and the dashboard showed multiple successful uploads, including `SERC_c1_from_database.csv` with 33,430 rows and species uploads. Uploaded Files for the same scope showed “No data available.”

Impact: users may re-upload data because they believe the original file is missing, or may be unable to download/audit the source file for existing data.

Recommendation: explicitly distinguish “upload audit records” from “files still available in storage.” If storage retention removed a file, show a tombstone row with status and retention reason instead of an empty table. Rename “Uploaded CSV Files” because `.xlsx` is supported.

### High — duplicated selection controls block browser workflows

The regression suite repeatedly found two `plot-select-component` elements. The same test ID exists in both `components/sidebar.tsx` and `components/sidebar/plotselector.tsx`. This caused `scrollIntoView()` and `click()` to fail before revision upload, uploaded-file management, selection, fixed-data, measurement-grid, and error-explorer journeys could start.

Observed automated results:

- Upload/mapping run: 8 passed, 7 failed. All revision/file-management failures were blocked before the target workflow by the duplicated selector.
- Broader run was stopped after four specs because 22 of 23 completed tests failed at the same duplicated selection control (plus one login visibility failure). Continuing would only repeat the gate.

Impact: accessibility and automation contracts are ambiguous, and broad end-to-end coverage currently gives a false impression that downstream features are broken.

Recommendation: place the test ID on exactly one interactive root, make the rendered control singular at each breakpoint, and add a smoke assertion that site/plot/census test IDs each have a count of one.

### High — upload guidance is internally inconsistent

In the ArcGIS flow:

- Tips say “Select one ArcGIS Field Maps .xlsx workbook.”
- The dropzone advertises CSV, TXT, TSV, and Excel.
- The header guide marks many fields REQUIRED while showing a blank form-header mapping for Species Name, Subspecies Name, Measurement Date, Validated, Description, User Defined Fields, and Errors.
- The modal opens as a long internal scroll area; the visible starting position emphasizes the header guide and file dropzone while primary continuation actions are below the fold.

Impact: users cannot tell which file types or columns are truly accepted and may “fix” columns that the importer never consumes.

Recommendation: give ArcGIS a dedicated `.xlsx` accept state and only one file-type message. Drive required badges from the actual preflight schema. Never render a required mapping card with an empty target name. Keep the primary action sticky in the modal footer.

### Medium — manual entry does not reveal how to edit

“Add record” opens a dense manual-entry dialog. Clicking “New Row” adds a blank grid row, but no normal form inputs appear and Save/Discard remain disabled until the user discovers cell editing. The extensive header explanation dominates the accessibility tree and content hierarchy.

Recommendation: focus the first editable cell, show an inline “Double-click or press Enter to edit” hint, or use a conventional form for one-row entry. Collapse reference material by default and keep it out of the initial reading order when collapsed.

### Medium — blank and duplicated headings weaken orientation

Observed examples:

- Census Overview: blank page-level `h1`, followed by “Census 1 Overview” at `h3`.
- Uploaded Files: blank `h1`.
- Provisioning: “Provision New Site” appears at both `h1` and `h2`.
- Provisioning Runs and run detail: blank top heading followed by the real heading.
- Recent Changes: duplicate “Recent Changes” headings.
- Most screens also include multiple “ForestGEO” `h1` elements from shell/footer branding.

Recommendation: each route should have one non-empty page `h1`; brand/footer text should not be an `h1`.

### Medium — form validation gives silent or late feedback

- In Add User, entering `not-an-email` did not set `aria-invalid` and enabled Add user.
- In Provision New Site, clicking Next with required Site Name and Schema Name empty did nothing and showed no visible or accessible validation message.

Recommendation: validate on blur and on attempted progression, set `aria-invalid`, link helper text with `aria-describedby`, and move focus to the first invalid field.

### Medium — blocking initialization looks like broken data

Hard navigation repeatedly produced a full-screen “User interactions are temporarily disabled” overlay while sites, plot, census, quadrats, attributes, and species were loaded or revalidated. During this interval the sidebar displayed warning/error badges and temporarily disabled View Data/View Errors. On the live test census, settling could take several seconds.

Impact: users see “missing data” before the app knows whether data is missing, and routine navigation feels like a global lock.

Recommendation: do not compute missing-data warnings until prerequisites finish loading. Use localized skeletons and keep unrelated navigation usable. Cache stable fixed-data validity by context.

### Medium — mobile navigation clips important context

At 390 × 844, the drawer opened and worked, but the selected site/schema and “Select a Census. Required…” labels clipped horizontally. The fixed header, drawer, footer/profile controls, and development issue badge compete for vertical space.

Recommendation: allow selected-context labels to wrap or provide a compact mobile summary; ensure the drawer content starts below the fixed header and reserves space for bottom controls.

### Development-only diagnostics worth fixing

The browser recorded repeated React/Joy errors:

- `rootElementName` expected an anchor but a div rendered, with an SSR hydration warning.
- Invalid `data-last-child` props were passed to `React.Fragment`.
- Multiple forbidden/failed plot, census, quadrat, and user fetches were logged after the account switch.

The server also repeatedly warned that promise methods were being used on a non-promise `mysql2` query while setting session timeout.

These are not all production-visible, but they create noisy diagnostics, trigger the development overlay, and can hide real errors during testing.

## Upload journey results

The upload harness successfully exercised these behaviors:

- Non-standard CSV headers force mapping and carry the mapping plus raw rows to `sqlpacketload`.
- Cancelling required mapping prevents upload.
- Standard headers auto-resolve without forcing mapping.
- A malformed mapping/server 400 is surfaced instead of reporting false completion.
- Confirmed mapping persists during in-session back/forward review and clears when the file is removed/re-added.
- ArcGIS preflight can force sheet-role mapping and recover from a server-provided mapping without a stale loop.

Not fully verified:

- The production revision-upload continuation and uploaded-file download/delete browser journeys were blocked by the duplicated plot selector before file selection.
- Clean re-upload, validation override, census deletion of real data, site teardown, and other destructive final commits were intentionally not run against the shared live test data.
- Production Smithsonian SSO was not exercised; only the login shell and local E2E provider were tested.

## Recommended order of work

1. Fix the dead plot route and the one-click census creation behavior.
2. Scope/clear persisted selection on account changes and prevent stale unauthorized context hydration.
3. Reconcile validation/error counts and upload-history/file-storage states.
4. Remove duplicate site/plot/census selector roots/test IDs so the end-to-end suite can reach downstream workflows again.
5. Make upload accept rules and header requirements authoritative and consistent.
6. Add accessible page headings and visible field-validation feedback.
7. Reduce global blocking overlays and clean up the hydration/React warnings.
