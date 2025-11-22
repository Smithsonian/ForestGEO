---
title: Documentation Framework Overview
description: Overview of the comprehensive documentation structure for the ForestGEO Application.
---

This document outlines the comprehensive documentation structure for the ForestGEO Application. Use this as a roadmap for documentation development.

---

## 1. Core Systems Identified

The ForestGEO Application consists of the following major systems:

### 1.1 Authentication & User Management

- NextAuth-based authentication with OAuth providers
- Role-based access control (Admin, Site User, Viewer)
- Multi-site user assignment
- Session management and route protection

### 1.2 Site/Plot/Census Context System

- Hierarchical data organization: Site > Plot > Census
- Context-aware navigation (sidebar selectors)
- Global state management via React Context
- Data filtering based on active selections

### 1.3 Dashboard & Metrics System

- Real-time census progress visualization
- Stem statistics (old stems, multi-stems, new recruits)
- Data validity status monitoring
- Recent changelog display
- Active user tracking

### 1.4 Data Upload System (8-Stage Pipeline)

- File upload with drag-and-drop interface
- CSV/TSV parsing with auto-delimiter detection
- Header validation and mapping
- Sequential batch processing (32KB chunks)
- Pre-ingestion validation
- Database insertion via stored procedures
- Azure Blob Storage backup
- Error recovery and reingestion workflows

### 1.5 Validation System

- 12+ configurable validation rules
- Pre-ingestion format checks
- Post-ingestion data quality validation
- Error tracking and display
- Validation override capabilities
- Post-census statistical analysis

### 1.6 Fixed Data Management

- Species/Taxonomy management
- Personnel records (census-dependent)
- Quadrat definitions
- Stem Codes/Attributes
- CRUD operations via isolated datagrids

### 1.7 Measurements Data Management

- Core measurement records (DBH, HOM, dates)
- Multi-line bulk editing
- Single-row isolated editing
- Advanced filtering and sorting
- Historical data viewing
- Unified changelog/audit trail

### 1.8 Administrative System

- User management
- Site management
- User-to-site assignment
- Census creation and rollover
- Data clearing and reset functions

### 1.9 File Management

- Uploaded file history tracking
- Azure Blob Storage integration
- File download capabilities
- File metadata management

### 1.10 Error Handling & Recovery

- Failed measurements tracking
- Reingestion workflows
- Error display and correction
- Transaction rollback support

---

## 2. Process Flows Summary

### 2.1 Authentication Flow
- Login page with OAuth
- Session verification
- Dashboard redirect

### 2.2 Context Selection Flow
- Site selection
- Plot selection
- Census selection

### 2.3 Measurement Upload Flow (Primary)
- File selection and preview
- Database processing
- Validation
- Error review (conditional)
- Azure backup
- Completion and cache refresh

### 2.4 Failed Measurements Reingestion Flow
- Review failed records
- Clear/retry options
- Reprocess without re-upload

### 2.5 Fixed Data Entry Flows
- Quadrat management
- Personnel management
- Species/taxonomy management
- Stem codes/attributes management

---

## 3. Key Concepts for Non-Technical Users

### 3.1 Domain Terminology
- Site, Plot, Census, Quadrat
- Tree, Stem, Tree Tag, Stem Tag
- DBH (Diameter at Breast Height)
- HOM (Height of Measure)
- Species Code

### 3.2 Data Categories
- Fixed Data vs Measurement Data
- Census-dependent vs Census-independent data

### 3.3 Workflow Concepts
- Ingestion and reingestion
- Validation and post-validation
- Staging and processing

### 3.4 Data Relationships
- Site > Plot > Quadrat hierarchy
- Tree > Stem > Measurement hierarchy
- Census scoping

---

## 4. Documentation Structure

See [Documentation TOC Outline](/ForestGEO/framework/documentation-toc-outline/) for the proposed table of contents structure.
