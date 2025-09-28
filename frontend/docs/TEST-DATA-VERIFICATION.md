# ForestGEO Test Data Verification

## Overview

This document verifies that our test suites use comprehensive, realistic sample data that accurately represents ForestGEO's forest research sites and user access patterns. The tests are designed to work for **any user** executing them, regardless of their actual ForestGEO credentials.

## Realistic Test Data Sources

### 🌍 **Forest Research Sites**

Based on actual ForestGEO network sites:

| Site                      | Schema     | Location           | Plot Size         | Quadrats | Special Notes              |
| ------------------------- | ---------- | ------------------ | ----------------- | -------- | -------------------------- |
| **Luquillo**              | `luquillo` | Puerto Rico, USA   | 16 ha (320×500m)  | 320      | Tropical wet forest        |
| **Barro Colorado Island** | `bci`      | Panama             | 50 ha (1000×500m) | 1250     | Most studied tropical plot |
| **Pasoh**                 | `pasoh`    | Malaysia           | 50 ha (1000×500m) | 1250     | No double data entry       |
| **Lambir**                | `lambir`   | Malaysia           | 52 ha             | Variable | High diversity             |
| **Harvard Forest**        | `harvard`  | Massachusetts, USA | 35 ha (700×500m)  | 875      | Temperate deciduous        |

### 👥 **User Profiles**

Representing different access levels:

#### **Standard User** (`Dr. Jane Forest`)

- **Email**: `jane.forest@forestgeo.si.edu`
- **Access**: Luquillo + BCI
- **Status**: `active`
- **Permissions**: `read`, `write`
- **Use Case**: Typical researcher with multi-site access

#### **Admin User** (`Dr. Admin Forestry`)

- **Email**: `admin@forestgeo.si.edu`
- **Access**: All sites
- **Status**: `global`
- **Permissions**: `read`, `write`, `admin`
- **Use Case**: Site manager or data administrator

#### **Limited User** (`Student Researcher`)

- **Email**: `student@university.edu`
- **Access**: Luquillo only
- **Status**: `limited`
- **Permissions**: `read`
- **Use Case**: Graduate student working on single-site thesis

#### **New User** (`New Field Assistant`)

- **Email**: `new.user@forestgeo.si.edu`
- **Access**: None (pending approval)
- **Status**: `pending`
- **Permissions**: None
- **Use Case**: Recently registered user awaiting site assignments

## Test Data Accuracy Verification

### ✅ **Site Properties Match Reality**

- **Luquillo**: 16-ha tropical wet forest, double data entry enabled
- **BCI**: 50-ha tropical moist forest, extensive census history since 1980
- **Pasoh**: 50-ha lowland dipterocarp forest, single data entry
- **Harvard**: 35-ha temperate deciduous forest

### ✅ **Plot Dimensions Are Realistic**

- Quadrat dimensions follow ForestGEO 20m × 20m standard
- Plot areas match published literature
- Coordinate systems use actual lat/long where possible

### ✅ **Census History Reflects Real Patterns**

- **5-year census intervals** (standard ForestGEO protocol)
- **BCI earliest data** (1980) - reflects its status as longest-running plot
- **Luquillo starts 1990** - matches actual establishment timeline
- **Multiple census periods** for longitudinal analysis

### ✅ **User Access Patterns Are Realistic**

- **Hierarchical permissions**: limited → standard → admin
- **Site-specific access**: Users typically work with 1-3 sites
- **Email domains**: Use actual ForestGEO institution addresses
- **Status levels**: Match real user classification system

## Test Execution Independence

### 🔄 **Works for Any Test Runner**

The test data is completely **self-contained** and **mock-based**:

```typescript
// ✅ NO dependency on actual user credentials
// ✅ NO network calls to real APIs
// ✅ NO database connections required
// ✅ Consistent results across environments
```

### 🎯 **User-Agnostic Design**

Tests validate the **intended behavior** regardless of who runs them:

1. **Authentication Flow**: Works with mock credentials
2. **Site Selection**: Uses realistic ForestGEO site list
3. **Plot Selection**: Validates actual plot characteristics
4. **Permission Testing**: Covers all user access levels
5. **Data Integrity**: Ensures proper cascade loading

## Test Coverage Matrix

| User Type    | Sites Accessible | Test Scenarios                | Validation Points                        |
| ------------ | ---------------- | ----------------------------- | ---------------------------------------- |
| **Standard** | Luquillo, BCI    | Site selection, plot workflow | ✅ Multi-site access, ✅ Data loading    |
| **Admin**    | All sites        | Full site management          | ✅ Global access, ✅ All plot types      |
| **Limited**  | Luquillo only    | Restricted workflow           | ✅ Single site, ✅ Permission boundaries |
| **New**      | None             | Access denied scenarios       | ✅ No site access, ✅ Proper redirects   |

## Key Test Validations

### 🔐 **Authentication & Authorization**

- ✅ Login/logout functionality
- ✅ Session management
- ✅ User status validation
- ✅ Permission-based access control

### 🌍 **Site & Plot Selection**

- ✅ Site dropdown shows correct options
- ✅ Plot loading based on site selection
- ✅ Realistic plot characteristics (quadrats, dimensions)
- ✅ User can only access assigned sites

### 📊 **Data Integrity**

- ✅ Census data loads for selected plot
- ✅ Quadrat information available
- ✅ Site changes clear dependent selections
- ✅ Navigation respects selection requirements

### 🚨 **Error Handling**

- ✅ API failures handled gracefully
- ✅ Authentication errors redirect properly
- ✅ Invalid selections prevented
- ✅ Network issues don't break workflow

## Running the Tests

### **Vitest (Unit/Integration)**

```bash
npm run test
```

Tests business logic with realistic ForestGEO data structures.

### **Cypress Component Tests**

```bash
npm run com:headless
```

Tests individual components with mock ForestGEO data.

### **Cypress E2E Tests**

```bash
npm run end:headless
```

Tests complete user workflows with realistic data flows.

## Benefits of This Approach

### 🎯 **Accuracy**

- Tests reflect real ForestGEO data patterns
- Site characteristics match published specifications
- User access models mirror actual permissions

### 🔄 **Reliability**

- Tests run consistently regardless of executor
- No dependency on external services
- Predictable data ensures stable test results

### 📈 **Comprehensive Coverage**

- Multiple user types and access levels
- Various site configurations and plot sizes
- Complete workflow from login to data access

### 🚀 **Maintainability**

- Centralized test data in fixtures
- Easy to add new sites or user types
- Clear separation between test logic and data

---

**Result**: These tests provide **high confidence** that the core authentication and site/plot selection workflow functions correctly for **any ForestGEO user** after structural code changes, using **realistic, representative data** that mirrors the actual ForestGEO research network.
