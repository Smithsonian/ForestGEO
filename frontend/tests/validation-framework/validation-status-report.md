# Validation Testing Status Report

## Current Test Results (2025-01-09)

### Overall Summary
- **Total Validations**: 14 (in database)
- **Tested Validations**: 7
- **Passing Tests**: 13/15 (86.7%)
- **Failing Tests**: 2/15 (13.3%)

---

## Validation Status by ID

### ✅ Validation 3: ValidateFindAllInvalidSpeciesCodes
**Status**: PASSING ✓
**Tests**: 2/2 passing
**Description**: Detects species codes that don't exist in species table

**Test Results**:
- ✓ Invalid Species Code - Correctly flags measurements with non-existent species
- ✓ Valid Species Code - Correctly ignores measurements with valid species

**Query Quality**: GOOD

---

### ✅ Validation 6: ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat
**Status**: PASSING ✓
**Tests**: 3/3 passing
**Description**: Detects measurements outside census date bounds

**Test Results**:
- ✓ Date Before Census Start - Correctly flags dates before StartDate
- ✓ Date After Census End - Correctly flags dates after EndDate
- ✓ Date Within Census Bounds - Correctly ignores valid dates

**Query Quality**: GOOD

---

### ✅ Validation 8: ValidateFindStemsOutsidePlots
**Status**: PASSING ✓
**Tests**: 2/2 passing
**Description**: Detects stems with coordinates outside plot boundaries

**Test Results**:
- ✓ Stem X Coordinate Outside Plot - Correctly flags stems beyond plot dimensions
- ✓ Stem Within Plot Boundaries - Correctly ignores stems within bounds

**Query Quality**: GOOD

---

### ✅ Validation 14: ValidateFindInvalidAttributeCodes
**Status**: PASSING ✓
**Tests**: 2/2 passing
**Description**: Detects attribute codes that don't exist in attributes table

**Test Results**:
- ✓ Invalid Attribute Code - Correctly flags code 'MX' (from bug report)
- ✓ Valid Attribute Code - Correctly ignores valid codes

**Query Quality**: GOOD

---

### ✅ Validation 15: ValidateFindAbnormallyHighDBH
**Status**: PASSING ✓
**Tests**: 3/3 passing
**Description**: Detects DBH values >= 3500mm (abnormally high)

**Test Results**:
- ✓ Abnormally High DBH (26600mm) - Correctly flags extreme value (from bug report)
- ✓ DBH At Threshold (3500mm) - Correctly flags threshold value
- ✓ Normal DBH - Correctly ignores normal values

**Query Quality**: GOOD

---

### ❌ Validation 1: ValidateDBHGrowthExceedsMax
**Status**: FAILING ✗
**Tests**: 1/2 failing
**Description**: Detects DBH growth > 65mm between censuses

**Test Results**:
- ✗ Excessive DBH Growth - SHOULD flag but doesn't (FALSE NEGATIVE)
- ✓ Normal DBH Growth - Correctly ignores normal growth

**Issue**: Query fails to detect excessive growth (100mm > 65mm limit)

**Suspected Problems**:
1. Census comparison logic may be incorrect
2. PlotCensusNumber filtering may exclude test data
3. IsValidated condition may prevent detection
4. Attribute status filtering may be too restrictive

**Query Quality**: BROKEN - Needs investigation

---

### ❌ Validation 2: ValidateDBHShrinkageExceedsMax
**Status**: FAILING ✗
**Tests**: 1/1 failing
**Description**: Detects DBH shrinkage > 5% between censuses

**Test Results**:
- ✗ Excessive DBH Shrinkage - SHOULD flag but doesn't (FALSE NEGATIVE)

**Issue**: Query fails to detect excessive shrinkage (10% > 5% limit)

**Suspected Problems**:
1. Similar to Validation 1 - census comparison issues
2. Percentage calculation may be incorrect
3. PlotCensusNumber filtering may exclude test data
4. IsValidated condition may prevent detection

**Query Quality**: BROKEN - Needs investigation

---

### ⚪ Validation 4: ValidateFindDuplicatedQuadratsByName
**Status**: NOT TESTED
**Description**: Detects quadrats with same name but different IDs

**Priority**: Medium
**Recommended Tests**:
- Test case: Two quadrats with same name, different IDs
- Test case: Quadrats with unique names

---

### ⚪ Validation 5: ValidateFindDuplicateStemTreeTagCombinationsPerCensus
**Status**: NOT TESTED
**Description**: Detects duplicate stem/tree tag combinations in census

**Priority**: High
**Recommended Tests**:
- Test case: Duplicate StemTag + TreeTag combination
- Test case: Unique combinations

---

### ⚪ Validation 7: ValidateFindStemsInTreeWithDifferentSpecies
**Status**: NOT TESTED
**Description**: Detects trees with stems assigned to different species

**Priority**: Medium
**Recommended Tests**:
- Test case: Tree with stems having different species
- Test case: Tree with all stems having same species

