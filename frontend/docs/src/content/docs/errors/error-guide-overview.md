---
title: Error Guide Overview
description: Comprehensive guide to errors in the ForestGEO Application with explanations and solutions.
---

This guide provides comprehensive information about errors you may encounter while using the ForestGEO Application, along with explanations and solutions.

---

## How to Use This Guide

1. **Identify the error type** - Is it an upload error, validation error, or system error?
2. **Find the error message** - Look for the exact message in the relevant section
3. **Follow the fix instructions** - Each error has specific steps to resolve it
4. **Contact support if needed** - Use the GitHub Feedback button for unresolved issues

:::tip
Most errors include an error message and sometimes an **Error ID**. Make note of both when troubleshooting or reporting issues.
:::

---

## Error Categories

### 1. Upload Errors

Errors that occur during the file upload and processing stages.

**See:** [Upload Errors](/ForestGEO/errors/upload-errors/)

- File parsing errors
- Server communication errors
- Batch processing errors
- Timeout errors

### 2. Validation Errors

Errors related to data quality checks and business rule validations.

**See:** [Validation Errors](/ForestGEO/errors/validation-errors/)

- Pre-ingestion validations (file format, required fields)
- Post-ingestion validations (growth limits, species checks)
- Cross-census validations (quadrat changes, coordinate drift)

### 3. Failed Measurements

Measurements that could not be processed into the database.

**See:** [Failed Measurements Guide](/ForestGEO/errors/failed-measurements-guide/)

- Common failure reasons
- How to review and fix failures
- Reingestion process

### 4. Authentication & Access Errors

Errors related to login and permissions.

**See:** [Authentication Errors](/ForestGEO/errors/authentication-errors/)

- Login failures
- Session expiration
- Permission denied errors

### 5. System & Connection Errors

Technical errors related to database and server issues.

**See:** [System Errors](/ForestGEO/errors/system-errors/)

- Database connection errors
- Transaction failures
- Server errors

---

## Quick Reference: Most Common Errors

| Error                             | Cause                       | Quick Fix                    |
| --------------------------------- | --------------------------- | ---------------------------- |
| "Species code not found"          | Species not in Species List | Add species before uploading |
| "Invalid quadrat name"            | Quadrat not defined         | Add quadrat in Fixed Data    |
| "Duplicate tree/stem combination" | Same tags recorded twice    | Remove duplicate from file   |
| "Missing required field"          | Empty required column       | Fill in the missing data     |
| "DBH growth exceeds maximum"      | Growth > 65mm               | Verify both measurements     |
| "Request timeout"                 | Network or server issue     | Wait and retry               |
| "Missing required context"        | No plot/census selected     | Select plot and census       |
| "Session expired"                 | Login timed out             | Log in again                 |
| "Unauthorized"                    | Insufficient permissions    | Contact administrator        |
| "Foreign key constraint"          | Referenced data missing     | Add referenced data first    |

---

## Error Severity Levels

| Severity     | Icon      | Meaning                  | Action Required              |
| ------------ | --------- | ------------------------ | ---------------------------- |
| **Critical** | 🔴 Red    | Data cannot be processed | Must fix before proceeding   |
| **Warning**  | 🟡 Yellow | Data flagged but saved   | Review and correct if needed |
| **Info**     | 🔵 Blue   | Informational only       | No action required           |

:::note
**Validation errors** are typically warnings - your data is saved but flagged for review. **Upload errors** are typically critical - the data was not saved.
:::

---

## Quick Troubleshooting Checklist

Before diving into specific error guides, try these steps:

- [ ] **Check your internet connection** - Ensure you have stable connectivity
- [ ] **Verify site/plot/census selection** - Many errors occur when the wrong context is selected
- [ ] **Refresh the page** - Clears stale state that may cause issues
- [ ] **Try the operation again** - Temporary issues often resolve on retry
- [ ] **Check your data file** - Most upload errors are caused by data formatting issues
- [ ] **Clear browser cache** - Can resolve caching-related issues
- [ ] **Try a different browser** - Rules out browser-specific problems
- [ ] **Contact administrator** - For permission or system-wide issues

---

## Understanding Error Messages

### Error Message Components

Most error messages include:

| Component         | Example                        | Purpose                       |
| ----------------- | ------------------------------ | ----------------------------- |
| **Error Type**    | "Validation Error"             | Categorizes the error         |
| **Error Message** | "Species code ABCDE not found" | Describes what went wrong     |
| **Error ID**      | "err-abc123"                   | Unique identifier for support |
| **Affected Data** | "Row 45, Column 'spcode'"      | Location of the problem       |

### Interpreting HTTP Error Codes

| Code | Name         | Meaning                | Action                               |
| ---- | ------------ | ---------------------- | ------------------------------------ |
| 400  | Bad Request  | Invalid data submitted | Check your input data                |
| 401  | Unauthorized | Not logged in          | Log in and retry                     |
| 403  | Forbidden    | No permission          | Contact administrator                |
| 404  | Not Found    | Resource doesn't exist | Check if data was deleted            |
| 408  | Timeout      | Request took too long  | Wait and retry                       |
| 409  | Conflict     | Data conflict          | Resolve duplicate/conflict           |
| 500  | Server Error | Internal error         | Wait and retry; report if persistent |
| 503  | Unavailable  | Server overloaded      | Wait and try later                   |

---

## Getting Help

If you encounter an error not covered in this guide:

### Self-Service Steps

1. **Check the error message carefully** - It often contains specific details about what went wrong
2. **Review your data file** - Most errors are caused by data formatting issues
3. **Try the operation again** - Some errors are temporary (network issues)
4. **Search this documentation** - Use the search feature to find related information

### Reporting Issues

When using the **Feedback button** (question mark icon), include:

1. **Exact error message** - Copy the full text
2. **Error ID** - If displayed
3. **What you were doing** - Step-by-step reproduction
4. **When it happened** - Date and approximate time
5. **Your browser** - Chrome, Firefox, Edge, etc.
6. **Screenshots** - If the error has visual components

### Contact Your Administrator

For issues they can help with:

- Permission changes
- Site/plot assignments
- Account activation
- System-wide problems

---

## FAQ: Common Questions About Errors

### Q: Is my data lost when I see an error?

**A:** Usually no. The system is designed to preserve data:

- Validation errors: Data is saved but flagged
- Upload errors: Data may not be saved - check Failed Measurements
- System errors: Completed operations are saved; interrupted ones can be retried

### Q: Why do I see different error messages for the same problem?

**A:** Error messages depend on where in the process the error occurs. A missing species code might show as "Species not found" during validation or "Foreign key constraint failed" at the database level.

### Q: Can I ignore warning-level errors?

**A:** Warnings indicate potential issues that should be reviewed. Your data is saved, but unaddressed warnings may cause problems later (e.g., inaccurate statistics, failed reports).

### Q: How long should I wait before retrying after a timeout?

**A:** Start with 30 seconds. If it fails again, wait 2-5 minutes. If persistent for more than 10 minutes, the server may be experiencing issues - contact support.

---

## Related Documentation

- [Glossary of Terms](/ForestGEO/framework/glossary-of-terms/) - Understanding terminology used in error messages
- [Upload Process Breakdown](/ForestGEO/upload-process-breakdown/) - Understanding the upload stages
- [Validations & Statistics](/ForestGEO/validations-statistics/) - Understanding validation rules
