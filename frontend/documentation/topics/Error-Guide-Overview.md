# Error Guide Overview

This guide provides comprehensive information about errors you may encounter while using the ForestGEO Application, along with explanations and solutions.

---

## How to Use This Guide

1. **Identify the error type** - Is it an upload error, validation error, or system error?
2. **Find the error message** - Look for the exact message in the relevant section
3. **Follow the fix instructions** - Each error has specific steps to resolve it
4. **Contact support if needed** - Use the GitHub Feedback button for unresolved issues

---

## Error Categories

### 1. Upload Errors

Errors that occur during the file upload and processing stages.

**See:** [Upload-Errors.md](Upload-Errors.md)

- File parsing errors
- Server communication errors
- Batch processing errors
- Timeout errors

### 2. Validation Errors

Errors related to data quality checks and business rule validations.

**See:** [Validation-Errors.md](Validation-Errors.md)

- Pre-ingestion validations (file format, required fields)
- Post-ingestion validations (growth limits, species checks)
- Cross-census validations (quadrat changes, coordinate drift)

### 3. Failed Measurements

Measurements that could not be processed into the database.

**See:** [Failed-Measurements-Guide.md](Failed-Measurements-Guide.md)

- Common failure reasons
- How to review and fix failures
- Reingestion process

### 4. Authentication & Access Errors

Errors related to login and permissions.

**See:** [Authentication-Errors.md](Authentication-Errors.md)

- Login failures
- Session expiration
- Permission denied errors

### 5. System & Connection Errors

Technical errors related to database and server issues.

**See:** [System-Errors.md](System-Errors.md)

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

---

## Error Severity Levels

| Severity     | Icon   | Meaning                  | Action Required              |
| ------------ | ------ | ------------------------ | ---------------------------- |
| **Critical** | Red    | Data cannot be processed | Must fix before proceeding   |
| **Warning**  | Yellow | Data flagged but saved   | Review and correct if needed |
| **Info**     | Blue   | Informational only       | No action required           |

---

## Getting Help

If you encounter an error not covered in this guide:

1. **Check the error message carefully** - It often contains specific details about what went wrong
2. **Review your data file** - Most errors are caused by data formatting issues
3. **Try the operation again** - Some errors are temporary (network issues)
4. **Use the Feedback button** - Submit a bug report with error details
5. **Contact your administrator** - For permission-related issues

---

## Related Documentation

- [Glossary of Terms](Glossary-of-Terms.md) - Understanding terminology used in error messages
- [Upload Process Breakdown](Upload-Process-Breakdown.md) - Understanding the upload stages
- [Non-Technical User Guide](Non-Technical-User-Guide-Outline.md) - General user guidance