---

### ⚪ Validation 9: ValidateFindTreeStemsInDifferentQuadrats
**Status**: NOT TESTED
**Description**: Detects trees with stems in different quadrats

**Priority**: Medium
**Recommended Tests**:
- Test case: Tree with stems in different quadrats
- Test case: Tree with all stems in same quadrat

---

### ⚪ Validation 11: ValidateScreenMeasuredDiameterMinMax
**Status**: NOT TESTED
**Description**: Detects DBH outside species-defined bounds

**Priority**: Low
**Recommended Tests**:
- Test case: DBH below species minimum
- Test case: DBH above species maximum
- Test case: DBH within species bounds

---

### ⚪ Validation 12: ValidateScreenStemsWithMeasurementsButDeadAttributes
**Status**: NOT TESTED
**Description**: Detects stems with measurements but dead-state attributes

**Priority**: Medium
**Recommended Tests**:
- Test case: Stem with DBH but 'dead' attribute
- Test case: Stem with HOM but 'stem dead' attribute
- Test case: Dead stem with no measurements (valid)

**Note**: Currently DISABLED (IsEnabled = false)

---

### ⚪ Validation 13: ValidateScreenStemsWithMissingMeasurementsButLiveAttributes
**Status**: NOT TESTED
**Description**: Detects stems missing measurements but with live-state attributes

**Priority**: Medium
**Recommended Tests**:
- Test case: Stem with no DBH but 'alive' attribute
- Test case: Stem with no HOM but live attribute
- Test case: Live stem with measurements (valid)

**Note**: Currently DISABLED (IsEnabled = false)

---

## Action Items

### Immediate (High Priority)

1. **Fix Validation 1: DBH Growth**
   - Investigate why excessive growth isn't detected
   - Check census comparison logic
   - Verify PlotCensusNumber filtering
   - Test with simplified data

2. **Fix Validation 2: DBH Shrinkage**
   - Similar investigation to Validation 1
   - Check percentage calculation
   - Verify shrinkage threshold (0.95)

### Short Term (Medium Priority)

3. **Add Tests for Validation 5** (Duplicate Tags)
   - High data quality impact
   - Common user error

4. **Add Tests for Validations 7, 9, 12, 13**
   - Important data integrity checks

### Long Term (Lower Priority)

5. **Add Tests for Validations 4, 11**
   - Less critical but should be tested

6. **Enable and Test Validations 12, 13**
   - Currently disabled, need to verify if intentional

---

## Test Coverage Summary

| Validation ID | Name | Status | Tests | Coverage |
|--------------|------|--------|-------|----------|
| 1 | ValidateDBHGrowthExceedsMax | ❌ BROKEN | 2 | 50% pass |
| 2 | ValidateDBHShrinkageExceedsMax | ❌ BROKEN | 1 | 0% pass |
| 3 | ValidateFindAllInvalidSpeciesCodes | ✅ WORKING | 2 | 100% pass |
| 4 | ValidateFindDuplicatedQuadratsByName | ⚪ UNTESTED | 0 | N/A |
| 5 | ValidateFindDuplicateStemTreeTagCombinationsPerCensus | ⚪ UNTESTED | 0 | N/A |
| 6 | ValidateFindMeasurementsOutsideCensusDateBoundsGroupByQuadrat | ✅ WORKING | 3 | 100% pass |
| 7 | ValidateFindStemsInTreeWithDifferentSpecies | ⚪ UNTESTED | 0 | N/A |
| 8 | ValidateFindStemsOutsidePlots | ✅ WORKING | 2 | 100% pass |
| 9 | ValidateFindTreeStemsInDifferentQuadrats | ⚪ UNTESTED | 0 | N/A |
| 11 | ValidateScreenMeasuredDiameterMinMax | ⚪ UNTESTED | 0 | N/A |
| 12 | ValidateScreenStemsWithMeasurementsButDeadAttributes | ⚪ UNTESTED (disabled) | 0 | N/A |
| 13 | ValidateScreenStemsWithMissingMeasurementsButLiveAttributes | ⚪ UNTESTED (disabled) | 0 | N/A |
| 14 | ValidateFindInvalidAttributeCodes | ✅ WORKING | 2 | 100% pass |
| 15 | ValidateFindAbnormallyHighDBH | ✅ WORKING | 3 | 100% pass |

**Overall**: 5/7 tested validations working (71.4%)
**Coverage**: 7/14 validations tested (50%)

---

## Recommendations

1. **Immediate**: Focus on fixing Validations 1 & 2 - these are critical for data quality
2. **Expand Coverage**: Add test scenarios for remaining 7 untested validations
3. **Review Disabled Validations**: Determine if Validations 12 & 13 should be enabled
4. **Continuous Testing**: Run `npm run test:validations` after any changes to validation queries

---

**Report Generated**: 2025-01-09
**Framework Version**: 1.0.0
**Database**: forestgeo_testing
