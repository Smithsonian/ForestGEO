# System Errors

This guide covers technical errors related to database connections, server issues, and system-level problems.

---

## Database Connection Errors

### Connection Failures

| Error Message                                         | Cause                         | How to Fix                                                    |
| ----------------------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| "Unable to acquire connection"                        | Database server unreachable   | Wait a moment and retry; if persistent, contact administrator |
| "SQL Connection Failure" (HTTP 408)                   | Database connection timed out | Retry the operation; server may be overloaded                 |
| "Connection lost immediately after transaction start" | Unstable connection           | Retry; if persistent, contact administrator                   |

### Transaction Errors

| Error Message                                   | Cause                          | How to Fix                                     |
| ----------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| "No connection found for transaction"           | Transaction reference lost     | Retry the operation from the beginning         |
| "Failed to start transaction after 30 seconds"  | Persistent database deadlock   | Wait and retry; report if it continues         |
| "Transaction slot wait timeout"                 | Too many concurrent operations | Wait for other operations to complete          |
| "Failed to start transaction after [N] retries" | Database under heavy load      | Wait and retry later                           |
| "Transaction timed out after [N]ms"             | Operation took too long        | Contact administrator if processing large data |

### Lock and Deadlock Errors

| Error Message                            | Cause                                  | How to Fix                                                     |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| "Deadlock found when trying to get lock" | Concurrent operations conflicting      | System will auto-retry; if persistent, wait and retry manually |
| "Failed to acquire resource lock"        | Resource busy                          | Wait for other operations to complete                          |
| "Dependency wait timeout"                | Waiting too long for related operation | Retry the operation                                            |

---

## Server Errors

### HTTP Error Codes

| Code    | Name                  | Meaning                          | User Action                                   |
| ------- | --------------------- | -------------------------------- | --------------------------------------------- |
| **400** | Bad Request           | Invalid parameters sent          | Check your input; fix data format issues      |
| **401** | Unauthorized          | Not logged in or session expired | Log in again                                  |
| **404** | Not Found             | Requested resource doesn't exist | Check if data was deleted or wrong parameters |
| **405** | Method Not Allowed    | Invalid operation type           | Report to administrator                       |
| **408** | Timeout               | Request took too long            | Wait and retry                                |
| **409** | Conflict              | Data conflict (duplicate, etc.)  | Resolve the conflict and retry                |
| **412** | Precondition Failed   | Validation requirements not met  | Check validation errors                       |
| **500** | Internal Server Error | Server-side error                | Wait and retry; report if persistent          |
| **503** | Service Unavailable   | Server overloaded or maintenance | Wait and try again later                      |
| **555** | Foreign Key Conflict  | Trying to delete referenced data | Remove references first (see below)           |

### Server Error Messages

| Error Message           | Cause                      | How to Fix                                       |
| ----------------------- | -------------------------- | ------------------------------------------------ |
| "Internal Server Error" | Unspecified server problem | Retry; report with error details if persistent   |
| "Service Unavailable"   | Server temporarily down    | Wait and retry later                             |
| "Something went wrong"  | Generic error              | Note any error ID shown; report to administrator |

---

## Data Operation Errors

### Insert/Update Errors

| Error Message                           | Cause                   | How to Fix                                     |
| --------------------------------------- | ----------------------- | ---------------------------------------------- |
| "Insertion Command Failed"              | Cannot add new record   | Check data format and required fields          |
| "Update Command Failed"                 | Cannot modify record    | Verify record exists and data is valid         |
| "Delete Command Failed"                 | Cannot remove record    | Record may be referenced by other data         |
| "Unique Key Already Exists"             | Duplicate data detected | Use different values or update existing record |
| "No data provided for upsert operation" | Empty data submitted    | Provide data to save                           |
| "No rows provided for bulk upsert"      | Empty batch operation   | Include at least one row of data               |

### Foreign Key Errors

| Error Message                  | Cause                                  | How to Fix                                 |
| ------------------------------ | -------------------------------------- | ------------------------------------------ |
| "Row is referenced" (HTTP 555) | Cannot delete - data is used elsewhere | Remove or update referencing data first    |
| "Foreign Key Conflict"         | Related data prevents operation        | See "Handling Foreign Key Conflicts" below |

#### Handling Foreign Key Conflicts

When you see a foreign key error:

1. **Identify what's referencing the data** - The error message often includes the constraint name
2. **Decide how to handle it:**
   - Update referencing records to use different values
   - Delete referencing records first (if appropriate)
   - Keep the record instead of deleting it
3. **Example:** Deleting a species that has measurements
   - Cannot delete species while measurements reference it
   - Either reassign measurements or keep the species

### Query Errors

| Error Message                                        | Cause                           | How to Fix                                         |
| ---------------------------------------------------- | ------------------------------- | -------------------------------------------------- |
| "Query exceeds MySQL max_allowed_packet size"        | Data too large for single query | Contact administrator; may need to split operation |
| "Mismatch between query placeholders and parameters" | Programming error               | Report to administrator                            |
| "SQL Error"                                          | Database query failed           | Note error details and report                      |

