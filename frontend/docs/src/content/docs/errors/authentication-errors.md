---
title: Authentication Errors
description: Guide to errors related to logging in, session management, and access permissions.
---

This guide covers errors related to logging in, session management, and access permissions.

---

## Login Errors

### There is no ForestGEO password

Signing in hands you to Microsoft Entra ID, so ForestGEO never sees a password and cannot reject
one. If sign-in fails, the problem is with the Microsoft account or with what that account has
been granted — not with credentials typed into this application.

| Error Message | Cause | How to Fix |
| --- | --- | --- |
| "We could not reach the authentication service. This is usually temporary — please try again in a moment." | The permissions directory was briefly unreachable | Wait a moment and try again; tell an administrator if it persists |
| "Login failure triggered without reason. Please speak to an administrator." | Sign-in failed for a reason the app could not identify | Contact an administrator |

### Generic Login Failure

| Error Message                                                              | Cause                        | How to Fix                                     |
| -------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------- |
| "Login failure triggered without reason. Please speak to an administrator" | Unknown authentication error | Contact your site administrator for assistance |

---

## Session Errors

### When your session stops working

| What you see | Cause | How to Fix |
| --- | --- | --- |
| A request fails with **401 Unauthorized** | Your sign-in is no longer valid | Reload the page and sign in again |
| A request fails with **503** and mentions permissions being unavailable | The app cannot currently read which sites you may use | Wait and retry; this is usually temporary |

:::note
An "upload session" is a different thing from your login session. An upload session going stale
affects only that upload, and you can start a new one — it does not sign you out.
:::

### Cookie/Session Issues

If sign-in loops or the app behaves as though you are signed out, clearing cookies for the site
and signing in again resolves most cases.

**To clear cookies:**

1. Open browser settings
2. Find "Cookies" or "Site Data"
3. Clear cookies for the ForestGEO application domain
4. Log in again

---

## Permission Errors

### Access Denied

| Error Message   | Cause                                     | How to Fix                                  |
| --------------- | ----------------------------------------- | ------------------------------------------- |
| "Access denied. This page is only accessible to global administrators." | The admin pages are restricted to the `global` role | Ask a global administrator to act for you |
| A request fails with **403 Forbidden** | Your role or site assignments do not cover this action | Verify your role and that the site is assigned to you |

### Site Access Issues

| Symptom                        | Cause                                       | How to Fix                                       |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------ |
| Site not appearing in dropdown | You're not assigned to that site            | Contact administrator to be assigned to the site |
| Cannot select a plot           | You don't have access to plots at this site | Verify your site assignment with administrator   |

---

## Troubleshooting Login Issues

### Cannot Log In

1. **Check your credentials**
   - Verify email/username is correct
   - Check for caps lock on password
   - Try resetting your password

2. **Check your browser**
   - Clear cookies and cache
   - Try a different browser
   - Disable browser extensions that might interfere

3. **Check network connection**
   - Ensure you have internet access
   - Try accessing the login page again
   - Check if the server is accessible

4. **Contact support**
   - If none of the above works, contact your administrator
   - Provide any error messages you see

### Logged Out Unexpectedly

**Common causes:**

- Session timeout (extended inactivity)
- Browser cookies cleared
- Multiple tabs with different sessions
- Server restart

**Solution:**
Simply log back in. Your data is not affected.

---

## Account Issues

### New User Access

If you're a new user and cannot access the application:

1. **Verify your account exists** - Contact your site administrator
2. **Check email address** - Ensure you're using the correct email
3. **Check site assignment** - You may need to be assigned to a site
4. **Request access** - Ask administrator to grant appropriate permissions

### Role-Related Issues

| Role | Notes |
| --- | --- |
| **global** | Full access, including the administration pages and site provisioning |
| **db admin** | Full data access, including the Validations page and species-code edits |
| **lead technician** | Day-to-day data work: upload, edit, and review |
| **field crew** | Day-to-day data work |
| **pending** | Signed in through Microsoft but not yet registered — cannot edit anything until an administrator assigns a role |

If you need additional permissions, contact your administrator.

---

## Security Best Practices

1. **Don't share your Microsoft account** - Each user should sign in as themselves
2. **Log out when done** - Especially on shared computers
3. **Report suspicious activity** - Contact administrator if you notice unauthorized access
4. **Keep browser updated** - Security updates help protect your session
5. **Use secure networks** - Avoid logging in on public, unsecured WiFi

---

## FAQ: Authentication

### Q: How long does my session last?

**A:** Sessions typically last for several hours of activity. Extended inactivity will cause automatic logout.

### Q: Can I be logged in on multiple devices?

**A:** Yes, you can have sessions on multiple devices simultaneously.

### Q: What happens to my work if I'm logged out?

**A:** Any saved changes are preserved. Unsaved changes (work in progress) may be lost.

### Q: Why can't I see all the sites I should have access to?

**A:** Site access must be granted by an administrator. Contact them to verify your site assignments.
