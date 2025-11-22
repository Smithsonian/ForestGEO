# Process Flows Reference

This document outlines all user process flows in the ForestGEO Application. Use this as a reference when creating step-by-step documentation.

---

## Flow 1: Authentication and Entry

### Flow Name

User Login and Dashboard Access

### Starting Point

`/login` (Login Page)

### Steps

1. User arrives at login page
2. User authenticates via OAuth provider
3. System verifies credentials
4. Upon success, redirect to `/dashboard`
5. Loading spinner displays during auth verification

### Key Components

- Login page with animated background
- NextAuth session management
- UnauthenticatedSidebar component

### User Accomplishes

Secure authentication and access to main application

---

## Flow 2: Context Selection (Site/Plot/Census)

### Flow Name

Dashboard Overview and Context Selection

### Starting Point

`/dashboard` (Dashboard Hub)

### Steps

1. User lands on dashboard
2. Dashboard displays overview metrics
3. User selects Site from dropdown
4. User selects Plot from dropdown (appears after site selected)
5. User selects Census from dropdown (appears after plot selected)
6. All pages now filtered by these selections

### Key Components

- Sidebar with Site, Plot, Census selectors
- Dashboard metrics display
- Context providers (UserSelectionProvider)

### User Accomplishes

- View census statistics
- Select active working context
- Monitor data health

---

## Flow 3: Measurement Data Upload (Primary Workflow)

### Flow Name

Complete Measurement Data Upload

### Starting Point

Modal trigger from Measurements Hub or Dashboard

### Review States (Stages)

1. START
2. UPLOAD_FILES
3. UPLOAD_SQL
4. VALIDATE
5. VALIDATE_ERRORS_FOUND (conditional)
6. UPDATE (conditional)
7. UPLOAD_AZURE
8. COMPLETE

### Detailed Steps

#### Stage 1: Start Selection

- Component: `UploadStart`
- User selects form type (measurements, attributes, etc.)
- Confirms selection

#### Stage 2: File Upload and Preview

- Component: `UploadParseFiles`
- User drops CSV/TSV file in dropzone
- System auto-detects delimiter
- File preview displays in data grid
- System validates required headers
- User confirms file

#### Stage 3: Database Processing

- Component: `UploadFireSQL`
- System chunks data (32KB chunks)
- Sequential batch processing
- Progress tracking with ETC
- Data inserted to staging table

#### Stage 4: Validation

- Component: `UploadValidation`
- System runs validation procedures
- If failures: proceed to Stage 5
- If success: proceed to Stage 7

#### Stage 5: Error Review (Conditional)

- Component: `UploadValidationErrors`
- Displays count of failed measurements
- Options: retry, clear, or proceed

#### Stage 6: Error Correction (Conditional)

- Component: `UploadUpdateValidations`
- User edits failed rows
- Re-processes corrected data

#### Stage 7: Azure Storage Upload

- Component: `UploadFireAzure`
- Files uploaded to Azure Blob Storage
- Metadata recorded

#### Stage 8: Completion

- Component: `UploadComplete`
- Success confirmation displayed
- System refreshes cache
- Cleanup of staging tables

### Key Components

- UploadParent (orchestrator)
- Upload segment components
- DropzoneCompact
- FileListEnhanced
- ProgressStepper

### User Accomplishes

Upload and validate measurement data with cloud backup

---

## Flow 4: Failed Measurements Reingestion

### Flow Name

Failed Measurements Recovery

### Starting Point

Failed Measurements Modal or Measurements Hub

### Steps

1. Failed measurements identified during upload
2. Modal displays failed count
3. User reviews failed records
4. Options:
   - Clear failed measurements
   - Clear temporary measurements
   - Reingest failed records
5. If reingest: workflow restarts at UPLOAD_SQL
6. System reprocesses from staging
7. Validation and completion as normal

### Key Components

- FailedMeasurementsModal
- UploadReingestion component
- IsolatedFailedMeasurementsDataGrid

### User Accomplishes

Recover failed measurements without re-uploading files

---

## Flow 5: View Measurement Data

### Flow Name

Measurement Data Viewing

### Starting Point

`/measurementshub/summary` or `/measurementshub/viewfulltable`

### Steps

1. Navigate to Measurements Hub > View Data
2. Data grid loads measurement records
3. Use column headers to sort
4. Use filter inputs to search
5. Click row to expand details
6. Use column visibility toggle (hamburger menu)

### Key Components

- MeasurementsSummaryViewDataGrid
- ViewFullTableDataGrid
- Filtration system

### User Accomplishes

View, filter, and sort measurement data

---

## Flow 6: Edit Measurement Data

### Flow Name

Measurement Data Editing

### Starting Point

Any data grid page

### Steps

1. Navigate to data view page
2. Click cell to edit (single-row mode)
3. Enter new value
4. Press Enter or blur to save
5. System validates and saves change
6. Change logged to audit trail

### Key Components

- Isolated datagrid components
- Multi-line datagrid components
- Row editing components

