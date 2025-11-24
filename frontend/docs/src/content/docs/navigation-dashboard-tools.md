---
title: Navigation & Dashboard Tools
description: Learn how to navigate the ForestGEO application and use dashboard tools.
---

The sidebar and dashboard are your primary interfaces for navigating the ForestGEO application. This guide explains how to use them effectively.

---

## The Sidebar

The sidebar is located on the left side of the screen and contains all navigation elements. It is divided into two main areas:

1. **Selection Dropdowns** - Site, Plot, and Census selection
2. **Navigation Menu** - Links to all application features

### Selection Dropdowns

Before you can access most features, you must make selections in the sidebar dropdowns. These selections determine which data you're working with.

#### Site Selection

The **Site** dropdown is the first selection you'll make after logging in.

:::note
Sites represent geographic locations where forest plots are established. You will only see sites that an administrator has assigned to your account.
:::

When you select a site, the application connects to that site's database schema. All subsequent data operations will apply to the selected site.

#### Plot Selection

After selecting a site, the **Plot** dropdown becomes available.

A plot is a specific geographic region within a site where data collection occurs. Plots have defined dimensions, coordinates, and are subdivided into quadrats.

:::tip
If you see a placeholder plot, use the **ellipsis button** (⋯) next to the dropdown to open the Plot Customization popup and configure your plot's properties.
:::

#### Census Selection

After selecting a plot, the **Census** dropdown appears.

A census represents a time period during which measurements were collected. Each census has:

- **Start date** - When data collection began
- **End date** - When data collection completed
- **Census number** - Sequential identifier (Census 1, Census 2, etc.)

:::note
The navigation menu remains **disabled** until you select a census. This ensures you're always working within a specific census context.
:::

---

## Navigation Menu

Once you've selected a site, plot, and census, the navigation menu becomes active. It is organized into the following sections:

### Dashboard

The home page showing census statistics and data health metrics. See the [Dashboard](#the-dashboard) section below for details.

### Stem & Plot Details

This section contains interfaces for managing **Fixed Data** - reference data required before you can upload measurements.

| Page | Description |
|------|-------------|
| **Stem Codes** | Attribute codes describing tree/stem conditions (e.g., "D" for dead, "L" for leaning) |
| **Personnel** | Field staff and data collection team members for the census |
| **Quadrats** | Geographic subdivisions of the plot |
| **Species List** | Inventory of all species found in the plot with taxonomy information |

:::caution
You must add at least **one record** to each of these data types before the **View Data** page becomes accessible!
:::

### Census Hub

This section contains interfaces for working with measurement data and census analysis.

| Page | Description |
|------|-------------|
| **View Data** | View and edit measurements for the current census |
| **Post-Census Statistics** | Run statistical analyses on your census data |
| **Recent Changes** | Audit trail showing all data modifications |
| **Uploaded Files** | History of files uploaded to the system with download links |
| **View All Historical Data** | Browse measurements across all censuses |
| **Validations** | Configure and manage data validation rules |

---

## The Dashboard

The dashboard provides an at-a-glance overview of your census progress and data health.

### Census Progress Metrics

The dashboard displays visual indicators showing:

- **Total stems measured** - How many stems have been recorded
- **Validation status** - How many records have passed validation
- **Data completeness** - Progress toward census completion

### Stem Statistics

Key statistics about your census data:

| Metric | Description |
|--------|-------------|
| **Old Stems** | Stems measured in previous censuses being remeasured |
| **Multi-Stems** | Trees with more than one stem |
| **New Recruits** | Stems being measured for the first time |

### Data Validity Status

The dashboard shows the status of your Fixed Data:

- ✓ **Green checkmark** - Data is present and valid
- ✗ **Red indicator** - Missing required data
- ! **Warning badge** - Data needs attention

:::note
If you see warning indicators in the sidebar navigation, it means one or more data types in that section are missing required data.
:::

### Recent Changes

A quick view of the most recent data modifications, showing:

- What was changed
- Who made the change
- When it occurred

Click **Recent Changes** in the Census Hub to see the full audit trail.

---

## Understanding Data Dependencies

The application enforces a specific workflow to ensure data integrity:

```
Step 1: Select Site → Plot → Census
              ↓
Step 2: Add Fixed Data (all four types)
              ↓
Step 3: Upload/Enter Measurements
              ↓
Step 4: Run Validations & Statistics
```

### Why Fixed Data Comes First

Measurements reference Fixed Data records. When you upload a measurement file:

- **Species codes** must exist in the Species List
- **Quadrat names** must be defined in Quadrats
- **Attribute codes** must exist in Stem Codes
- **Personnel** should be recorded for the census

If these references don't exist, measurements will fail to process and end up in the Failed Measurements table.

---

## Quick Reference: Navigation Paths

| To Access... | Navigate to... |
|--------------|----------------|
| Add stem codes | Stem & Plot Details → Stem Codes |
| Add personnel | Stem & Plot Details → Personnel |
| Define quadrats | Stem & Plot Details → Quadrats |
| Add species | Stem & Plot Details → Species List |
| Upload measurements | Census Hub → View Data |
| Run statistics | Census Hub → Post-Census Statistics |
| View audit trail | Census Hub → Recent Changes |
| Download uploaded files | Census Hub → Uploaded Files |
| See all historical data | Census Hub → View All Historical Data |
| Configure validations | Census Hub → Validations |

---

## Tips for Efficient Navigation

1. **Use the sidebar wisely** - Always verify your Site/Plot/Census selection before making changes
2. **Check the warning badges** - A red badge indicates missing data that needs attention
3. **Complete Fixed Data first** - This unlocks the View Data page and prevents upload failures
4. **Bookmark the dashboard** - Return here regularly to check your census progress
5. **Review Recent Changes** - Monitor the audit trail to track all modifications
