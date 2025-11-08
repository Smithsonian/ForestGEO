# UI/UX Implementation - Testing Guide

**Date:** November 7, 2025
**Version:** 1.0

---

## Overview

This guide provides comprehensive testing procedures for the UI/UX improvements implemented in the ForestGEO Census application. Follow these steps to validate functionality, performance, and ensure no regressions.

---

## Quick Start

### Prerequisites

1. **Development Environment Running:**

   ```bash
   npm run dev
   # Server should start on http://localhost:3000
   ```

2. **Database Connection Active:**
   - MySQL database accessible
   - Test data available for forestgeo schema
   - Valid site, plot, and census records

3. **Authentication:**
   - Valid user credentials
   - Test account with appropriate permissions

---

## Test 1: Aggregated Dashboard API ⚡ HIGH PRIORITY

### Purpose

Verify the new aggregated API endpoint works correctly and delivers performance improvements.

### API Endpoint Test

**Step 1: Direct API Test**

```bash
# Replace parameters with valid test data from your database
curl -X GET "http://localhost:3000/api/dashboardmetrics/all/forestgeo/1/1" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

**Expected Response:**

```json
{
  "progressTachometer": {
    "TotalQuadrats": 100,
    "PopulatedQuadrats": 75,
    "PopulatedPercent": 75.0,
    "UnpopulatedQuadrats": "Q001;Q015;Q042;..."
  },
  "activeUsers": {
    "CountActiveUsers": 5
  },
  "countTrees": {
    "CountTrees": 1250
  },
  "countStems": {
    "CountStems": 1687
  },
  "stemTypes": {
    "CountOldStems": 1200,
    "CountMultiStems": 437,
    "CountNewRecruits": 50
  }
}
```

**Pass Criteria:**

- ✅ HTTP 200 status code
- ✅ All 5 metric objects present
- ✅ Numeric values are reasonable
- ✅ Response time < 500ms

**Step 2: Invalid Schema Test**

```bash
curl -X GET "http://localhost:3000/api/dashboardmetrics/all/malicious_schema/1/1" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

**Expected Response:**

```json
{
  "error": "Invalid or unauthorized schema"
}
```

**Pass Criteria:**

- ✅ HTTP 400 status code
- ✅ Error message present
- ✅ No SQL injection vulnerability

### Performance Measurement

**Using Browser DevTools:**

1. Open Chrome DevTools (F12)
2. Go to Network tab
3. Clear network log
4. Navigate to Dashboard page
5. Look for API calls in network log

**Before Implementation (Baseline):**

- 7 separate API calls:
  - `/api/dashboardmetrics/ProgressTachometer/...` (~200ms)
  - `/api/dashboardmetrics/CountActiveUsers/...` (~150ms)
  - `/api/dashboardmetrics/CountTrees/...` (~180ms)
  - `/api/dashboardmetrics/CountStems/...` (~170ms)
  - `/api/dashboardmetrics/StemTypes/...` (~400ms)
  - `/api/changelog/overview/unifiedchangelog/...` (~200ms)
- **Total time:** ~1300ms (sequential)

**After Implementation (Target):**

- 2 API calls:
  - `/api/dashboardmetrics/all/...` (~300ms) ⚡
  - `/api/changelog/overview/unifiedchangelog/...` (~200ms)
- **Total time:** ~500ms (parallel)

**Performance Improvement:** **~60% faster** (1300ms → 500ms)

**Pass Criteria:**

- ✅ Only 2 API calls visible in Network tab
- ✅ Aggregated call completes in < 500ms
- ✅ Dashboard loads noticeably faster

---

## Test 2: Dashboard Functionality

### Visual Verification

**Step 1: Login and Navigate**

1. Login to application
2. Select a site from dropdown
3. Select a plot from dropdown
4. Select a census from dropdown
5. Navigate to Dashboard page

**Step 2: Verify Data Display**

Check that all dashboard sections display correctly:

- [ ] **Welcome Message:** "Welcome, [Username]!" displays
- [ ] **Census Statistics Card:**
  - [ ] Tachometer or Pie Chart renders
  - [ ] Can toggle between Tachometer and Pie Chart views
  - [ ] Unpopulated quadrats list displays (if any)
  - [ ] Personnel count displays
  - [ ] Stems count displays
  - [ ] Trees count displays
  - [ ] Stem type breakdown displays (Old/Multi/New)
  - [ ] Quadrat measurements summary displays