### User Accomplishes

Modify existing measurement records

---

## Flow 7: View Audit Trail

### Flow Name

Change History Viewing

### Starting Point

`/measurementshub/recentchanges`

### Steps

1. Navigate to Measurements Hub > Recent Changes
2. View unified changelog
3. Filter by date, user, operation type
4. See before/after values for each change

### Key Components

- IsolatedUnifiedChangelogDataGrid

### User Accomplishes

Track all data modifications for compliance

---

## Flow 8: Validation Management

### Flow Name

Create and Manage Validations

### Starting Point

`/measurementshub/validations`

### Steps

1. Navigate to Validations Hub
2. View existing validation rules (Enabled/Disabled tabs)
3. To add: Click (+) button
4. Fill in validation fields:
   - Name
   - SQL query
   - Error threshold
   - Enabled/disabled
5. To edit: Click row, modify fields
6. Save changes
7. To delete: Click delete icon, confirm

### Key Components

- ValidationRow
- NewValidationRow
- Schema structure reference panel

### User Accomplishes

Define and manage data quality rules

---

## Flow 9: Fixed Data Management (Generic)

### Flow Name

Fixed Data CRUD Operations

### Starting Points

- `/fixeddatainput/quadrats` (Quadrats)
- `/fixeddatainput/personnel` (Personnel)
- `/fixeddatainput/attributes` (Stem Codes)
- `/fixeddatainput/alltaxonomies` (Species)

### Steps

1. Navigate to appropriate Fixed Data page
2. View existing records in data grid
3. To add: Click (+) button, fill fields
4. To edit: Click cell, modify value
5. To delete: Click delete icon, confirm
6. Save changes (auto-save or explicit save)

### Key Components

- IsolatedQuadratsDataGrid
- IsolatedPersonnelDataGrid
- IsolatedAttributesDataGrid
- IsolatedAllTaxonomiesViewDataGrid

### User Accomplishes

Manage reference data for measurements

---

## Flow 10: User Management (Admin)

### Flow Name

User Account Management

### Starting Point

`/admin/users`

### Steps

1. Navigate to Admin > Users
2. View user table
3. To add: Click add button, fill user details
4. To edit: Click row, modify fields
5. Assign sites to user
6. Save changes

### Key Components

- User data grid
- Site assignment interface

### User Accomplishes

Create and manage user accounts

---

## Flow 11: User-Site Assignment (Admin)

### Flow Name

User Access Control

### Starting Point

`/admin/userstosites`

### Steps

1. Navigate to Admin > User-to-Sites
2. View user-site relationships
3. Select user tab
4. Assign/remove sites
5. Save changes

### Key Components

- Tab interface
- Multi-select site assignment

### User Accomplishes

Control which sites users can access

---

## Flow 12: Census Creation

### Flow Name

Create New Census

### Starting Point

Dashboard or Admin

### Steps

1. Ensure plot is selected
2. Click "Create New Census"
3. Enter census details (start date, optional end date)
4. Optionally roll over data from previous census:
   - Personnel
   - Quadrats
   - Species
   - Stem Codes
5. Confirm creation
6. New census appears in selector

### Key Components

- Census creation modal
- Rollover selection interface

### User Accomplishes

Start a new data collection period

---

## Flow 13: Post-Validation Statistics

### Flow Name

Run Post-Census Analysis

### Starting Point

`/measurementshub/postvalidation`

### Steps

1. Navigate to Measurements Hub > Post-Census Statistics
2. View available analysis queries
3. Click query to run
4. View results in expandable panel
5. Interpret summary statistics

### Key Components

- PostValidationRow
- Query result display

### User Accomplishes

Analyze census data quality and statistics

---

## Flow 14: Uploaded Files Management

### Flow Name

Manage Uploaded Files

### Starting Point

`/measurementshub/uploadedfiles`

### Steps

1. Navigate to Measurements Hub > Uploaded Files
2. View file history (filename, date, user, status)
3. Download files
4. Delete files (with confirmation)

### Key Components

- ViewUploadedFiles component
- File metadata display

### User Accomplishes

Access and manage uploaded data files

---

## Flow 15: Feedback Submission

### Flow Name

Submit Bug Report or Feature Request

### Starting Point

Help icon in header

### Steps

1. Click help/feedback icon
2. Modal opens
3. Fill in:
   - Issue title
   - Description
   - Issue type (bug/feature/improvement)
   - Reproduction steps (if applicable)
4. Submit
5. View confirmation with GitHub issue link

### Key Components

- GithubFeedbackModal
- GitHub API integration

### User Accomplishes

Report issues directly to development team

---

## Flow 16: Error Recovery

### Flow Name

Upload Error Handling

### Starting Point

Any upload error state

### Steps

1. Error occurs during upload
2. Error component displays details
3. Options:
   - Return to Start
   - Retry failed step
   - Download error report
4. User addresses issue
5. Restarts or retries upload

### Key Components

- UploadError component
- Error boundary components

### User Accomplishes

Recover from upload failures
