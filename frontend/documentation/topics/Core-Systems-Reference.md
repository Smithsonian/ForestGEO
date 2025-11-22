# Core Systems Reference

This document provides a comprehensive reference of all core systems in the ForestGEO Application. Use this for technical documentation and system understanding.

---

## System 1: Authentication & User Management

### Description

Handles user authentication, session management, and access control.

### Key Files

- `/frontend/auth.ts` - NextAuth configuration & session handling
- `/frontend/auth.config.ts` - Authentication provider configuration
- `/frontend/middleware.ts` - Route protection middleware

### Components

- Login page: `/frontend/app/(login)/login/page.tsx`
- UnauthenticatedSidebar
- LoginLogout component

### Features

- OAuth-based authentication
- Role-based access (Admin, Site User, Viewer)
- Multi-site user assignment
- Session cookies and verification
- Protected route middleware

### User-Facing Pages

- `/login` - Login page

---

## System 2: Site/Plot/Census Context System

### Description

Manages hierarchical data selection and global application state.

### Key Files

- `/frontend/app/contexts/userselectionprovider.tsx` - User account selection
- `/frontend/config/macros/contextreducers.ts` - Context reducer logic

### Components

- Sidebar: `/frontend/components/sidebar/sidebar.tsx`
- SiteSelector: `/frontend/components/sidebar/siteselector.tsx`
- PlotSelector: `/frontend/components/sidebar/plotselector.tsx`
- CensusSelector: `/frontend/components/sidebar/censusselector.tsx`

### Features

- Site selection dropdown
- Plot selection (filtered by site)
- Census selection (filtered by plot)
- Global state persistence
- Context-aware data filtering

### Data Hierarchy

```
Site → Plot → Census → (data filtered by selection)
```

---

## System 3: Dashboard & Metrics System

### Description

Provides overview statistics and data health monitoring.

### Key Files

- `/frontend/app/(hub)/dashboard/page.tsx` - Main dashboard

### Components

- MetricCard: `/frontend/components/dashboard/metriccard.tsx`
- ProgressCard: `/frontend/components/dashboard/progresscard.tsx`
- ProgressTachometer: `/frontend/components/metrics/progresstachometer.tsx`
- ProgressPieChart: `/frontend/components/metrics/progresspiechart.tsx`

### Features

- Census progress visualization
- Stem statistics (old stems, multi-stems, new recruits)
- Data validity status indicators
- Recent changelog display
- Active user tracking
- Plot detail modals

### User-Facing Pages

- `/dashboard` - Main dashboard

---

## System 4: Data Upload System

### Description

Multi-stage pipeline for uploading and processing measurement data.

### Key Files

- `/frontend/components/uploadsystem/uploadparent.tsx` - Orchestrator

### Upload Segments (Stages)

| Stage                 | Component                     | Description           |
| --------------------- | ----------------------------- | --------------------- |
| START                 | `uploadstart.tsx`             | Form type selection   |
| UPLOAD_FILES          | `uploadparsefiles.tsx`        | File upload & preview |
| UPLOAD_SQL            | `uploadfiresql.tsx`           | Database processing   |
| VALIDATE              | `uploadvalidation.tsx`        | Data validation       |
| VALIDATE_ERRORS_FOUND | `uploadvalidationerrors.tsx`  | Error review          |
| UPDATE                | `uploadupdatevalidations.tsx` | Error correction      |
| UPLOAD_AZURE          | `uploadfireazure.tsx`         | Cloud storage         |
| COMPLETE              | `uploadcomplete.tsx`          | Completion            |
| ERRORS                | `uploaderror.tsx`             | Error handling        |

### Helper Components

- DropzoneCompact: File drop interface
- FileListEnhanced: File preview
- ProgressStepper: Progress UI
- CSVParserUtils: Parsing utilities
- DelimiterDetection: Format detection

### Features

- Drag-and-drop file upload
- CSV/TSV/TXT support
- Auto-delimiter detection
- Header validation
- 32KB chunk processing
- Real-time progress tracking
- ETC calculation
- Azure Blob Storage backup
- Error recovery & reingestion

---

## System 5: Validation System

### Description

Automated data quality checking with configurable rules.

### Key Files

- `/frontend/app/(hub)/measurementshub/validations/page.tsx` - Validation management

### API Endpoints

- `/api/validations/procedures/[validationType]/` - Run validations
- `/api/validations/validationlist/` - List validations
- `/api/validations/validationerrordisplay/` - Display errors
- `/api/validations/updatepassedvalidations/` - Update status
- `/api/validations/crud/` - CRUD operations

