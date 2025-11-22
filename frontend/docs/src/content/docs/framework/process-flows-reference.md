---
title: Process Flows Reference
description: Reference guide for all user process flows in the ForestGEO Application.
---

This document outlines all user process flows in the ForestGEO Application. Use this as a reference when understanding how the application works.

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

### Upload Stages
1. **START** - Form type selection
2. **UPLOAD_FILES** - File upload & preview
3. **UPLOAD_SQL** - Database processing
4. **VALIDATE** - Data validation
5. **VALIDATE_ERRORS_FOUND** - Error review (conditional)
6. **UPDATE** - Error correction (conditional)
7. **UPLOAD_AZURE** - Cloud storage backup
8. **COMPLETE** - Completion

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
5. If reingest: workflow restarts at processing
6. System reprocesses from staging
7. Validation and completion as normal

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

### User Accomplishes
View, filter, and sort measurement data

---

## Flow 6: Edit Measurement Data

### Flow Name
Measurement Data Editing

### Steps
1. Navigate to data view page
2. Click cell to edit (single-row mode)
3. Enter new value
4. Press Enter or blur to save
5. System validates and saves change
6. Change logged to audit trail

### User Accomplishes
Modify existing measurement records

---

## Flow 7: Fixed Data Management

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

### User Accomplishes
Manage reference data for measurements

---

## Flow 8: Census Creation

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

### User Accomplishes
Start a new data collection period

---

## Flow 9: Feedback Submission

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

### User Accomplishes
Report issues directly to development team
