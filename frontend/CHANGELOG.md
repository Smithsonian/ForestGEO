# App Changelog History

## Acacia Update (Completion: 9/15/2024)

###### Note: all project files received updated formatting and linting. Files that received ONLY these changes have been omitted for brevity.

### Workflow

1. Dedicated dev branch workflow created
2. Main branch workflow isolated to focus only on main updates

---

### Documentation

1. Writerside-powered documentation application created and added to Github Pages (accessible
   at [this page](https://smithsonian.github.io/ForestGEO/))

---

### Formatting and Configuration

1. ESLint properly integrated
2. Prettier installed and integrated

---

### Testing

1. Formatting reapplied to test files
2. Skips applied to incomplete test cases (will ensure that broken tests do not crash builds)
3. New rollover modal test file created - only framework, automatically skipped and pending full build-out

---

### Webpages

1. NextJS-powered default error pages applied to all existing webpages. This will in turn ensure that potential
   breakages don't immediately cause cascading issues or full app shutdown.

#### Dashboard

1. Full overhaul and reorganization of components
2. Baseline user documentation provided to user
3. Animation tool to highlight Github Feedback Modal added
4. User information display (will show name, email, role, and available sites)
5. Recent changes menu implemented -- Skeleton-powered display of 5 most recent changes to site schema. Only displayed
   after site, plot, and census is applied to reduce number of queries being made to schema.

#### Hub Layout file

1. Reorganization and debugging core issues around site/plot/census selection
2. Debounce implemented -- severe performance issues were being caused by constant reloading of site/plot/census
   selection
3. Site/plot/census re-selection system was replaced fully using React useRef hooks. This ensures that dispatches are
   externally monitored and only fired when necessary
4. Previously, site/plot/census were being reloaded simultaneously. This in turn caused synchronization issues when
   attempting to re-select site/plot/census. System replaced with staggered loading system and sequential list loading
   instead
5. Acacia version text removed -- no core versions are needed for anything other than historical app status tracking.
6. Github Feedback modal integrated into all page footers -- this will allow users to provide feedback at any point in
   the site

#### View Data page

1. Previous page implementation was moved to dedicated component file.

#### Validations page

1. User-facing display implemented to display existing stored validations
2. ValidationCard component created to show validation name, description, and SQL implementation
3. ValidationCard toggle implemented to allow enabling/disabling of each validation
4. Page interaction has been restricted to only allow users with administrator/db-admin status to make modifications,
   etc.

#### View Full Table page

1. Dedicated page to show viewfulltable materialized view information created.

#### Sidebar

1. now uses Select components to handle site/plot/census selection instead of previous modal system.
2. navigation menu has been updated to reflect new navigation menu and endpoint names have been updated to be clearer

---

### API changes

#### frontend/app/api/auth/[[...nextauth]]/route.ts

1. Dedicated type UserStatusRoles created to centralize allowed set of user roles
2. IsAdmin state deprecated and removed -- not granular enough

#### frontend/app/api/changelog/overview/[changelogType]/[[...options]]/route.ts

1. Handles changelog history requests
2. Populates dashboard page's recent changes component

#### frontend/app/api/cmprevalidation/[dataType]/[[...slugs]]/route.ts

1. Queries placed reworked to correctly integrate with updated schema system
2. HTTPResponses status code macro applied to replace hardcoded status codes

#### frontend/app/api/details/cmid/route.ts

1. Query reworked to correctly integrate with updated schema system

#### frontend/app/api/fetchall/[[...slugs]]/route.ts

1. System reworked to ensure compatibility with all implemented RDS types.
2. buildQuery function revamped accordingly

#### frontend/app/api/fixeddata/[dataType]/[[...slugs]]/route.ts

1. Formatting applied

###### GET

1. FixedData cases' queries updated to correctly work with updated schemas
2. New tables/cases added:
    1. `personnelrole`
    2. `sitespecificvalidations`
    3. `roles`
    4. `measurementssummary`
    5. `viewfulltable`

###### POST

1. insertIDs object created to return IDs of inserted rows
2. `view` query config implementation updated
3. other cases have been updated to more efficiently integrate into insertIDs system

###### PATCH

1. similarly updated in line with POST endpoint

###### DELETE

1. similarly updated in line with POST endpoint

#### frontend/app/api/postvalidation/route.ts

1. Postvalidation summary statistics calculation endpoint
2. Statistics queries:
    1. `number of records by quadrat`
    2. `all stem records by quadrat (count only)`
    3. `live stem records by quadrat (count only)`
    4. `tree records by quadrat (count only)`
    5. `number of dead or missing stems by census`
    6. `trees outside of plot limits`
    7. `stems with largest DBH/HOM measurements by species`
    8. `all trees that were recorded in last census that are NOT in current census`
    9. `number of new stems per quadrat per census`
    10. `quadrats with most and least new stems per census`
    11. `number of dead stems per quadrat per census`
    12. `number of dead stems per species per census`

#### frontend/app/api/refreshviews/[view]/[schema]/route.ts

1. triggers materialized view table refresh

#### frontend/app/api/rollover/[dataType]/[[...slugs]]/route.ts

1. Census rollover handler
2. Uses NextJS's dynamic routing system to allow for dynamic query placement and execution

#### frontend/app/api/specieslimits/[speciesID]/route.ts

1. Species-set limits handler
2. Currently only adding/updating species limits is supported -- actual interaction system is still in progress.

#### frontend/app/api/sqlmonitor/route.ts

1. monitoring endpoint for SQL state, added for debugging/testing purposes

#### frontend/app/api/structure/[schema]/route.ts

1. returns structure of a given schema (by table name/column name)

#### frontend/app/api/validations/crud/route.ts

1. interface point for validations page
2. not yet complete, but will eventually allow for CRUD operations on validations

#### frontend/app/api/validations/procedures/[validationType]/route.ts

1. revised handler to process validation procedures

#### frontend/app/api/validations/updatepassedvalidations/route.ts

1. post-validation IsValidated field update system
2. revised from previous iteration to instead use generic utils.ts function

#### frontend/app/api/validations/validationerrordisplay/route.ts

1. returns a list of existing validation errors organized by CoreMeasurementID -- these are then used to correlate
   viewed rows with validation errors if they exist

#### frontend/app/api/validations/validationlist/route.ts

1. returns a list of existing validations
2. additional processing incorporated for customized site-specific validations, but this is not yet being used anywhere.

---

### Context Updates

#### Lock Animation Context

1. increased timeout delay from 3 seconds to 5 seconds

---

### Components Updates

#### DataGrid Columns

1. all applicable datagrid usages' column array instances have been centralized here
2. additional formatting applied to allow customized column header formatting
3. customized cell and edit cell rendering added
4. some exceptions exist -- for instances where specific additional handling is needed, column states are directly
   defined in the datagrid components themselves.
    1. `alltaxonomiesview` -- specieslimits column customized addition

#### GitHub Feedback Modal

1. allows users to submit github issue creation requests directly from modal
2. provides categories for selection and attaches additional metadata to newly created issue

#### Rollover Modal

1. allows users to customize new census creation
2. users can select to rollover personnel, quadrats, or neither
3. further customized selection of which personnel/quadrats are being rolled over

#### Rollover Stems Modal

1. template system to allow direct rollover of stems information
2. proof of concept more so than anything else

#### Validation Modal

1. additional proof of concept system
2. attempt at creating a dedicated modal for validation of rows that were missed during validation (for example, in the
   event of data loss or some other connection failure event)
3. not currently used anywhere

#### DataGrid Updates

1. The DataGridCommons generic datagrid instance has been replaced by the IsolatedDataGridCommons instance, which
   isolates as much information as possible to the generic instance rather than the existing DataGridCommons, which
   requires parameter drilling of all MUI X DataGrid parameters. Current datagrids using this new implementation are:
    - `alltaxonomiesview`
    - `attributes`
    - `personnel`
    - `quadratpersonnel`
    - `quadrats`
    - `roles`
    - `stemtaxonomiesview`
2. found that attempting to use typescript runtime utilities to create "default" initial states for each RDS type was
   causing cascading failures. Due to the way that runtime utility functions work, no data was actually reaching the
   datagrids importing those initial states
    1. replaced with manual definition of initial states -- planning on centralizing this to another place, similar to
       the `datagridcolumns.tsx` file
3. `measurementssummaryview` datagrid instance added as a replacement to the previously defined summary page

#### Re-Entry Data Modal

1. data re-entry system has been reworked to allow customized field selection for repetition (can thus remove foreign
   key reference columns from reentry)
2. `clusters` and `hiddenColumns` added -- the `clusters` object provides grouping options for reentry (preventing
   reentry fields from rendering in a single very very long line) and the `hiddenColumns` object allows columns that
   shouldn't need re-entry to
   be omitted.

#### ProcessPersonnel Handler

1. new customized personnel upload handler, now that a `roles` table has been created and `CensusID` and `RoleID`
   foreign keys have been added to the `personnel` table
2. attempts insert or update of roles data, and retrieves either insertID or existing ID
3. retrieved RoleID is used to insert or update `personnel` table next

#### Theme Updates

1. JoyUI Tooltip's default instance has been customized - touch listener has been disabled, leaveDelay has been set to
   100ms and pointerEvents has been set to `none`

---

### Upload System Updates

1. autocompletion system has been enhanced and reworked to auto-fill unit values and area dimensions. Genus/Species
   breakdown has also been simplified, but needs updating
2. additional toggle added to datagrid display at the review stage to apply autocompletion changes. User can choose not
   to if desired
3. countdown timer has been removed
4. validations -- update validation stage has been removed. validation toggle now automatically triggers on completion
   of all validation procedures
5. validation system has also been fully overhauled -- instead of stored procedures, validaiton procedures are now
   stored as dedicated queries in the `catalog.validationprocedures` table. When validations are run, the respective SQL
   queries is pulled from the table. This makes the system flexible and modifiable, as stored procedures are
   significantly more immutable.
6. materialized view tables -- `measurementssummary` and `viewfulltable`. Due to extended query time for the existing
   SQL views and the lack of support for materialized views in MySQL 8, a manual version was implemented. these
   dedicated tables are populated via stored procedure and have significantly reduced query time. Upload system has been
   enhanced to call both table refresh commands as part of the Azure upload process.
7. materialized view reload has been adjusted to be optional. user should be able to continue the process even if one or
   more of the views fails.

---

### SQL Updates

1. Schema has been been updated -- new tables added:
    1. `roles` - outlines user roles
    2. `specieslimits` - allows setting min/max bounds on measurements
    3. `specimens` - recording specimen data (added on request by ForestGEO)
    4. `unifiedchangelog` - partitioned table that tracks all changes to all tables in schema. All tables have triggers
       that automatically update the `unifiedchangelog` on every change
    5. `sitespecificvalidations` - for specific validations applicable only to the host site
2. validation stored procedures have been deprecated and removed, replaced with `validationprocedures` and
   `sitespecificvalidations` tables
3. migration script set has been completed and tested
4. trigger definitions have been recorded
5. view implementations have been updated