### Components

- ValidationRow
- NewValidationRow

### Available Validations

1. ValidateDBHGrowthExceedsMax
2. ValidateDBHShrinkageExceedsMax
3. ValidateFindAllInvalidSpeciesCodes
4. ValidateFindDuplicatedQuadratsByName
5. ValidateFindDuplicateStemTreeTagCombinationsPerCensus
6. ValidateFindMeasurementsOutsideCensusDateBounds
7. ValidateFindStemsInTreeWithDifferentSpecies
8. ValidateFindStemsOutsidePlots
9. ValidateFindTreeStemsInDifferentQuadrats
10. ValidateScreenMeasuredDiameterMinMax
11. ValidateScreenStemsWithMeasurementsButDeadAttributes
12. ValidateScreenStemsWithMissingMeasurementsButLiveAttributes

### Features

- Pre-ingestion format validation
- Post-ingestion data quality validation
- Configurable enable/disable per rule
- Error tracking and display
- Validation override capabilities
- Custom validation creation

### User-Facing Pages

- `/measurementshub/validations` - Validation management

---

## System 6: Fixed Data Management

### Description

CRUD operations for reference data (species, personnel, quadrats, attributes).

### Key Files

- `/frontend/app/(hub)/fixeddatainput/` - Fixed data pages

### Data Types

| Type       | Page                            | Component                         |
| ---------- | ------------------------------- | --------------------------------- |
| Quadrats   | `/fixeddatainput/quadrats`      | IsolatedQuadratsDataGrid          |
| Personnel  | `/fixeddatainput/personnel`     | IsolatedPersonnelDataGrid         |
| Attributes | `/fixeddatainput/attributes`    | IsolatedAttributesDataGrid        |
| Species    | `/fixeddatainput/alltaxonomies` | IsolatedAllTaxonomiesViewDataGrid |

### API Endpoints

- `/api/fixeddata/[dataType]/[[...slugs]]/` - CRUD operations
- `/api/formsearch/[dataType]/` - Search
- `/api/fixeddatafilter/[dataType]/[[...slugs]]/` - Filtering
- `/api/formdownload/[dataType]/[[...slugs]]/` - Download templates
- `/api/formvalidation/[dataType]/[[...slugs]]/` - Validation

### Features

- Single-row isolated editing
- Bulk data operations
- Form validation
- Template downloads
- Census rollover support

### User-Facing Pages

- `/fixeddatainput/quadrats`
- `/fixeddatainput/personnel`
- `/fixeddatainput/attributes`
- `/fixeddatainput/alltaxonomies`

---

## System 7: Measurements Data Management

### Description

Core measurement record viewing, editing, and management.

### Key Files

- `/frontend/app/(hub)/measurementshub/` - Measurements hub pages

### Components

- IsolatedMeasurementsDataGrid - Single-row editing
- MultilineMeasurementsDataGrid - Bulk editing
- MeasurementsCommons - Shared logic
- FiltrationSystem - Advanced filtering

### API Endpoints

- `/api/query/` - Unified query execution
- `/api/fetchall/[[...slugs]]/` - Fetch all data
- `/api/bulkcrud/` - Bulk operations
- `/api/details/cmid/` - Measurement details

### Features

- View current census measurements
- View historical data (all censuses)
- Single-row inline editing
- Multi-line bulk editing
- Advanced filtering and sorting
- Column visibility controls
- Row expansion for details
- Audit trail integration

### User-Facing Pages

- `/measurementshub/summary` - Current data view
- `/measurementshub/viewfulltable` - Historical data view

---

## System 8: Failed Measurements System

### Description

Tracking and recovery for measurements that failed processing.

### Key Files

- `/frontend/components/datagrids/applications/isolated/isolatedfailedmeasurementsdatagrid.tsx`
- `/frontend/components/client/modals/failedmeasurementsmodal.tsx`

### API Endpoints

- `/api/reingestsinglefailure/[schema]/[targetRowID]/` - Reingest single
- `/api/reingest/[schema]/[plotID]/[censusID]/` - Reingest all

### Features

- View failed measurements with failure reasons
- Edit failed records inline
- Single-record reingestion
- Bulk reingestion
- Clear failed measurements
- Integration with upload workflow

---

## System 9: Audit Trail System

### Description

Comprehensive change tracking and logging.

### Key Files

- `/frontend/app/(hub)/measurementshub/recentchanges/page.tsx`

### Components

- IsolatedUnifiedChangelogDataGrid

