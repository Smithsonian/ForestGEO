# Error FAQ and Troubleshooting

This page provides answers to frequently asked questions about errors and a comprehensive troubleshooting guide.

---

## General Questions

### Q: I see an error. Is my data lost?

**A:** Almost always no. The ForestGEO Application is designed to preserve data even when errors occur:

- Successfully uploaded data is saved immediately
- Failed measurements are stored for later recovery
- Database transactions rollback cleanly on errors
- Files are backed up to cloud storage

### Q: What should I do first when I see an error?

**A:** Follow these steps:

1. Read the error message carefully - it often tells you exactly what's wrong
2. Note any error codes or IDs shown
3. Try the operation again (many errors are temporary)
4. If it persists, check this guide for the specific error

### Q: Why do some errors say "Warning" and others say "Error"?

**A:**

- **Warning**: Your data was saved but flagged for review. You can fix it later.
- **Error**: The operation could not complete. Action is required.
- **Critical**: A serious system issue. Contact administrator.

### Q: Can I ignore warnings?

**A:** Warnings should be reviewed, but they don't prevent you from continuing. However, unresolved warnings may indicate data quality issues that could cause problems later.

---

## Upload Questions

### Q: My upload failed partway through. What happened to my data?

**A:** Data processed before the failure is saved. Check:

1. **Measurements Hub** - Some data may have been successfully uploaded
2. **Failed Measurements** - Problem rows are stored here
3. **Temporary Measurements** - Data may be waiting for reprocessing

### Q: Can I upload the same file again after an error?

**A:** Yes, but be careful:

- If the first upload partially succeeded, re-uploading creates duplicates
- Better to fix and reingest failed measurements
- Or clear failed/temporary data before re-uploading

### Q: How do I know if my upload succeeded?

**A:** Signs of successful upload:

- Progress bar reaches 100%
- "Upload Complete" message appears
- Data appears in Measurements Hub
- No error messages displayed

### Q: Why does uploading large files fail?

**A:** Large files may:

- Timeout due to network issues
- Exceed server memory limits
- Take too long to process

**Solutions:**

- Split large files into smaller batches (50,000 rows or less)
- Upload during off-peak hours
- Use a stable internet connection

### Q: What file formats are accepted?

**A:** CSV, TSV, and TXT files with:

- Comma, semicolon, or tab delimiters
- Header row with column names
- UTF-8 encoding recommended

---

## Validation Questions

### Q: Why is my data flagged with validation errors?

**A:** Validation errors indicate potential data quality issues:

- Growth too fast (>65mm)
- Shrinkage too large (>5%)
- Coordinates outside plot
- Duplicate records
- Invalid references (species, quadrats)

These are checks to help ensure data accuracy.

### Q: Do validation errors prevent my data from being saved?

**A:** No. Validation errors flag data for review but don't prevent saving. You can fix errors after upload.

### Q: How do I fix a validation error?

**A:**

1. Go to Measurements Hub > View Data
2. Filter to show only rows with errors
3. Click on a row to see the error details
4. Edit the values directly
5. Save your changes

### Q: Can I disable a validation that doesn't apply to my site?

**A:** Yes, administrators can enable/disable validations:

1. Go to Measurements Hub > Validations
2. Find the validation in the list
3. Toggle it off

> {style="warning"}
> Disabling validations may allow data quality issues to go undetected.

### Q: What if the validation is wrong?

**A:** If you believe a validation is incorrectly flagging valid data:

1. Document why you believe the data is correct
2. Contact administrator to review the validation rule
3. The rule thresholds may need adjustment for your site

---

## Failed Measurements Questions

### Q: What's the difference between "Failed Measurements" and "Temporary Measurements"?

**A:**

- **Failed Measurements**: Records that failed validation or processing
- **Temporary Measurements**: Records waiting to be processed (staging area)

### Q: How do I reingest failed measurements?

**A:**

1. Fix the underlying issue (e.g., add missing species)
2. Open the Failed Measurements modal
3. Click "Reingest All" or reingest individual records