- [ ] **User-Specific Info Card:**
  - [ ] User role displays
  - [ ] User email displays
  - [ ] Accessible sites list displays
  - [ ] Recent changes stepper displays

**Step 3: Error Handling**

Test error scenarios:

1. **No Selection Made:**
   - Navigate to dashboard without selecting site/plot/census
   - **Expected:** Dashboard shows empty state or prompts for selection

2. **Invalid Data:**
   - Select site/plot/census with no measurements
   - **Expected:** Dashboard displays zeros or "No data" messages gracefully

3. **Network Error:**
   - Disconnect network or use DevTools to throttle
   - **Expected:** Error alert displays with helpful message

**Pass Criteria:**

- ✅ All dashboard sections render without errors
- ✅ Data matches what's in database
- ✅ Charts are interactive and responsive
- ✅ Error states handled gracefully

---

## Test 3: State Management (Zustand)

### User Selection Persistence

**Step 1: Make Selections**

1. Login to application
2. Select Site: "BCI"
3. Select Plot: "Plot 1"
4. Select Census: "Census 1"
5. Navigate to Dashboard

**Step 2: Refresh Page**

1. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
2. Wait for page to load

**Expected Result:**

- ✅ Site "BCI" still selected
- ✅ Plot "Plot 1" still selected
- ✅ Census "Census 1" still selected
- ✅ Dashboard data loads automatically
- ✅ No need to reselect

**Step 3: Open New Tab**

1. Open application in new browser tab
2. Navigate to Dashboard

**Expected Result:**

- ✅ Previous selections persist
- ✅ Dashboard loads with saved selections

**Step 4: Clear LocalStorage**

1. Open DevTools → Application → Local Storage
2. Find key: `forestgeo-storage`
3. Delete the key
4. Refresh page

**Expected Result:**

- ✅ Selections cleared
- ✅ Dropdowns show "Select..." placeholders
- ✅ Application doesn't crash

**Pass Criteria:**

- ✅ Selections persist across page refreshes
- ✅ Selections persist across browser tabs
- ✅ LocalStorage used correctly
- ✅ Graceful handling when localStorage cleared

---

## Test 4: Compatibility Hooks

### Purpose

Verify backward compatibility is maintained during gradual migration.

**Step 1: Check Existing Components**

Components still using old context hooks should work:

```typescript
// These should still work via compatibility hooks:
const currentSite = useSiteContext();
const currentPlot = usePlotContext();
const currentCensus = useOrgCensusContext();
const { setLoading } = useLoading();
```

**Test Components:**

- [ ] Sidebar (if not yet migrated)
- [ ] Header
- [ ] Data grids
- [ ] Upload modals
- [ ] Form components

**Expected:**

- ✅ All components render without errors
- ✅ State updates work correctly
- ✅ No console errors or warnings
- ✅ TypeScript compilation passes

**Pass Criteria:**

- ✅ Zero breaking changes to existing code
- ✅ All features work as before
- ✅ No regressions detected

---

## Test 5: Theme and Design System

### Visual Consistency Check

**Step 1: Verify Color Scheme**

Navigate through application and verify Forest/Nature theme:

- [ ] **Primary Color:** Forest Green (#16a34a) used for:
  - Primary buttons
  - Active navigation items
  - Selected states
  - Focus indicators

- [ ] **Buttons:**
  - Minimum size 44x44px (touch target)
  - Hover effect (slight lift + shadow)
  - Smooth transitions
  - Proper border radius

- [ ] **Cards:**
  - Consistent border radius (12px)
  - Subtle shadows
  - Hover shadow increase

- [ ] **Inputs/Selects:**
  - Consistent styling
  - Focus glow effect (green)
  - Minimum height 44px

**Step 2: Design Tokens Verification**

Check that design tokens are applied:

```typescript
// Spacing should be consistent (multiples of 4px)
// Border radius should be standardized
// Colors should use design token values
```

**Pass Criteria:**

- ✅ Consistent visual identity throughout app
- ✅ Forest/nature theme applied
- ✅ No jarring color inconsistencies
- ✅ Professional appearance

---

## Test 6: Accessibility

### Keyboard Navigation

**Step 1: Tab Through Interface**

1. Press Tab key repeatedly
2. Verify focus indicator visible on all interactive elements
3. Verify logical tab order

**Test Areas:**

- [ ] Sidebar site/plot/census selectors
- [ ] Navigation menu items
- [ ] Dashboard charts (clickable areas)
- [ ] Buttons and links
- [ ] Form inputs

**Expected:**

- ✅ Clear 2px blue focus outline on all focusable elements
- ✅ Logical tab order (top → bottom, left → right)
- ✅ Skip links work ("Skip to main content")
- ✅ No keyboard traps

**Step 2: Screen Reader Test**

Enable screen reader (NVDA on Windows, VoiceOver on Mac):

- [ ] Navigation elements announced correctly
- [ ] Form labels read properly
- [ ] Chart data accessible
- [ ] ARIA labels present and descriptive

**Pass Criteria:**

- ✅ Full keyboard navigation support
- ✅ WCAG 2.1 AA compliant
- ✅ Screen reader friendly
- ✅ No accessibility regressions

---

## Test 7: Responsive Design

### Mobile Testing

**Step 1: Resize Browser**

1. Open DevTools (F12)
2. Toggle device toolbar (Ctrl+Shift+M)
3. Test different viewport sizes:
   - Mobile: 375x667 (iPhone SE)
   - Tablet: 768x1024 (iPad)
   - Desktop: 1920x1080

**Expected Behavior:**

**Mobile (< 960px):**

- ✅ Sidebar collapses (off-canvas)
- ✅ Header with hamburger menu appears
- ✅ Dashboard cards stack vertically
- ✅ Touch targets minimum 44x44px
- ✅ No horizontal scrolling

**Tablet (960px - 1280px):**

- ✅ Sidebar visible but narrower
- ✅ Dashboard cards adjust
- ✅ Readable text sizes

**Desktop (> 1280px):**

- ✅ Full sidebar visible
- ✅ Dashboard cards side-by-side
- ✅ Optimal spacing

**Pass Criteria:**

- ✅ Responsive at all breakpoints
- ✅ No layout breaking
- ✅ Content readable on all devices

---

## Test 8: Performance Testing

### Component Re-renders

**Using React DevTools Profiler:**

1. Install React DevTools extension
2. Open DevTools → Profiler tab
3. Click "Start profiling"
4. Change site selection
5. Stop profiling
6. Analyze flamegraph

**Before Implementation (Baseline):**

- ~200+ component re-renders per selection change

**After Implementation (Target):**

- ~50-60 component re-renders per selection change

**Improvement:** **70% reduction in re-renders**

**Pass Criteria:**

- ✅ Significantly fewer re-renders visible in Profiler
- ✅ Selection changes feel instant
- ✅ No lag or jank

### Memory Usage

**Using Chrome DevTools Memory Profiler:**

1. Open DevTools → Memory tab
2. Take heap snapshot (baseline)
3. Use application normally for 5 minutes
4. Take another heap snapshot
5. Compare memory growth

**Expected:**

- ✅ Memory growth < 20MB over 5 minutes
- ✅ No memory leaks detected
- ✅ Garbage collection working properly

---

## Test 9: Error Scenarios

### SQL Injection Prevention

**Already tested in aggregated API, but verify:**

1. Attempt to inject SQL in URL parameters
2. Try malicious schema names
3. Test with special characters

**All should be rejected with proper error messages.**

### Network Failures

1. **Offline Mode:**
   - Disconnect network
   - Try to load dashboard
   - **Expected:** Error message, graceful fallback

2. **Slow Network:**
   - Use DevTools → Network → Throttling (Slow 3G)
   - Load dashboard
   - **Expected:** Loading indicators, patient timeout

3. **API Errors:**
   - Simulate 500 error from API
   - **Expected:** User-friendly error message, option to retry

**Pass Criteria:**

- ✅ No application crashes
- ✅ Helpful error messages
- ✅ Recovery options available

---

## Test 10: Regression Testing

### Existing Functionality Check

Verify all existing features still work:

- [ ] **Authentication:**
  - Login/logout works
  - Session persists
  - Unauthorized access blocked

- [ ] **Data Upload:**
  - File upload works
  - Validation runs
  - Data ingests correctly

- [ ] **Data Grids:**
  - Data displays
  - Sorting works
  - Filtering works
  - Editing works
  - Pagination works

- [ ] **Navigation:**
  - All menu items accessible
  - Routing works
  - Back button works

- [ ] **Forms:**
  - Validation works
  - Submit works
  - Error handling works

**Pass Criteria:**

- ✅ **Zero regressions**
- ✅ All existing features functional
- ✅ No new bugs introduced

---

## Test 11: Cross-Browser Testing

### Browser Compatibility

Test in multiple browsers:

- [ ] **Chrome** (primary)
- [ ] **Firefox**
- [ ] **Safari** (if Mac available)
- [ ] **Edge**

**Check:**

- Layout consistency
- Feature functionality
- Performance
- Console errors

**Pass Criteria:**

- ✅ Works in all major browsers
- ✅ No browser-specific bugs
- ✅ Consistent experience

---

## Automated Testing

### TypeScript Compilation

```bash
npx tsc --noEmit
```

**Expected:** No errors

### Unit Tests (if available)

```bash
npm run test:unit
```

**Expected:** All tests pass

### E2E Tests (if available)

```bash
npm run test:e2e
```

**Expected:** All tests pass

---

## Performance Benchmarks

### Metrics to Measure

| Metric                | Before   | Target  | Actual     |
| --------------------- | -------- | ------- | ---------- |
| Dashboard Load Time   | ~1300ms  | ~500ms  | **\_\_\_** |
| API Calls (Dashboard) | 7        | 2       | **\_\_\_** |
| Component Re-renders  | ~200     | ~60     | **\_\_\_** |
| Time to Interactive   | ~1600ms  | ~700ms  | **\_\_\_** |
| Bundle Size Increase  | 0        | +2KB    | **\_\_\_** |
| Memory Usage (5 min)  | Baseline | < +20MB | **\_\_\_** |

### How to Measure

**Dashboard Load Time:**

```javascript
// In browser console on Dashboard page:
performance.mark('dashboard-start');
// Wait for page to fully load
performance.mark('dashboard-end');
performance.measure('dashboard-load', 'dashboard-start', 'dashboard-end');
console.log(performance.getEntriesByName('dashboard-load'));
```

**API Calls:**

- Count requests in Network tab

**Re-renders:**

- Use React DevTools Profiler

**Bundle Size:**

```bash
ANALYZE=true npm run build
```

---

## Rollback Procedure

### If Critical Issues Found

**Step 1: Identify Problematic Commit**

```bash
git log --oneline -10
```

**Step 2: Revert Changes**

```bash
git revert <commit-hash>
# Or if not pushed yet:
git reset --hard <previous-commit-hash>
```

**Step 3: Reinstall Dependencies**

```bash
npm install
```

**Step 4: Verify Rollback**

```bash
npx tsc --noEmit
npm run dev
```

**Step 5: Document Issue**

- Create GitHub issue with:
  - What went wrong
  - Steps to reproduce
  - Error messages
  - Screenshots

---

## Sign-Off Checklist

Before considering implementation complete, verify:

### Functionality

- [ ] All tests in this guide pass
- [ ] Zero critical bugs
- [ ] Zero regressions
- [ ] Error handling works

### Performance

- [ ] Dashboard loads 2-3x faster
- [ ] Re-renders reduced by 60%+
- [ ] Memory usage acceptable
- [ ] No performance degradation

### Quality

- [ ] TypeScript: 0 errors
- [ ] Code reviewed
- [ ] Documentation complete
- [ ] Tests pass

### User Experience

- [ ] Selections persist
- [ ] Smooth interactions
- [ ] Clear error messages
- [ ] Accessible

### Security

- [ ] SQL injection prevented
- [ ] XSS prevented
- [ ] Auth working
- [ ] No sensitive data exposed

---

## Support

### If Tests Fail

1. **Document the failure** (screenshots, errors, steps)
2. **Check console** for error messages
3. **Review recent changes** in Git
4. **Consult documentation:**
   - `UI_UX_ANALYSIS_RECOMMENDATIONS.md`
   - `UI_UX_IMPLEMENTATION_PROGRESS.md`
   - `IMPLEMENTATION_SUMMARY.md`
5. **Create GitHub issue** if needed

### Contact

For questions or issues:

- Review implementation documentation
- Check Git commit history
- Consult with development team

---

**Testing Guide Version:** 1.0
**Last Updated:** November 7, 2025
**Status:** Ready for Testing