### API Endpoints

- `/api/changelog/overview/[changelogType]/[[...options]]/`
- `/api/unifiedchangelog/`

### Features

- Track all data modifications
- Before/after value recording
- User attribution
- Timestamp logging
- Filtering by date, user, operation
- Export capabilities

### User-Facing Pages

- `/measurementshub/recentchanges`

---

## System 10: Administrative System

### Description

User management, site management, and system administration.

### Key Files

- `/frontend/app/(hub)/admin/` - Admin pages

### Components

- CatalogSitesDatagrid
- CatalogUsersDatagrid
- User management interfaces

### API Endpoints

- `/api/administrative/fetch/[type]/`
- `/api/admin/clear/[tableType]/[schema]/[plotID]/[censusID]/`
- `/api/clearcensus/`
- `/api/rollover/[primaryKey]/[schema]/[plotIDParam]/[censusIDParam]/[newCensusIDParam]/`

### Features

- User CRUD operations
- Site management
- User-to-site assignment
- Census creation
- Census rollover
- Data clearing and reset

### User-Facing Pages

- `/admin/users`
- `/admin/sites`
- `/admin/userstosites`
- `/admin/catalog/sites`
- `/admin/catalog/users`
- `/admin/catalog/access`

---

## System 11: File Management System

### Description

Uploaded file tracking and Azure Blob Storage integration.

### Key Files

- `/frontend/app/(hub)/measurementshub/uploadedfiles/page.tsx`

### Components

- ViewUploadedFiles

### API Endpoints

- `/api/files/[operation]/`
- `/api/uploadedfiles/`
- `/api/verifyupload/`

### Azure Integration

- Container names: `/frontend/config/macros/containernames.ts`
- Azure storage: `/frontend/config/macros/azurestorage.ts`

### Features

- File upload to Azure Blob Storage
- File metadata tracking
- File download
- File deletion
- Upload verification

### User-Facing Pages

- `/measurementshub/uploadedfiles`

---

## System 12: Post-Validation Statistics System

### Description

Post-census analysis and statistical queries.

### Key Files

- `/frontend/app/(hub)/measurementshub/postvalidation/page.tsx`

### API Endpoints

- `/api/postvalidation/`
- `/api/postvalidationbyquery/[schema]/[plotID]/[censusID]/[queryID]/`

### Features

- User-triggered analysis queries
- Summary statistics
- Expandable result display
- Census quality metrics

### User-Facing Pages

- `/measurementshub/postvalidation`

---

## System 13: Data Layer & Database

### Description

Database connection management, ORM, and SQL operations.

### Key Files

- `/frontend/config/connectionmanager.ts` - Connection pool
- `/frontend/config/datamapper.ts` - Entity mapping
- `/frontend/lib/db-middleware.ts` - Database middleware

### SQL Definitions

- `/frontend/config/sqlrdsdefinitions/admin.ts`
- `/frontend/config/sqlrdsdefinitions/core.ts`
- `/frontend/config/sqlrdsdefinitions/personnel.ts`
- `/frontend/config/sqlrdsdefinitions/taxonomies.ts`
- `/frontend/config/sqlrdsdefinitions/timekeeping.ts`
- `/frontend/config/sqlrdsdefinitions/validations.ts`
- `/frontend/config/sqlrdsdefinitions/views.ts`
- `/frontend/config/sqlrdsdefinitions/zones.ts`

### SQL Scripts

- `/frontend/sqlscripting/storedprocedures.sql`
- `/frontend/sqlscripting/corequeries.sql`
- `/frontend/sqlscripting/tablestructures.sql`
- `/frontend/sqlscripting/triggers.sql`

### Features

- Azure MySQL connectivity
- Connection pooling
- Transaction management
- Deadlock handling
- Entity mapping
- Parameterized queries

---

## System 14: Telemetry & Logging

### Description

Application insights and logging infrastructure.

### Key Files

- `/frontend/ailogger.ts` - AI-assisted logging
- `/frontend/applicationinsights.ts` - Azure Application Insights
- `/frontend/lib/connectionlogger.ts` - Connection logging

### Features

- Azure Application Insights integration
- User activity tracking
- Error logging
- Performance monitoring
- Connection diagnostics

---

## System 15: Feedback System

### Description

GitHub issue integration for bug reports and feature requests.

### Key Files

- `/frontend/components/client/modals/githubfeedbackmodal.tsx`
- `/frontend/app/actions/github.ts`

### Features

- In-app feedback submission
- GitHub Issues integration
- Bug report templates
- Feature request support
