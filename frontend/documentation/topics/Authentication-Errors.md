# Authentication Errors

This guide covers errors related to logging in, session management, and access permissions.

---

## Login Errors

### Invalid Credentials

| Error Message                               | Cause                          | How to Fix                                                                             |
| ------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| "Failure caused due to invalid credentials" | Username or password incorrect | Verify your login credentials; contact administrator if you've forgotten your password |

### Generic Login Failure

| Error Message                                                              | Cause                        | How to Fix                                     |
| -------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------- |
| "Login failure triggered without reason. Please speak to an administrator" | Unknown authentication error | Contact your site administrator for assistance |

---

## Session Errors

### Session Expired

| Error Message                            | Cause                                   | How to Fix                        |
| ---------------------------------------- | --------------------------------------- | --------------------------------- |
| "Session expired"                        | Your login session has timed out        | Log out and log back in           |
| "Unauthorized - authentication required" | Session is no longer valid              | Refresh the page and log in again |
| "You must be logged in to upload data"   | Attempting action without valid session | Log in before proceeding          |

### Cookie/Session Issues

| Error Message               | Cause                             | How to Fix                             |
| --------------------------- | --------------------------------- | -------------------------------------- |
| "No email found in cookies" | Session data missing or corrupted | Clear browser cookies and log in again |

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
| "Access denied" | You don't have permission for this action | Contact administrator to request access     |
| "Unauthorized"  | Your role doesn't allow this operation    | Verify you have the correct role assignment |

### Site Access Issues

| Symptom                        | Cause                                       | How to Fix                                       |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------ |
| Site not appearing in dropdown | You're not assigned to that site            | Contact administrator to be assigned to the site |
| Cannot select a plot           | You don't have access to plots at this site | Verify your site assignment with administrator   |

---

## Account Issues

### New User Access

If you're a new user and cannot access the application:

1. **Verify your account exists** - Contact your site administrator
2. **Check email address** - Ensure you're using the correct email
3. **Check site assignment** - You may need to be assigned to a site
4. **Request access** - Ask administrator to grant appropriate permissions

### Role-Related Issues

| Role              | Can Do             | Cannot Do                                |
| ----------------- | ------------------ | ---------------------------------------- |
| **Viewer**        | View data          | Edit data, upload files, admin functions |
| **Site User**     | View, edit, upload | Admin functions, user management         |
| **Administrator** | Everything         | N/A                                      |

If you need additional permissions, contact your administrator.

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

### "Remember Me" Not Working

If you're being asked to log in frequently:

1. Check browser privacy settings
2. Ensure cookies are enabled
3. Don't use private/incognito mode
4. Check if browser is clearing cookies on exit

---

## OAuth Provider Issues

If your organization uses OAuth (Google, Azure AD, etc.) for login:

### OAuth Login Failed

| Symptom                  | Cause                             | How to Fix                                     |
| ------------------------ | --------------------------------- | ---------------------------------------------- |
| Redirected back to login | OAuth authentication rejected     | Check your OAuth account credentials           |
| "Account not authorized" | Your OAuth account not registered | Contact administrator to register your account |
| OAuth popup blocked      | Browser blocking OAuth window     | Allow popups for the application domain        |

### OAuth Account Issues

1. **Wrong account** - Make sure you're logged into the correct OAuth account
2. **Account not linked** - Your OAuth account may need to be linked to ForestGEO
3. **Permissions not granted** - You may need to approve the OAuth permissions request

---

## Security Best Practices

1. **Don't share login credentials** - Each user should have their own account
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

### Q: How do I change my password?

**A:** Contact your site administrator or use the password reset function if available.

### Q: Why can't I see all the sites I should have access to?

**A:** Site access must be granted by an administrator. Contact them to verify your site assignments.

---

## Contacting Your Administrator

For authentication issues, your administrator can:

- Reset your password
- Assign you to sites
- Change your role/permissions
- Verify your account status
- Troubleshoot login problems

Provide your administrator with:

- Your email address/username
- Any error messages you see
- When the problem started
- Steps you've already tried
