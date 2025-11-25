# Documentation Table of Contents - Proposed Structure

This document outlines the recommended documentation structure for the ForestGEO Application user guide.

---

## Proposed TOC Hierarchy

```
ForestGEO Application Documentation
│
├── SECTION 1: Getting Started
│   ├── Welcome to ForestGEO
│   ├── System Requirements
│   ├── Logging In
│   ├── Understanding the Interface
│   │   ├── The Sidebar
│   │   ├── Site/Plot/Census Selection
│   │   └── Navigation Menu
│   └── Quick Start Checklist
│
├── SECTION 2: Core Concepts
│   ├── Glossary of Terms
│   ├── Understanding the Data Hierarchy
│   │   ├── Sites and Plots
│   │   ├── Censuses
│   │   ├── Quadrats
│   │   └── Trees and Stems
│   ├── Fixed Data vs Measurements
│   ├── Data Validation Explained
│   └── User Roles and Permissions
│
├── SECTION 3: Setting Up Your Census
│   ├── Pre-Census Checklist
│   ├── Creating a New Census
│   ├── Managing Stem Codes (Attributes)
│   ├── Managing Personnel
│   ├── Managing Quadrats
│   ├── Managing Species List
│   └── Census Rollover (Copying from Previous)
│
├── SECTION 4: Uploading Measurement Data
│   ├── Preparing Your Data File
│   │   ├── Required Columns
│   │   ├── File Format Requirements
│   │   └── Common Data Preparation Issues
│   ├── The Upload Process Step-by-Step
│   │   ├── Stage 1: File Selection
│   │   ├── Stage 2: File Parsing and Preview
│   │   ├── Stage 3: Database Processing
│   │   ├── Stage 4: Validation
│   │   ├── Stage 5: Error Review (if needed)
│   │   └── Stage 6: Completion
│   ├── Understanding Upload Errors
│   └── Re-uploading Corrected Data
│
├── SECTION 5: Data Validation
│   ├── What is Validation?
│   ├── Available Validation Rules
│   │   ├── Growth Validations
│   │   ├── Species Validations
│   │   ├── Location Validations
│   │   └── Duplicate Detection
│   ├── Reviewing Validation Errors
│   ├── Fixing Validation Errors
│   ├── Enabling/Disabling Validations
│   └── Creating Custom Validations
│
├── SECTION 6: Working with Your Data
│   ├── Viewing Measurement Data
│   │   ├── Using the Data Grid
│   │   ├── Filtering and Sorting
│   │   └── Understanding Column Types
│   ├── Editing Measurements
│   │   ├── Single-Row Editing
│   │   └── Bulk Editing
│   ├── Viewing Historical Data
│   ├── Tracking Changes (Audit Trail)
│   └── Managing Uploaded Files
│
├── SECTION 7: Failed Measurements
│   ├── What are Failed Measurements?
│   ├── Common Failure Reasons
│   ├── Reviewing Failed Records
│   ├── Fixing and Reingesting
│   └── Clearing Failed Measurements
│
├── SECTION 8: Post-Census Analysis
│   ├── Understanding Post-Validation Statistics
│   ├── Running Analysis Queries
│   └── Interpreting Results
│
├── SECTION 9: Administration (Admin Users Only)
│   ├── Managing Users
│   ├── Managing Sites
│   ├── Assigning Users to Sites
│   ├── Census Management
│   │   ├── Creating Censuses
│   │   ├── Editing Census Dates
│   │   └── Deleting Censuses
│   └── Data Reset and Clearing
│
├── SECTION 10: Troubleshooting
│   ├── Common Error Messages
│   ├── Upload Problems
│   ├── Validation Issues
│   ├── Login and Access Issues
│   └── Getting Help
│
└── APPENDICES
    ├── A: Complete Field Reference
    ├── B: Validation Rules Reference
    ├── C: File Format Templates
    └── D: Keyboard Shortcuts
```

---

## Section Details

### Section 1: Getting Started

**Purpose:** Help new users log in and understand the basic interface.
**Target Audience:** All users, first-time users
**Key Topics:**

- How to access the application
- Understanding the sidebar navigation
- Selecting your site, plot, and census
- Dashboard overview

### Section 2: Core Concepts

**Purpose:** Explain domain terminology and data organization.
**Target Audience:** All users, especially those new to ForestGEO
**Key Topics:**

- Glossary of forest research terms (DBH, HOM, etc.)
- How data is organized (Site > Plot > Census > Quadrat)
- Difference between fixed data and measurement data
- What validation means and why it matters

### Section 3: Setting Up Your Census

**Purpose:** Guide users through pre-census setup.
**Target Audience:** Data managers, field coordinators
**Key Topics:**

- What must be done BEFORE uploading measurements
- How to add/edit stem codes, personnel, quadrats, species
- Rolling over data from previous censuses

### Section 4: Uploading Measurement Data

**Purpose:** Walk through the complete upload process.
**Target Audience:** Data managers, field coordinators
**Key Topics:**

- File format requirements (CSV headers)
- Step-by-step upload walkthrough with screenshots
- What each upload stage does
- How to handle upload errors

### Section 5: Data Validation

**Purpose:** Explain the validation system.
**Target Audience:** Data managers, quality assurance staff
**Key Topics:**

- What each validation rule checks
- How to interpret validation errors
- How to fix common issues
- Managing validation rules

### Section 6: Working with Your Data

**Purpose:** Help users view and edit data.
**Target Audience:** All users
**Key Topics:**

- Using the data grid interface
- Filtering and searching
- Making edits to existing data
- Viewing change history

### Section 7: Failed Measurements

**Purpose:** Handle data that failed processing.
**Target Audience:** Data managers
**Key Topics:**

- Why measurements fail
- How to review and fix failures
- Reingestion process

### Section 8: Post-Census Analysis

**Purpose:** Explain post-validation statistics.
**Target Audience:** Researchers, data analysts
**Key Topics:**

- What post-census statistics are
- How to run and interpret them

### Section 9: Administration

**Purpose:** Admin-specific functions.
**Target Audience:** Administrators only
**Key Topics:**

- User management
- Site configuration
- Access control

### Section 10: Troubleshooting

**Purpose:** Help users solve common problems.
**Target Audience:** All users
**Key Topics:**

- Common error messages and solutions
- When to contact support

---

## Implementation Priority

**Phase 1 (High Priority):**

1. Core Concepts (Glossary, Data Hierarchy)
2. Uploading Measurement Data
3. Data Validation
4. Failed Measurements

**Phase 2 (Medium Priority):**

1. Setting Up Your Census
2. Working with Your Data
3. Troubleshooting

**Phase 3 (Lower Priority):**

1. Post-Census Analysis
2. Administration
3. Appendices