### Q: Should I clear failed measurements or reingest them?

**A:**

- **Reingest** if: The data is valid but failed due to missing reference data
- **Clear** if: The data is bad, duplicated, or you'll re-upload a corrected file

### Q: Why do my reingested measurements keep failing?

**A:** Common causes:

- The fix wasn't actually saved
- Case sensitivity (codes must match exactly)
- You're in the wrong plot/census context
- There are additional issues beyond the original failure

---

## Login and Access Questions

### Q: Why can't I log in?

**A:** Check:

1. Credentials are correct (case-sensitive)
2. Caps lock is off
3. Browser cookies are enabled
4. Your account is active (ask administrator)

### Q: Why did I get logged out?

**A:** Sessions expire after inactivity. Simply log back in.

### Q: Why can't I see certain sites or plots?

**A:** You may not have access. Contact your administrator to be assigned to the site.

### Q: Why can't I edit data?

**A:** Check:

1. You're logged in
2. You have edit permissions (not viewer role)
3. The correct plot and census are selected
4. The data isn't locked

---

## System and Performance Questions

### Q: The application is running slowly. What should I do?

**A:** Try:

1. Refresh the page
2. Close other browser tabs
3. Clear browser cache
4. Try a different browser
5. Check your internet speed

If it persists, the server may be under heavy load.

### Q: I'm seeing lots of timeout errors. Is the server down?

**A:** Timeouts can occur due to:

- Heavy server load
- Network issues
- Large operations
- Database contention

Wait a few minutes and retry. If it persists for more than 30 minutes, contact administrator.

### Q: Can multiple people upload at the same time?

**A:** Yes, but not to the same plot/census. If you see "another upload in progress," wait for the other upload to complete.

---

## Data Questions

### Q: I accidentally deleted something. Can I recover it?

**A:** Contact your administrator immediately. Depending on what was deleted:

- Recent changes may be in the audit trail
- Database backups may be available
- Some deletions can be reversed

### Q: Why can't I delete this record?

**A:** The record may be referenced by other data. You need to:

1. Update referencing records to use different values, OR
2. Delete referencing records first

Common example: Cannot delete a species that has measurements.

### Q: Why is my data not appearing?

**A:** Check:

1. Correct site, plot, and census are selected
2. Data was actually uploaded successfully
3. You're not filtering it out
4. Page has been refreshed

---

## Quick Troubleshooting Checklist

If you're stuck, work through this checklist:

- [ ] Read the error message carefully
- [ ] Check your internet connection
- [ ] Verify you're logged in
- [ ] Verify correct site/plot/census is selected
- [ ] Refresh the page
- [ ] Try the operation again
- [ ] Try a different browser
- [ ] Clear browser cookies and cache
- [ ] Check if others are having the same issue
- [ ] Contact administrator with error details

---

## Error Message Quick Reference

| If you see...            | It usually means...        | Try...                    |
| ------------------------ | -------------------------- | ------------------------- |
| "Species code not found" | Species not in database    | Add species to Fixed Data |
| "Invalid quadrat"        | Quadrat not defined        | Add quadrat to Fixed Data |
| "Duplicate"              | Same data uploaded twice   | Remove duplicate          |
| "Timeout"                | Took too long              | Wait and retry            |
| "Unauthorized"           | Need to log in             | Log in again              |
| "Server error 500"       | Server problem             | Wait and retry            |
| "Connection lost"        | Network issue              | Check internet, retry     |
| "Missing required"       | Empty required field       | Fill in the data          |
| "Growth exceeds"         | Possible measurement error | Verify measurement        |
| "Outside plot"           | Coordinates wrong          | Check coordinates         |

---

## When to Contact Administrator

Contact your administrator if:

- You've tried the suggested fixes and still have issues
- You see an error not covered in this guide
- You need permission changes
- Data appears to be corrupted or lost
- The system is down for extended periods
- You see "Critical" errors

**When contacting, provide:**

- Exact error message
- Error ID (if shown)
- What you were trying to do
- When the error occurred
- Steps you've already tried
