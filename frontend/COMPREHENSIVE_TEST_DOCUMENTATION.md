# ForestGEO Frontend Test Suite Documentation

## Table of Contents

1. [Overview](#overview)
2. [Test Architecture](#test-architecture)
3. [API Route Tests](#api-route-tests)
    - [Batch Processing](#batch-processing)
    - [CRUD Operations](#crud-operations)
    - [Data Retrieval](#data-retrieval)
    - [File Management](#file-management)
    - [Validation and Processing](#validation-and-processing)
    - [System Management](#system-management)
4. [Configuration Tests](#configuration-tests)
5. [Mock Infrastructure Tests](#mock-infrastructure-tests)
6. [Testing Patterns and Methodologies](#testing-patterns-and-methodologies)
7. [Coverage Summary](#coverage-summary)

---

## Overview

The ForestGEO frontend test suite comprises 29 comprehensive unit test files that validate the entire API layer,
configuration systems, and mocking infrastructure of the forest inventory management system. The test suite uses *
*Vitest** as the testing framework and implements sophisticated mocking strategies to ensure isolated, reliable testing
of complex database-dependent operations.

### Key Statistics

- **Total Test Files**: 29
- **API Route Tests**: 24
- **Configuration Tests**: 1
- **Mock Infrastructure Tests**: 4
- **Testing Framework**: Vitest
- **Coverage Areas**: Database operations, file handling, validation, authentication, business logic

---

## Test Architecture

### Core Testing Principles

The ForestGEO test suite follows several key architectural principles:

**@description** Comprehensive mocking strategy that isolates units under test
**@pattern** Consistent test structure with setup, execution, and assertion phases
**@methodology** FIFO queue systems for database response mocking
**@approach** Transaction-aware testing with rollback verification

### Mocking Infrastructure

#### Database Mocking

```typescript
/**
 * @description Database connection manager mocking with singleton preservation
 * @pattern Wraps existing ConnectionManager while guaranteeing getInstance() availability
 * @features Transaction management, query execution, connection lifecycle
 */
vi.mock('@/config/connectionmanager', async () => {
  // Preserves test setup singleton while providing mock capabilities
  const actual = await vi.importActual<any>('@/config/connectionmanager');
  // ... implementation details
});
```

#### Platform Mocking

```typescript
/**
 * @description Next.js platform services mocking (cookies, headers)
 * @pattern Shared state management across async function calls
 * @features Cookie manipulation, header access, server action integration
 */
```

#### Authentication Mocking

```typescript
/**
 * @description NextAuth.js authentication flow mocking
 * @pattern Provider configuration capture and session callback testing
 * @features Entra ID integration, user roles, site permissions
 */
```

---

## API Route Tests

### Batch Processing

#### `/app/api/batchedupload/[schema]/[[...slugs]]/route.test.ts`

**@description** Tests bulk upload functionality for failed measurement corrections
**@scope** Validates batch insertion of measurement data with parameter validation
**@coverage** Request validation, database operations, error handling, transaction management

**Test Cases:**

- **@test** `400s when requirements are missing: empty body`
    - **@validates** Empty request body rejection
    - **@expects** HTTP 400 with "Missing requirements" message
- **@test** `400s when schema is missing/empty`
    - **@validates** Schema parameter validation
    - **@expects** HTTP 400 for empty/undefined schema
- **@test** `400s when slugs is not exactly length 2`
    - **@validates** URL parameter count validation
    - **@expects** HTTP 400 when plotID/censusID count incorrect
- **@test** `400s when plotID or censusID are not numbers`
    - **@validates** Numeric parameter validation
    - **@expects** HTTP 400 for non-numeric plot/census IDs
- **@test** `200s and calls executeQuery on success`
    - **@validates** Successful batch insertion workflow
    - **@expects** HTTP 200, database execution, parameter mapping
    - **@verifies** ID field exclusion, plotID/censusID addition
- **@test** `500s and logs on DB error`
    - **@validates** Database error handling
    - **@expects** HTTP 500, error logging, meaningful error response

**Key Testing Patterns:**

- **@pattern** Mock-based database interaction testing
- **@pattern** Parameter validation edge case coverage
- **@pattern** Error propagation and logging verification

#### `/app/api/bulkcrud/route.test.ts`

**@description** Comprehensive testing of bulk CRUD operations for forest measurement data
**@scope** Validates two execution paths: measurementssummary (stored procedures) and generic (row-by-row processing)
**@coverage** Transaction management, error handling, parameter validation, database connection lifecycle

**Test Cases:**

- **@test** `400 when dataType or plot or census missing`
    - **@validates** Required parameter presence validation
    - **@expects** HTTP 400 with "No dataType or SLUGS provided" message
- **@test** `400 when rows missing`
    - **@validates** Request body data validation
    - **@expects** HTTP 400 with "No rows provided" message
- **@test** `measurementssummary path: inserts temp rows, calls proc, commits, and closes`
    - **@validates** Complete measurementssummary workflow
    - **@expects** Transaction initiation, bulk insertion, stored procedure execution, commit, connection cleanup
    - **@verifies** Correct parameter passing, SQL query construction
- **@test** `generic path: calls insertOrUpdate per row, commits, and closes`
    - **@validates** Row-by-row processing for non-measurement data
    - **@expects** Individual row processing, transaction management, parameter validation
- **@test** `on error: rolls back with the transaction id, returns 500, and closes`
    - **@validates** Error handling and transaction rollback behavior
    - **@expects** Proper rollback with transaction ID, HTTP 500, connection cleanup
    - **@critical** Essential for data integrity in production environments

**Architecture Features:**

- **@feature** Dual processing paths based on data type
- **@feature** Transaction-aware error recovery
- **@feature** Connection lifecycle management
- **@feature** Stored procedure integration for performance

### CRUD Operations

#### `/app/api/catalog/[firstName]/[lastName]/route.test.ts`

**@description** User catalog lookup functionality testing
**@scope** Validates user existence checks by first and last name
**@coverage** Parameter validation, database queries, error handling, connection management

**Test Cases:**

- **@test** `throws if firstName or lastName missing (pre-try/catch)`
    - **@validates** Required parameter validation before processing
    - **@expects** Thrown error for missing name parameters
- **@test** `200 when user exists and returns the UserID`
    - **@validates** Successful user lookup workflow
    - **@expects** HTTP 200, correct SQL query construction, UserID return
    - **@verifies** Parameter binding, connection closure
- **@test** `500 and logs when user not found`
    - **@validates** No-results scenario handling
    - **@expects** HTTP 500, error logging with endpoint metadata
- **@test** `500 and logs when DB error occurs`
    - **@validates** Database error propagation and logging
    - **@expects** HTTP 500, error logging, connection cleanup

**SQL Query Validation:**

```sql
-- @query Generated SQL pattern
SELECT UserID FROM catalog.users
WHERE FirstName = ? AND LastName = ?
```

### Data Retrieval

#### `/app/api/fetchall/[[...slugs]]/route.test.ts`

**@description** Comprehensive data retrieval system with cookie-based context management
**@scope** Validates multiple data types (stems, trees, plots, personnel, census) with mapping and filtering
**@coverage** Cookie integration, data mapping, SQL generation, error handling

**Test Cases:**

- **@test** `throws when schema missing/undefined`
    - **@validates** Schema requirement validation
    - **@expects** Error for missing/undefined schema parameters
- **@test** `throws when slugs are missing/incomplete`
    - **@validates** URL parameter structure validation
    - **@expects** Error for insufficient slug parameters
- **@test** `stems: uses stored plotID/census from cookies and returns mapped results`
    - **@validates** Cookie-based parameter retrieval and data mapping
    - **@expects** HTTP 200, cookie parameter usage, data transformation
    - **@verifies** SQL construction with JOIN operations
- **@test** `trees: mirrors stems path and mapping`
    - **@validates** Tree data retrieval with similar architecture
    - **@expects** Consistent behavior with stems endpoint
- **@test** `plots: selects plots with quadrat count; maps results; closes connection`
    - **@validates** Plot data with aggregated quadrat information
    - **@expects** GROUP BY query construction, aggregate field mapping
- **@test** `personnel: passes stored PCN/plotID as params; maps results`
    - **@validates** Personnel data retrieval with context parameters
    - **@expects** Parameter passing from stored context
- **@test** `census: runs UPDATE then SELECT by stored PlotID; maps results`
    - **@validates** Two-phase census data processing
    - **@expects** UPDATE followed by SELECT operations
- **@test** `default branch: generic SELECT * FROM schema.table; maps results`
    - **@validates** Fallback generic table access
    - **@expects** Simple table query with mapping
- **@test** `on DB error: logs via ailogger.error and throws "Call failed"`
    - **@validates** Error handling with logging integration
    - **@expects** Error logging, connection cleanup, proper error propagation

**Data Mapping Architecture:**

- **@feature** MapperFactory integration for consistent data transformation
- **@feature** Cookie-based context parameter management
- **@feature** Type-specific SQL query generation
- **@feature** Comprehensive error handling with cleanup

#### `/app/api/changelog/overview/[changelogType]/[[...options]]/route.test.ts`

**@description** Change tracking and audit log retrieval system
**@scope** Validates changelog data retrieval with multiple changelog types and filtering
**@coverage** Parameter validation, data mapping, SQL generation, error handling

**Test Cases:**

- **@test** `throws if schema missing`
    - **@validates** Schema parameter requirement
    - **@expects** Error for missing schema in query parameters
- **@test** `throws if changelogType missing`
    - **@validates** Changelog type parameter validation
    - **@expects** Error for undefined changelog type
- **@test** `throws if options missing`
    - **@validates** Options parameter requirement
    - **@expects** Error for missing options array
- **@test** `throws if options length !== 2`
    - **@validates** Options array length validation
    - **@expects** Error for incorrect options count
- **@test** `unifiedchangelog: 200 with mapped results; builds expected SQL; closes connection`
    - **@validates** Unified changelog query construction and execution
    - **@expects** HTTP 200, proper SQL with WHERE clauses, ORDER BY DESC, LIMIT
    - **@verifies** Parameter binding, mapper usage, connection cleanup
- **@test** `unifiedchangelog: 200 with empty body when no rows; mapper not called`
    - **@validates** No-results scenario handling
    - **@expects** HTTP 200 with empty response, skipped mapping
- **@test** `validationchangelog: 200 with mapped results; uses correct table`
    - **@validates** Validation-specific changelog table access
    - **@expects** Different table reference, consistent parameter handling
- **@test** `propagates SQL errors (rejects) and still closes connection`
    - **@validates** Error propagation with resource cleanup
    - **@expects** Error propagation, guaranteed connection closure

**SQL Patterns:**

```sql
-- @query Unified changelog pattern
SELECT * FROM {schema}.unifiedchangelog
WHERE (PlotID = ? OR PlotID IS NULL)
  AND (PlotID = ? OR PlotID IS NULL)
  AND (CensusID = ? OR CensusID IS NULL)
ORDER BY ChangeTimestamp DESC
LIMIT 5;

-- @query Validation changelog pattern
SELECT * FROM {schema}.validationchangelog
ORDER BY RunDateTime DESC
LIMIT 5;
```

### File Management

#### `/app/api/filehandlers/deletefile/route.test.ts`

**@description** Azure Blob Storage file deletion functionality
**@scope** Validates file deletion with container and filename validation
**@coverage** Parameter validation, Azure integration, error handling

**Test Cases:**

- **@test** `400 when container or filename is missing`
    - **@validates** Required parameter validation
    - **@expects** HTTP 400 for missing container or filename
- **@test** `400 when getContainerClient returns falsy`
    - **@validates** Container client creation validation
    - **@expects** HTTP 400 when container client creation fails
    - **@verifies** Container name lowercasing
- **@test** `200 on success: deletes blob and returns success text`
    - **@validates** Successful file deletion workflow
    - **@expects** HTTP 200, blob client creation, deletion execution
    - **@verifies** Container name normalization, proper API calls
- **@test** `500 when blob deletion throws and logs error`
    - **@validates** Error handling with logging
    - **@expects** HTTP 500, error logging, meaningful error response

#### `/app/api/filehandlers/downloadallfiles/route.test.ts`

**@description** Bulk file listing and metadata retrieval from Azure Blob Storage
**@scope** Validates file listing with metadata mapping and error handling
**@coverage** Container operations, blob enumeration, metadata processing

**Test Cases:**

- **@test** `400 when plot or census is missing`
    - **@validates** Required parameter validation
    - **@expects** HTTP 400 for missing plot/census parameters
- **@test** `400 when container client cannot be created`
    - **@validates** Container client creation error handling
    - **@expects** HTTP 400 with specific error message
- **@test** `200 on success: lists blobs, maps fields, warns once`
    - **@validates** Successful blob listing and metadata mapping
    - **@expects** HTTP 200, blob enumeration, field transformation
    - **@verifies** Container naming convention, metadata parsing, logging
- **@test** `400 when listBlobsFlat iteration throws; logs error with endpoint`
    - **@validates** Blob enumeration error handling
    - **@expects** HTTP 400, error logging with endpoint context

**Metadata Mapping:**

```typescript
// @interface File metadata transformation
{
  key: number,           // 1-indexed sequence
  name: string,          // original filename
  user: string,          // from metadata.user
  formType: string,      // from metadata.FormType
  fileErrors: any[] | '', // parsed JSON or empty string
  date: string           // from properties.lastModified
}
```

#### `/app/api/filehandlers/downloadfile/route.test.ts`

**@description** Individual file download with SAS token generation
**@scope** Validates secure file download URL generation with Azure SAS tokens
**@coverage** SAS token generation, credential validation, URL construction

**Test Cases:**

- **@test** `400 when container, filename, or connection string missing`
    - **@validates** Required parameter and environment validation
    - **@expects** HTTP 400 for missing required configuration
- **@test** `400 when container client cannot be created`
    - **@validates** Container client creation validation
    - **@expects** HTTP 400 with specific error message
- **@test** `200 on success with SAS token`
    - **@validates** Successful SAS token generation and URL construction
    - **@expects** HTTP 200, SAS token creation, URL formatting
    - **@verifies** Credential type validation, permission parsing
- **@test** `200 when credential is NOT StorageSharedKeyCredential (empty SAS)`
    - **@validates** Alternative credential handling
    - **@expects** HTTP 200 with empty SAS token
- **@test** `500 when any error is thrown and logs via ailogger.error`
    - **@validates** Comprehensive error handling
    - **@expects** HTTP 500, error logging, meaningful error response

#### `/app/api/filehandlers/storageload/route.test.ts`

**@description** File upload to Azure Blob Storage with metadata and error tracking
**@scope** Validates file upload with form data processing and error metadata
**@coverage** Form data validation, file upload, metadata attachment, error handling

**Test Cases:**

- **@test** `400 when formData is missing/empty`
    - **@validates** Form data requirement validation
    - **@expects** HTTP 400 for missing or empty form data
- **@test** `400 when required query params are missing`
    - **@validates** Query parameter validation
    - **@expects** HTTP 400 for missing user/formType parameters
- **@test** `500 when getContainerClient throws; logs via ailogger`
    - **@validates** Container client error handling
    - **@expects** HTTP 500, error logging, meaningful error response
- **@test** `500 when container client is falsy`
    - **@validates** Container client validation
    - **@expects** HTTP 500 with specific error message
- **@test** `500 when upload returns non-2xx status`
    - **@validates** Upload response status validation
    - **@expects** HTTP 500 for failed upload operations
- **@test** `500 when upload throws; logs error`
    - **@validates** Upload exception handling
    - **@expects** HTTP 500, error logging, error propagation
- **@test** `200 on success; uses lower-cased container name and passes args to upload`
    - **@validates** Successful upload workflow
    - **@expects** HTTP 200, container name normalization, proper parameter passing
    - **@verifies** File metadata handling, error data parsing

**Upload Parameters:**

```typescript
// @interface Upload function parameters
uploadValidFileAsBuffer(
  containerClient: ContainerClient,
  file: File,
  user: string,
  formType: string,
  fileRowErrors: any[]
)
```

### Validation and Processing

#### `/app/api/formvalidation/[dataType]/[[...slugs]]/route.test.ts`

**@description** Data validation system for form field uniqueness checking
**@scope** Validates field value uniqueness across different data types
**@coverage** Parameter validation, SQL query construction, existence checking

**Test Cases:**

- **@test** `throws if slugs missing or length !== 3`
    - **@validates** URL parameter structure validation
    - **@expects** Error for incorrect slug count
- **@test** `throws if dataType missing or "undefined"`
    - **@validates** Data type parameter validation
    - **@expects** Error for missing/undefined data type
- **@test** `returns 404 when any of schema/columnName/value is falsy`
    - **@validates** Required field validation
    - **@expects** HTTP 404 for empty string parameters
- **@test** `404 when query returns no rows; closes connection; formats SQL with ?? and ?`
    - **@validates** No-match scenario handling
    - **@expects** HTTP 404, connection cleanup, proper SQL formatting
    - **@verifies** Parameterized query construction
- **@test** `200 when at least one row exists; closes connection`
    - **@validates** Successful validation workflow
    - **@expects** HTTP 200 for existing field values
- **@test** `propagates DB errors and still closes connection`
    - **@validates** Error handling with resource cleanup
    - **@expects** Error propagation, guaranteed connection closure

**SQL Pattern:**

```sql
-- @query Validation query pattern
SELECT 1 FROM ?? WHERE ?? = ? LIMIT 1
-- Parameters: [schema.table, columnName, value]
```

#### `/app/api/cmprevalidation/[dataType]/[[...slugs]]/route.test.ts`

**@description** Comprehensive pre-validation system for data import operations
**@scope** Validates data presence across multiple entity types before processing
**@coverage** Multi-table validation, parameter validation, business rule checking

**Test Cases:**

- **@test** `throws when slugs or dataType missing`
    - **@validates** Required parameter validation
    - **@expects** Error for missing slugs or data type
- **@test** `throws when incorrect slugs (length not 3 or "undefined" values)`
    - **@validates** Parameter structure and content validation
    - **@expects** Error for malformed slug parameters
- **@test** `attributes: 200 when table has rows; 428 when empty; closes connection`
    - **@validates** Attributes table validation workflow
    - **@expects** HTTP 200/428 based on data presence, connection cleanup
- **@test** `species: mirrors attributes behavior`
    - **@validates** Species table validation with consistent behavior
    - **@expects** Same validation pattern as attributes
- **@test** `personnel: 200 when table has rows; 428 when empty`
    - **@validates** Personnel table validation
    - **@expects** Consistent validation behavior across entity types
- **@test** `quadrats: uses PlotID in WHERE; 200 when rows; 428 when none`
    - **@validates** Plot-specific quadrat validation
    - **@expects** PlotID filtering in query construction
- **@test** `postvalidation: builds expected JOIN/Census filter`
    - **@validates** Complex multi-table validation with joins
    - **@expects** JOIN query construction with census filtering
- **@test** `default (unknown dataType): returns 428 and closes connection (no DB call)`
    - **@validates** Unknown data type handling
    - **@expects** HTTP 428 without database interaction
- **@test** `on DB error: logs via ailogger.error and returns 428`
    - **@validates** Database error handling with logging
    - **@expects** HTTP 428, error logging, connection cleanup

**Validation Queries by Type:**

```sql
-- @query Attributes/Species validation
SELECT 1 FROM {schema}.{dataType} dt LIMIT 1;

-- @query Personnel validation
SELECT 1 FROM {schema}.personnel p LIMIT 1;

-- @query Quadrats validation
SELECT 1 FROM {schema}.quadrats q WHERE q.PlotID = {plotID} LIMIT 1;

-- @query Post-validation complex join
SELECT 1 FROM {schema}.coremeasurements cm
JOIN {schema}.census c ON c.CensusID = cm.CensusID
JOIN {schema}.plots p ON p.PlotID = c.PlotID
WHERE p.PlotID = ? AND c.CensusID IN (
  SELECT CensusID FROM {schema}.census
  WHERE PlotID = ? AND PlotCensusNumber = ?
) LIMIT 1;
```

#### `/app/api/postvalidation/route.test.ts`

**@description** Post-processing validation query management system
**@scope** Validates enabled validation queries retrieval and execution management
**@coverage** Query validation, status filtering, result mapping

**Test Cases:**

- **@test** `throws if schema is missing`
    - **@validates** Schema parameter requirement validation
    - **@expects** Error for missing schema parameter
- **@test** `404 when no queries found; closes connection`
    - **@validates** No-results scenario handling
    - **@expects** HTTP 404 with "No queries found" message, connection cleanup
- **@test** `200 with mapped results; closes connection`
    - **@validates** Successful query retrieval and mapping
    - **@expects** HTTP 200, field mapping transformation, connection cleanup
- **@test** `propagates DB errors and still closes connection`
    - **@validates** Error handling with resource cleanup
    - **@expects** Error propagation, guaranteed connection closure

**Query and Mapping:**

```sql
-- @query Post-validation queries retrieval
SELECT QueryID, QueryName, Description
FROM {schema}.postvalidationqueries
WHERE IsEnabled IS TRUE;
```

```typescript
// @interface Result mapping
{
  queryID: number,        // from QueryID
  queryName: string,      // from QueryName
  queryDescription: string // from Description
}
```

#### `/app/api/postvalidationbyquery/[schema]/[plotID]/[censusID]/[queryID]/route.test.ts`

**@description** Individual validation query execution with result tracking
**@scope** Validates dynamic query execution with parameter substitution and result logging
**@coverage** Query templating, parameter substitution, transaction management, result tracking

**Test Cases:**

- **@test** `400 when any param is missing/falsy`
    - **@validates** Required parameter validation including zero values
    - **@expects** HTTP 400 for missing/falsy parameters
- **@test** `404 when QueryID not found; closes connection`
    - **@validates** Query existence validation
    - **@expects** HTTP 404, connection cleanup for non-existent queries
- **@test** `200 on success: replaces variables, runs update with timestamp+result, commits, closes`
    - **@validates** Complete query execution workflow
    - **@expects** Template variable substitution, execution, result logging, transaction commit
    - **@verifies** Variable replacement: ${schema}, ${currentPlotID}, ${currentCensusID}
- **@test** `200 when query returns empty → marks 'failure', updates status, rolls back`
    - **@validates** Empty result handling as failure condition
    - **@expects** Failure status update, transaction rollback, timestamp logging
- **@test** `500 on unexpected error; rolls back and closes`
    - **@validates** Error handling with transaction management
    - **@expects** HTTP 500, transaction rollback, connection cleanup

**Template Variables:**

```typescript
// @interface Query template substitution
{
  '${schema}': schemaParam,
  '${currentPlotID}': plotIDParam,
  '${currentCensusID}': censusIDParam
}
```

**Result Tracking:**

```sql
-- @query Success update
UPDATE {schema}.postvalidationqueries
SET LastRunAt = ?, LastRunResult = ?, LastRunStatus = 'success'
WHERE QueryID = ?;

-- @query Failure update
UPDATE {schema}.postvalidationqueries
SET LastRunAt = ?, LastRunStatus = 'failure'
WHERE QueryID = ?;
```

### System Management

#### `/app/api/clearallcookies/route.test.ts`

**@description** System cookie management for session cleanup
**@scope** Validates comprehensive cookie deletion with ordered processing
**@coverage** Cookie management, error propagation, logging integration

**Test Cases:**

- **@test** `deletes all expected cookies in order and returns 200 with { cleared: true }`
    - **@validates** Complete cookie deletion workflow
    - **@expects** HTTP 200, ordered cookie deletion, success response
    - **@verifies** Cookie deletion order: censusID, plotID, schema, quadratID, user, censusList
- **@test** `propagates an error if a cookie deletion fails`
    - **@validates** Error propagation without try/catch
    - **@expects** Error propagation, partial deletion completion

**Cookie Deletion Order:**

```typescript
// @sequence Cookie deletion order
['censusID', 'plotID', 'schema', 'quadratID', 'user', 'censusList'];
```

#### `/app/api/clearcensus/route.test.ts`

**@description** Census data clearing system with transaction management
**@scope** Validates census data removal with stored procedure integration
**@coverage** Parameter validation, stored procedure execution, transaction management

**Test Cases:**

- **@test** `503 when schema or censusID is missing`
    - **@validates** Required parameter validation
    - **@expects** HTTP 503 for missing required parameters
- **@test** `200 on success: begins tx, calls proc, commits`
    - **@validates** Successful census clearing workflow
    - **@expects** Transaction initiation, stored procedure execution, commit
    - **@verifies** Procedure naming convention: clearcensus{type}
- **@test** `503 on DB error: rolls back with transaction id and returns error text`
    - **@validates** Error handling with transaction rollback
    - **@expects** HTTP 503, transaction rollback with ID, error propagation
- **@test** `builds stored procedure name using 'type' param (smoke check)`
    - **@validates** Dynamic procedure name construction
    - **@expects** Correct procedure naming based on type parameter

**Stored Procedure Pattern:**

```sql
-- @query Procedure naming convention
CALL {schema}.clearcensus{type}(?);
-- Examples: clearcensusview, clearcensusall, clearcensuscustom
```

#### `/app/api/refreshviews/[view]/[schema]/route.test.ts`

**@description** Database view refresh system for maintaining derived data
**@scope** Validates view refresh operations with transaction management
**@coverage** View management, stored procedure execution, transaction handling

**Test Cases:**

- **@test** `throws if schema or view is missing/undefined`
    - **@validates** Required parameter validation including "undefined" strings
    - **@expects** Error for missing/undefined parameters
- **@test** `viewfulltable: calls RefreshViewFullTable(), commits, and closes`
    - **@validates** Full table view refresh workflow
    - **@expects** Specific stored procedure execution, transaction commit
- **@test** `measurementssummary: calls RefreshMeasurementsSummary(), commits, and closes`
    - **@validates** Measurements summary view refresh
    - **@expects** Measurements-specific procedure execution
- **@test** `unknown view: calls Refresh() (empty suffix), commits, and closes`
    - **@validates** Default view refresh handling
    - **@expects** Generic refresh procedure execution
- **@test** `on error: rolls back with the transaction id and closes`
    - **@validates** Error handling with transaction management
    - **@expects** Transaction rollback with ID, connection cleanup

**View Refresh Procedures:**

```sql
-- @query View-specific procedures
CALL {schema}.RefreshViewFullTable();      -- viewfulltable
CALL {schema}.RefreshMeasurementsSummary(); -- measurementssummary
CALL {schema}.Refresh();                    -- default/unknown
```

### Data Processing

#### `/app/api/reingest/[schema]/[plotID]/[censusID]/route.test.ts`

**@description** Failed measurement re-ingestion system with batch processing
**@scope** Validates failed measurement recovery through temporary table processing
**@coverage** Batch operations, stored procedure integration, transaction management

**Test Cases:**

- **@test** `throws if any of schema/plotID/censusID missing`
    - **@validates** Required parameter validation
    - **@expects** Error for missing core parameters
- **@test** `happy path: truncates temp, shifts rows, deletes failed, calls proc`
    - **@validates** Complete re-ingestion workflow
    - **@expects** Four-step process: truncate, insert, delete, procedure call
    - **@verifies** Transaction commit, response structure
- **@test** `on error: rolls back with transaction id and returns 500 JSON { error }`
    - **@validates** Error handling with transaction rollback
    - **@expects** HTTP 500, transaction rollback with ID, error response

**Re-ingestion Workflow:**

```sql
-- @sequence Re-ingestion process
1. TRUNCATE {schema}.temporarymeasurements;
2. INSERT IGNORE INTO {schema}.temporarymeasurements
   SELECT ... FROM {schema}.failedmeasurements
   WHERE PlotID = ? AND CensusID = ?;
3. DELETE FROM {schema}.failedmeasurements
   WHERE PlotID = ? AND CensusID = ?;
4. CALL {schema}.bulkingestionprocess(?, ?);
```

#### `/app/api/reingestsinglefailure/[schema]/[targetRowID]/route.test.ts`

**@description** Individual failed measurement re-processing system
**@scope** Validates single row recovery with error review integration
**@coverage** Single row operations, error handling, review procedures

**Test Cases:**

- **@test** `throws if core parameters not provided`
    - **@validates** Parameter requirement validation
    - **@expects** Error for missing schema/targetRowID
- **@test** `happy path: moves single failed row, clears it, ingests`
    - **@validates** Single row re-ingestion workflow
    - **@expects** Three-step process: insert, delete, procedure call
    - **@verifies** Transaction commit, success response
- **@test** `on error: rolls back with transaction id, calls reviewfailed(), and rethrows`
    - **@validates** Error handling with review procedure
    - **@expects** Transaction rollback, review procedure call, error propagation

**Single Row Workflow:**

```sql
-- @sequence Single row re-ingestion
1. INSERT INTO {schema}.temporarymeasurements
   SELECT ... FROM {schema}.failedmeasurements
   WHERE FailedMeasurementID = ?;
2. DELETE FROM {schema}.failedmeasurements
   WHERE FailedMeasurementID = ?;
3. CALL {schema}.bulkingestionprocess(?, ?);
-- On error: CALL {schema}.reviewfailed();
```

#### `/app/api/formatrunquery/route.test.ts`

**@description** Dynamic SQL query formatting and execution system
**@scope** Validates parameterized query execution with mysql2 integration
**@coverage** Query formatting, parameter binding, result handling

**Test Cases:**

- **@test** `formats the query with params, executes it, and returns 200 with JSON`
    - **@validates** Complete query formatting and execution workflow
    - **@expects** HTTP 200, JSON response, parameter formatting
    - **@verifies** mysql2.format integration, query execution
- **@test** `works when params are omitted (undefined) and still formats deterministically`
    - **@validates** Optional parameter handling
    - **@expects** Deterministic formatting with empty parameter array
- **@test** `propagates DB errors (rejects) when executeQuery fails`
    - **@validates** Database error propagation
    - **@expects** Error propagation without modification

**Query Formatting:**

```typescript
// @interface Query formatting
mysql2.format(query: string, params?: any[]) => string
// Used for parameterized query construction with proper escaping
```

### Dashboard and Metrics

#### `/app/api/dashboardmetrics/[metric]/[schema]/[plotIDParam]/[censusIDParam]/route.test.ts`

**@description** Dashboard metrics calculation and file management system
**@scope** Validates metric calculations and Azure blob file listing
**@coverage** Metric queries, file enumeration, aggregation operations

**Test Cases:**

- **@test** `throws when missing core slugs (including plot search param)`
    - **@validates** Required parameter validation including query parameters
    - **@expects** Error for missing metric/schema/plotID/plot parameters
- **@test** `CountActiveUsers: returns 200 and proper JSON; builds expected SQL + params`
    - **@validates** Active users metric calculation
    - **@expects** HTTP 200, JOIN query construction, parameter binding
- **@test** `ProgressTachometer: returns expected aggregate fields and 200`
    - **@validates** Progress metrics with aggregation
    - **@expects** Aggregate field mapping, percentage calculations
- **@test** `FilesUploaded: lists blobs, maps metadata, returns 200`
    - **@validates** File listing and metadata processing
    - **@expects** Blob enumeration, metadata parsing, field transformation
- **@test** `CountTrees: 200 and proper JSON; SQL + params sanity`
    - **@validates** Tree counting metric
    - **@expects** JOIN query with census filtering
- **@test** `CountStems: 200 and proper JSON; SQL + params sanity`
    - **@validates** Stem counting metric
    - **@expects** Similar pattern to tree counting
- **@test** `unknown metric: returns 200 with empty object`
    - **@validates** Unknown metric handling
    - **@expects** HTTP 200 with empty response
- **@test** `on DB error: returns 400 (INVALID_REQUEST)`
    - **@validates** Database error handling
    - **@expects** HTTP 400 with empty response

**Metric Calculations:**

```sql
-- @query CountActiveUsers
SELECT COUNT(DISTINCT p.PersonnelID) as PersonnelCount
FROM {schema}.personnel p
JOIN {schema}.censusactivepersonnel cap ON p.PersonnelID = cap.PersonnelID
JOIN {schema}.census c ON cap.CensusID = c.CensusID
WHERE c.CensusID = ? AND c.PlotID = ?;

-- @query ProgressTachometer (complex aggregation)
WITH measured_quads AS (
  SELECT DISTINCT q.QuadratID
  FROM {schema}.quadrats q
  JOIN {schema}.trees t ON q.QuadratID = t.QuadratID
  WHERE t.CensusID = ?
)
SELECT
  COUNT(q.QuadratID) as total_quadrats,
  COUNT(mq.QuadratID) as populated_quadrats,
  ROUND(COUNT(mq.QuadratID) * 100.0 / COUNT(q.QuadratID), 1) as populated_pct,
  GROUP_CONCAT(CASE WHEN mq.QuadratID IS NULL THEN q.QuadratName END SEPARATOR ';') as unpopulated_quadrats
FROM {schema}.quadrats q
LEFT JOIN measured_quads mq ON q.QuadratID = mq.QuadratID
WHERE q.PlotID = ?;
```

#### `/app/api/details/cmid/route.test.ts`

**@description** Core measurement detail retrieval system
**@scope** Validates detailed measurement data retrieval with field mapping
**@coverage** Parameter validation, data retrieval, field transformation

**Test Cases:**

- **@test** `throws when schema is missing`
    - **@validates** Schema parameter requirement
    - **@expects** Error for missing schema parameter
- **@test** `200 with mapped results; builds expected SQL + params; closes connection`
    - **@validates** Successful detail retrieval workflow
    - **@expects** HTTP 200, field mapping, parameter binding, connection cleanup
- **@test** `propagates SQL errors (rejects) and still closes connection`
    - **@validates** Error handling with resource cleanup
    - **@expects** Error propagation, guaranteed connection closure

**Field Mapping:**

```typescript
// @interface Core measurement detail mapping
{
  coreMeasurementID: number,    // from CoreMeasurementID
  plotName: string,             // from PlotName
  quadratName: string,          // from QuadratName
  plotCensusNumber: number,     // from PlotCensusNumber
  speciesName: string           // from SpeciesName
  // StartDate and EndDate excluded from mapping
}
```

### Advanced Data Operations

#### `/app/api/fixeddata/[dataType]/[[...slugs]]/route.test.ts`

**@description** Paginated data retrieval system with specialized processing
**@scope** Validates paginated queries with data type-specific transformations
**@coverage** Pagination, data mapping, SQL generation, field parsing

**Test Cases:**

- **@test** `throws if slugs are missing or fewer than 5`
    - **@validates** Slug count validation
    - **@expects** Error for insufficient parameters
- **@test** `throws if core slugs schema/page/pageSize are not valid`
    - **@validates** Core parameter validation
    - **@expects** Error for invalid schema/page/pageSize values
- **@test** `unifiedchangelog: 200 with mapped data, totalCount, finishedQuery`
    - **@validates** Unified changelog with pagination
    - **@expects** HTTP 200, data mapping, total count, formatted query response
- **@test** `stems: parses UserDefinedFields before mapping`
    - **@validates** JSON field parsing for stem data
    - **@expects** UserDefinedFields JSON parsing and treestemstate extraction
- **@test** `personnel: finishedQuery param order is correct`
    - **@validates** Parameter ordering in personnel queries
    - **@expects** Correct parameter sequence in formatted query
- **@test** `throws for unknown dataType`
    - **@validates** Data type validation
    - **@expects** Error for unsupported data types
- **@test** `propagates DB errors and closes connection`
    - **@validates** Error handling with cleanup
    - **@expects** Error propagation, connection closure

**Pagination Pattern:**

```sql
-- @query Base pagination pattern
SELECT SQL_CALC_FOUND_ROWS * FROM {schema}.{table}
WHERE {conditions}
LIMIT {offset}, {pageSize};

-- Followed by:
SELECT FOUND_ROWS() as totalRows;
```

**UserDefinedFields Processing:**

```typescript
// @interface Stems UserDefinedFields parsing
{
  // Input: JSON string or object
  UserDefinedFields: string | object;
  // Output: extracted treestemstate field
  UserDefinedFields: any; // treestemstate value
}
```

#### `/app/api/fixeddatafilter/[dataType]/[[...slugs]]/route.test.ts`

**@description** Advanced filtering system with search and filter integration
**@scope** Validates complex filtering with delegation and specialized processing
**@coverage** Filter processing, search integration, delegation patterns, specialized data handling

**Test Cases:**

- **@test** `delegates to SINGLEPOST if body.newRow is truthy`
    - **@validates** Request delegation pattern
    - **@expects** Forward to single post handler for new row creation
- **@test** `throws if slugs missing or fewer than 5`
    - **@validates** Parameter structure validation
    - **@expects** Error for insufficient slug parameters
- **@test** `throws if core slugs schema/page/pageSize invalid`
    - **@validates** Core parameter validation
    - **@expects** Error for invalid core parameters
- **@test** `sitespecificvalidations: builds WHERE with search+filter, paginates, maps rows`
    - **@validates** Site-specific validation filtering
    - **@expects** Search/filter integration, pagination, mapping, transaction management
- **@test** `measurementssummaryview: respects visible + tss filters`
    - **@validates** Measurement summary with visibility and tree stem state filters
    - **@expects** Complex WHERE clauses for validation status and JSON field filtering
- **@test** `coremeasurements: when multiple census IDs, returns deprecated filtered subset`
    - **@validates** Core measurements with deprecation logic
    - **@expects** Deprecated row identification, complex census filtering
- **@test** `rolls back and rethrows if a DB error occurs during query`
    - **@validates** Error handling with transaction rollback
    - **@expects** Transaction rollback, error propagation, connection cleanup

**Filter Integration:**

```typescript
// @interface Filter model structure
{
  items: Array<{field: string, operator: string, value: any}>,
  quickFilterValues: string[],
  visible: string[],      // for validation status filtering
  tss: string[]          // for tree stem state filtering
}
```

**Complex Filtering Examples:**

```sql
-- @query Measurement summary with visibility filters
WHERE (IsValidated = TRUE OR IsValidated IS NULL) -- visible: ['valid', 'pending']
  AND (JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('alive'), '$.treestemstate') = 1
       OR JSON_CONTAINS(UserDefinedFields, JSON_QUOTE('dead'), '$.treestemstate') = 1)

-- @query Core measurements deprecation logic
-- Returns deprecated rows that match output key combinations
-- Key: PlotID + QuadratID + TreeID + StemID
```

#### `/app/api/formdownload/[dataType]/[[...slugs]]/route.test.ts`

**@description** Form data download system with filtering and field mapping
**@scope** Validates data export with search/filter integration and specialized field handling
**@coverage** Data export, field mapping, search integration, join operations

**Test Cases:**

- **@test** `throws if data type or slugs not provided`
    - **@validates** Required parameter validation
    - **@expects** Error for missing data type or slugs
- **@test** `throws if schema missing`
    - **@validates** Schema parameter validation
    - **@expects** Error for missing schema parameter
- **@test** `attributes: 200 with mapped rows; uses search+filter stubs`
    - **@validates** Attributes export with filtering
    - **@expects** HTTP 200, search/filter integration, data mapping
- **@test** `personnel: 200 and maps expected fields; applies stubs`
    - **@validates** Personnel export with role joins
    - **@expects** JOIN with roles table, field transformation
- **@test** `species: 200 and maps expected fields; applies stubs`
    - **@validates** Species export with taxonomic joins
    - **@expects** JOIN with genus table, comprehensive field mapping
- **@test** `quadrats: 200 and maps expected fields; applies stubs`
    - **@validates** Quadrat export with spatial data
    - **@expects** Spatial field transformation
- **@test** `measurements: 200, maps expected fields; respects visible/tss/search/filter`
    - **@validates** Measurement export with complex filtering
    - **@expects** Validation status filtering, tree stem state filtering, comprehensive joins
- **@test** `propagates errors thrown during columns discovery`
    - **@validates** Column discovery error handling
    - **@expects** Error propagation during metadata operations

**Field Mapping Examples:**

```typescript
// @interface Personnel field mapping
{
  firstname: string,      // from FirstName
  lastname: string,       // from LastName
  role: string,          // from RoleName
  roledescription: string // from RoleDescription
}

// @interface Species field mapping
{
  spcode: string,            // from SpeciesCode
  family: string,            // from Family
  genus: string,             // from Genus
  species: string,           // from SpeciesName
  subspecies: string | null, // from SubspeciesName
  idlevel: number,           // from IDLevel
  authority: string,         // from SpeciesAuthority
  subspeciesauthority: string | null // from SubspeciesAuthority
}

// @interface Measurements field mapping
{
  stemID: number,        // from StemID
  treeID: number,        // from TreeID
  tag: string,           // from TreeTag
  stemtag: string,       // from StemTag
  spcode: string,        // from SpeciesCode
  quadrat: string,       // from QuadratName
  lx: number,            // from StartX
  ly: number,            // from StartY
  dbh: number,           // from MeasuredDBH
  hom: number,           // from MeasuredHOM
  date: string,          // from MeasurementDate
  codes: string,         // from Codes
  errors: string         // from Errors
}
```

**Complex Join Patterns:**

```sql
-- @query Personnel with roles
SELECT p.FirstName, p.LastName, r.RoleName, r.RoleDescription
FROM {schema}.personnel p
JOIN {schema}.roles r ON p.RoleID = r.RoleID
WHERE ({search} OR {filter});

-- @query Species with genus
SELECT sp.SpeciesCode, f.Family, g.Genus, sp.SpeciesName,
       sp.SubspeciesName, sp.IDLevel, sp.SpeciesAuthority, sp.SubspeciesAuthority
FROM {schema}.species sp
LEFT JOIN {schema}.genus g ON sp.GenusID = g.GenusID
LEFT JOIN {schema}.family f ON g.FamilyID = f.FamilyID
WHERE ({search} OR {filter});

-- @query Measurements with comprehensive joins
SELECT s.StemID, t.TreeID, t.Tag as TreeTag, s.StemTag,
       sp.SpeciesCode, q.QuadratName, q.StartX, q.StartY,
       cm.MeasuredDBH, cm.MeasuredHOM, cm.MeasurementDate,
       cm.Codes, cm.Errors
FROM {schema}.coremeasurements cm
JOIN {schema}.stems s ON cm.StemID = s.StemID
JOIN {schema}.trees t ON s.TreeID = t.TreeID
JOIN {schema}.species sp ON t.SpeciesID = sp.SpeciesID
JOIN {schema}.quadrats q ON t.QuadratID = q.QuadratID
WHERE cm.CensusID = ? AND q.PlotID = ?
  AND ({validation_filters})
  AND ({tree_stem_state_filters})
  AND ({search} OR {filter});
```

---

## Configuration Tests

### `/config/macros.test.ts`

**@description** Application constants and HTTP response code validation
**@scope** Validates HTTPResponses enum defining standard and custom status codes
**@coverage** HTTP status codes, application constants, error code definitions

**Test Cases:**

- **@test** `should define correct HTTP status codes`
    - **@validates** Standard HTTP status code definitions
    - **@expects** Correct mapping for 200, 201, 400, 409, 500, 503
- **@test** `should define custom status codes`
    - **@validates** Application-specific error codes
    - **@expects** Custom codes: 408 (SQL_CONNECTION_FAILURE), 412 (PRECONDITION_VALIDATION_FAILURE), 555 (
      FOREIGN_KEY_CONFLICT)
- **@test** `should handle NOT_FOUND status`
    - **@validates** NOT_FOUND enumeration existence
    - **@expects** Defined NOT_FOUND status for resource lookup failures

**HTTP Response Codes:**

```typescript
// @enum HTTPResponses standard codes
((OK = 200),
  (CREATED = 201),
  (INVALID_REQUEST = 400),
  (NOT_FOUND = 404),
  (CONFLICT = 409),
  (INTERNAL_SERVER_ERROR = 500),
  (SERVICE_UNAVAILABLE = 503),
  // @enum HTTPResponses custom codes
  (SQL_CONNECTION_FAILURE = 408),
  (PRECONDITION_VALIDATION_FAILURE = 412),
  (FOREIGN_KEY_CONFLICT = 555));
```

---

## Mock Infrastructure Tests

### Authentication Mocking (`/testing/mockstesting/auth-mocks.test.ts`)

**@description** NextAuth.js authentication system mocking for testing
**@scope** Validates authentication flow mocking with provider configuration and session management
**@coverage** Provider setup, session callbacks, poll URL integration, error handling

**Test Cases:**

- **@test** `initializes with Entra provider and calls poll URL in session callback`
    - **@validates** Authentication system initialization and configuration
    - **@expects** Entra ID provider setup, session callback execution, poll URL interaction
    - **@verifies** User data retrieval, roles assignment, site permissions
- **@test** `propagates failures from poll URL during session retrieval`
    - **@validates** Error handling in authentication flow
    - **@expects** Error propagation from downstream services
- **@test** `handles signin POST`
    - **@validates** Sign-in request processing
    - **@expects** Proper request handling with callback URL

**Authentication Features:**

```typescript
// @interface Authentication configuration
{
  providers: ['microsoft-entra-id'],
  session: {
    user: { id: string, email: string },
    roles: string[],
    userStatus: string,
    allowedSites: Array<{siteName: string, siteID: number, locationName: string}>,
    allSites: Array<{siteName: string, siteID: number, locationName: string}>
  }
}
```

### Background Mocking (`/testing/mockstesting/bg-mocks.test.ts`)

**@description** Background service and database connection mocking infrastructure
**@scope** Validates ConnectionManager mocking with FIFO queue system and processor stubs
**@coverage** Database operation mocking, result queuing, error simulation, processor stubs

**Test Cases:**

- **@test** `captures SQL + params and returns queued results (FIFO)`
    - **@validates** SQL execution tracking and result queue management
    - **@expects** FIFO result delivery, SQL/parameter capture
- **@test** `returns a sensible default shape when no result is queued`
    - **@validates** Default response handling
    - **@expects** MySQL2-compatible response structure
- **@test** `propagates queued errors`
    - **@validates** Error simulation and propagation
    - **@expects** Queued error delivery, call tracking
- **@test** `queues are per-process (shared across instances) and resettable`
    - **@validates** Queue state management
    - **@expects** Shared state across instances, reset capability
- **@test** `stubs processors used by fileMappings`
    - **@validates** File processor stubbing
    - **@expects** Personnel, species, census processor stubs
- **@test** `stubs react-dropzone runtime imports`
    - **@validates** React component dependency mocking
    - **@expects** Dropzone API stubbing, file rejection handling
- **@test** `mocks logger + chalk`
    - **@validates** Logging infrastructure mocking
    - **@expects** Logger method stubs, chalk color function passthrough
- **@test** `provides safe environment defaults`
    - **@validates** Environment variable setup
    - **@expects** Database connection environment variables

### Database Mocking (`/testing/mockstesting/db-mocks.test.ts`)

**@description** Comprehensive database mocking infrastructure for unit testing
**@scope** Validates PoolMonitor singleton behavior and MySQL2 query/execute method mocking
**@coverage** Connection pooling, query execution, error simulation, transaction handling

**Test Cases:**

- **@test** `returns a singleton PoolMonitor and provides a shared connection`
    - **@validates** Singleton pattern implementation
    - **@expects** Same instance across calls, shared connection objects
- **@test** `query FIFO: returns queued results, then default echo`
    - **@validates** Query result queue management
    - **@expects** FIFO result delivery, fallback to echo response
- **@test** `execute FIFO: returns queued results, then default echo`
    - **@validates** Execute method queue management
    - **@expects** Similar behavior to query with separate queue
- **@test** `propagates queued errors for query/execute`
    - **@validates** Error simulation for both query methods
    - **@expects** Proper error propagation from queues
- **@test** `supports ping() and release() with release listeners`
    - **@validates** Connection lifecycle management
    - **@expects** Ping functionality, release event handling
- **@test** `PoolMonitor closeAllConnections / isPoolClosed toggles state`
    - **@validates** Pool state management
    - **@expects** Pool closure state tracking
- **@test** `mysql2/promise.createPool is mocked and delegates to shared connection`
    - **@validates** MySQL2 library mocking
    - **@expects** Pool creation mocking, connection delegation
- **@test** `chalk + logger are mocked quietly`
    - **@validates** Supporting library mocking
    - **@expects** Quiet operation without console output
- **@test** `env defaults are present for DB configuration`
    - **@validates** Environment setup for testing
    - **@expects** Required database environment variables

**Database Mock Architecture:**

```typescript
// @interface Mock database connection
{
  query: (sql: string, params?: any[]) => Promise<[any, any]>,
  execute: (sql: string, params?: any[]) => Promise<[any, any]>,
  ping: () => Promise<void>,
  release: () => void,
  on: (event: string, callback: Function) => void
}

// @interface Mock result queues
{
  pushQueryResult: (result: any) => void,
  pushExecuteResult: (result: any) => void,
  pushQueryError: (error: Error) => void,
  pushExecuteError: (error: Error) => void,
  clearDbQueues: () => void
}
```

### Platform Mocking (`/testing/mockstesting/platform-mocks.test.ts`)

**@description** Next.js platform services mocking for server-side functionality
**@scope** Validates cookies and headers mocking with shared state management
**@coverage** Cookie manipulation, header access, server action integration, RDS definition stubs

**Test Cases:**

- **@test** `cookies(): returns an awaitable bag with get/set/delete/getAll`
    - **@validates** Cookie API mocking functionality
    - **@expects** Complete cookie manipulation API, shared state
- **@test** `cookies(): separate awaits share the same underlying jar`
    - **@validates** Shared state across async calls
    - **@expects** Consistent cookie state across multiple awaits
- **@test** `headers(): returns a Map-like object (stubbed)`
    - **@validates** Headers API mocking
    - **@expects** Map-like interface for header access
- **@test** `RDS definition modules are stubbed and importable`
    - **@validates** SQL definition module stubs
    - **@expects** Successful import of all RDS definition modules
- **@test** `chalk + logger are mocked quietly`
    - **@validates** Supporting library mocking
    - **@expects** Quiet operation for logging utilities
- **@test** `integrates with server action cookiemanager via mocked cookies()`
    - **@validates** Integration with actual server action code
    - **@expects** Cookie manager functionality through mocked cookies API

**Platform Mock Features:**

```typescript
// @interface Cookie mock API
{
  get: (name: string) => {value: string} | undefined,
  set: (name: string, value: string) => void,
  delete: (name: string) => void,
  getAll: () => Array<{name: string, value: string}>
}

// @interface RDS definition stubs
[
  '@/config/sqlrdsdefinitions/taxonomies',
  '@/config/sqlrdsdefinitions/zones',
  '@/config/sqlrdsdefinitions/views',
  '@/config/sqlrdsdefinitions/validations',
  '@/config/sqlrdsdefinitions/timekeeping',
  '@/config/sqlrdsdefinitions/personnel',
  '@/config/sqlrdsdefinitions/core',
  '@/config/sqlrdsdefinitions/admin'
]
```

---

## Testing Patterns and Methodologies

### Consistent Test Structure

All test files follow a consistent structural pattern:

```typescript
/**
 * @pattern Standard test file structure
 */

// 1. Imports and mock setup (hoisted)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 2. Hoisted mock spies (if needed)
const { mockSpy } = vi.hoisted(() => ({
  mockSpy: vi.fn()
}));

// 3. Mock declarations (before route imports)
vi.mock('@/some/module', () => ({
  // Mock implementation
}));

// 4. Route import (after mocks)
import { GET, POST } from './route';

// 5. Helper functions
function makeRequest(params: any) {
  /* ... */
}
function makeProps(params: any) {
  /* ... */
}

// 6. Test suite
describe('Route Description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test description', async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

### Mock Strategy Patterns

#### 1. ConnectionManager Mocking

**@pattern** Singleton preservation with mock capabilities

```typescript
vi.mock('@/config/connectionmanager', async () => {
  // Preserve existing test setup singleton
  const actual = await vi.importActual<any>('@/config/connectionmanager');

  // Find or create instance
  const candidate = /* singleton discovery logic */;
  const instance = candidate || /* default mock */;

  // Ensure getInstance() availability
  const getInstance = vi.fn(() => instance);

  return {
    ...actual,
    default: { getInstance },
    getInstance
  };
});
```

#### 2. FIFO Queue Systems

**@pattern** Predictable response ordering for database operations

```typescript
// Queue setup
__pushQueryResult(result1);
__pushQueryResult(result2);

// Usage - results returned in order
const result1 = await connection.query('SQL1');
const result2 = await connection.query('SQL2');
// result1 === queued result1, result2 === queued result2
```

#### 3. Error Simulation

**@pattern** Controlled error injection for testing error paths

```typescript
// Error queue setup
__pushQueryError(new Error('Simulated DB failure'));

// Error propagation testing
await expect(connection.query('SQL')).rejects.toThrow('Simulated DB failure');
```

#### 4. Transaction Testing

**@pattern** Transaction lifecycle validation

```typescript
const begin = vi.spyOn(cm, 'beginTransaction').mockResolvedValue('tx-id');
const commit = vi.spyOn(cm, 'commitTransaction');
const rollback = vi.spyOn(cm, 'rollbackTransaction');

// Test success path
expect(begin).toHaveBeenCalledTimes(1);
expect(commit).toHaveBeenCalledWith('tx-id');
expect(rollback).not.toHaveBeenCalled();

// Test error path
expect(rollback).toHaveBeenCalledWith('tx-id');
expect(commit).not.toHaveBeenCalled();
```

### Data Validation Patterns

#### 1. Parameter Validation Testing

**@pattern** Comprehensive input validation coverage

```typescript
// Missing parameter tests
it('throws when required params missing', async () => {
  await expect(handler(makeRequest(undefined))).rejects.toThrow(/missing/i);
});

// Invalid parameter tests
it('400 when params invalid', async () => {
  const res = await handler(makeRequest('invalid'));
  expect(res.status).toBe(400);
});

// Edge case tests
it('handles edge case values', async () => {
  // Test empty strings, zero values, null, undefined
});
```

#### 2. SQL Query Validation

**@pattern** Query construction and parameter binding verification

```typescript
// Mock deterministic SQL formatting
vi.mock('mysql2/promise', () => ({
  format: (sql: string, params: any[]) => `FORMATTED:${sql}::PARAMS:${JSON.stringify(params)}`
}));

// Verify query construction
const [sql, params] = executeQuery.mock.calls[0];
expect(sql).toMatch(/SELECT .* FROM table WHERE id = \?/);
expect(params).toEqual([expectedId]);
```

#### 3. Response Mapping Validation

**@pattern** Data transformation verification

```typescript
// Input data
const dbResult = [
  {
    ColumnName: 'value',
    AnotherColumn: 'data'
  }
];

// Expected output after mapping
const expectedOutput = [
  {
    columnName: 'value', // camelCase transformation
    anotherColumn: 'data' // field mapping
  }
];

expect(actualOutput).toEqual(expectedOutput);
```

### Error Handling Patterns

#### 1. Error Propagation Testing

**@pattern** Verify errors bubble up correctly

```typescript
it('propagates DB errors', async () => {
  executeQuery.mockRejectedValue(new Error('DB failure'));

  await expect(handler(request)).rejects.toThrow('DB failure');

  // Verify cleanup still occurs
  expect(closeConnection).toHaveBeenCalled();
});
```

#### 2. Resource Cleanup Verification

**@pattern** Ensure resources are cleaned up in all paths

```typescript
it('always closes connection', async () => {
  // Test success path
  await handler(successRequest);
  expect(closeConnection).toHaveBeenCalledTimes(1);

  // Test error path
  executeQuery.mockRejectedValue(new Error('failure'));
  await expect(handler(errorRequest)).rejects.toThrow();
  expect(closeConnection).toHaveBeenCalledTimes(2);
});
```

#### 3. Transaction Rollback Testing

**@pattern** Verify proper transaction management

```typescript
it('rolls back on error with transaction ID', async () => {
  const txId = 'tx-123';
  beginTransaction.mockResolvedValue(txId);
  executeQuery.mockRejectedValue(new Error('failure'));

  await expect(handler(request)).rejects.toThrow();
  expect(rollbackTransaction).toHaveBeenCalledWith(txId);
});
```

### Integration Testing Patterns

#### 1. End-to-End Workflow Testing

**@pattern** Complete user journey validation

```typescript
it('complete workflow: validation -> processing -> storage -> response', async () => {
  // Setup: mock all dependencies
  // Execute: run complete workflow
  // Verify: each step was called correctly
  // Assert: final state is correct
});
```

#### 2. Mock Integration Verification

**@pattern** Verify mocks work with actual code

```typescript
it('integrates with server actions via mocked dependencies', async () => {
  // Use actual server action code
  const actual = await vi.importActual('@/app/actions/someaction');

  // Verify it works with mocked dependencies
  await actual.someFunction();

  // Assert mock interactions
  expect(mockDependency).toHaveBeenCalled();
});
```

---

## Coverage Summary

### API Route Coverage

**@summary** 24 API route test files providing comprehensive coverage of:

- **Batch Processing**: Upload validation, parameter checking, database integration
- **CRUD Operations**: User lookup, catalog management, data retrieval
- **File Management**: Azure Blob Storage integration, upload/download/delete operations
- **Validation Systems**: Pre/post validation, field uniqueness checking, business rules
- **Data Processing**: Pagination, filtering, mapping, specialized transformations
- **System Management**: Cookie management, cache clearing, view refresh operations
- **Metrics and Reporting**: Dashboard calculations, progress tracking, file enumeration

### Error Handling Coverage

**@coverage** Comprehensive error scenarios including:

- **Parameter Validation**: Missing, invalid, malformed parameters
- **Database Errors**: Connection failures, query errors, transaction failures
- **Resource Management**: Connection cleanup, transaction rollback
- **External Service Failures**: Azure Storage errors, authentication failures
- **Business Logic Errors**: Validation failures, constraint violations

### Testing Infrastructure Coverage

**@infrastructure** 4 specialized test files covering:

- **Database Mocking**: PoolMonitor, MySQL2, query/execute operations
- **Authentication Mocking**: NextAuth.js, providers, session management
- **Platform Mocking**: Next.js cookies/headers, server actions
- **Background Service Mocking**: ConnectionManager, processors, utilities

### Mock Quality Features

**@quality** High-quality mocking with:

- **Singleton Preservation**: Maintains existing test setup state
- **FIFO Queue Systems**: Predictable response ordering
- **Error Simulation**: Controlled error injection
- **Resource Tracking**: Connection lifecycle management
- **State Management**: Shared state across async operations
- **Integration Support**: Works with actual application code

### Business Logic Coverage

**@business** Complete forest inventory system coverage:

- **Data Import/Export**: File processing, validation, transformation
- **Measurement Management**: Tree/stem measurements, validation, correction
- **Personnel Management**: User roles, permissions, activity tracking
- **Plot Management**: Spatial data, quadrat organization, census tracking
- **Validation Systems**: Data quality, business rules, error correction
- **Reporting**: Metrics calculation, progress tracking, audit trails

### Performance and Reliability

**@performance** Test suite designed for:

- **Fast Execution**: Mocked dependencies eliminate external calls
- **Reliable Results**: Deterministic mocking prevents flaky tests
- **Isolated Testing**: Each test runs independently
- **Comprehensive Coverage**: Both success and failure paths tested
- **Transaction Safety**: Proper rollback testing ensures data integrity

---

## Conclusion

The ForestGEO frontend test suite represents a comprehensive, well-architected testing system that provides thorough
coverage of a complex forest inventory management application. The test suite demonstrates advanced testing practices
including sophisticated mocking strategies, transaction-aware testing, and comprehensive error scenario coverage.

**Key Strengths:**

- **Comprehensive Coverage**: 29 test files covering all major system components
- **Advanced Mocking**: Sophisticated mocking infrastructure preserving singleton patterns
- **Error Handling**: Extensive error scenario testing with proper resource cleanup
- **Business Logic**: Complete forest inventory workflow validation
- **Integration Testing**: Mock infrastructure that works with actual application code

**Technical Excellence:**

- **Consistent Patterns**: Standardized testing approaches across all files
- **Resource Management**: Proper connection lifecycle and transaction testing
- **Data Integrity**: Transaction rollback verification ensures data safety
- **Performance**: Fast, reliable tests through comprehensive mocking

This test suite serves as an excellent example of enterprise-level testing practices for complex database-driven
applications, providing both comprehensive coverage and maintainable test infrastructure.