---

## Upload Processing Errors

### Concurrency Errors

| Error Message                                            | Cause                                    | How to Fix                        |
| -------------------------------------------------------- | ---------------------------------------- | --------------------------------- |
| "Another upload is in progress for Plot [X], Census [Y]" | Someone else is uploading to same census | Wait for other upload to complete |
| "Failed to acquire application lock"                     | System busy with another operation       | Wait a moment and retry           |
| "Queue processing stalled"                               | Processing pipeline stuck                | Contact administrator             |

### Processing Pipeline Errors

| Error Message                    | Cause                                | How to Fix                   |
| -------------------------------- | ------------------------------------ | ---------------------------- |
| "Failed to setup bulk processor" | Cannot initialize processing         | Retry; report if persistent  |
| "Collapser failed"               | Final data merge failed              | Contact administrator        |
| "Batch processing failed"        | Specific batch couldn't be processed | Check data for issues; retry |

---

## Network Errors

### Timeout Errors

| Error Message                 | Cause                         | How to Fix                       |
| ----------------------------- | ----------------------------- | -------------------------------- |
| "Request timeout after [N]ms" | Server didn't respond in time | Check internet connection; retry |
| "Network request failed"      | Connection interrupted        | Check internet; retry operation  |

**Timeout Guidelines:**

- Default operation timeout: 60 seconds
- Large uploads may take several minutes
- Don't close browser during long operations

### Tips for Network Issues

1. **Check your internet connection** - Try accessing other websites
2. **Wait and retry** - Temporary network issues often resolve
3. **Don't close the browser** - Operations may still be processing
4. **Try a wired connection** - WiFi can be unstable for large uploads
5. **Contact IT support** - If network problems persist

---

## Application Errors

### Context Errors

| Error Message              | Cause                               | How to Fix                                 |
| -------------------------- | ----------------------------------- | ------------------------------------------ |
| "Missing required context" | No site/plot/census selected        | Select site, plot, and census from sidebar |
| "Site must be selected"    | Operation requires site selection   | Select a site first                        |
| "Census not selected"      | Operation requires census selection | Select a census first                      |

### UI Errors

| Error Message              | Cause                         | How to Fix                                                |
| -------------------------- | ----------------------------- | --------------------------------------------------------- |
| "Failed to toggle sidebar" | UI state error                | Refresh the page                                          |
| "Export failed"            | Cannot generate download file | Retry; check for popup blockers                           |
| "Action cancelled by user" | You cancelled the operation   | This is not an error - operation was stopped as requested |

---

## Error Recovery

### General Recovery Steps

1. **Note the error message** - Copy or screenshot the exact text
2. **Note the error ID** - If shown (e.g., "Error ID: abc123")
3. **Retry the operation** - Many errors are temporary
4. **Refresh the page** - Clears stale state
5. **Log out and back in** - Resets your session
6. **Try a different browser** - Rules out browser-specific issues
7. **Contact administrator** - If none of the above works

### When to Contact Administrator

Contact your administrator if:

- Error persists after multiple retries
- You see the same error repeatedly
- Error prevents you from doing essential work
- You see "Critical" or "Fatal" in the error message
- Data appears to be lost or corrupted

### Information to Provide

When reporting an error, include:

1. **Error message** - Exact text
2. **Error ID** - If displayed
3. **What you were doing** - Step by step
4. **When it happened** - Date and time
5. **Browser and device** - Chrome, Firefox, etc.
6. **Screenshots** - If possible

---

## System Status

### Checking System Health

Signs the system is working normally:

- Pages load quickly
- Operations complete without errors
- Progress bars show movement
- Data updates appear as expected

Signs the system may be under stress:

- Slow page loads
- Frequent timeouts
- Multiple users reporting issues
- Progress bars stuck for long periods

### Maintenance Windows

The system may be unavailable during scheduled maintenance. Contact your administrator for the maintenance schedule.

---

## FAQ: System Errors

### Q: I keep seeing timeout errors. What should I do?

**A:** Wait a few minutes and retry. If it persists, the server may be overloaded or there may be network issues. Try again later or contact administrator.

### Q: Is my data safe when I see an error?

**A:** In most cases, yes. The system is designed to not lose data even during errors. Completed operations are saved; interrupted operations can be retried.

### Q: What does "Error ID" mean?

**A:** It's a unique identifier for your specific error instance. Providing this to administrators helps them find detailed logs to diagnose the issue.

### Q: Why does the same operation sometimes work and sometimes fail?

**A:** This often indicates temporary issues like network problems, server load, or database contention. Retrying usually succeeds.

### Q: Can I continue working if I see an error?

**A:** Usually yes. Errors are typically isolated to specific operations. You can often navigate away and continue other work while waiting to retry.
