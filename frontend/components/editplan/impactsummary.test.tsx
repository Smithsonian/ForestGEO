import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ImpactSummary from './impactsummary';
import {
  BulkEditPlan,
  RoleForbiddenFieldPreviewError,
  RowPlan,
  SpeciesCorrectionGroup,
  SpeciesCorrectionSummary,
  TreeStemResolutionPreviewError
} from '@/config/editplan/types';

const PLAN_HASH = 'c'.repeat(64);
const PLAN_ROW_COUNT = 3;
// The literal phrase ImpactSummary requires the user to type for a destructive plan.
const EXPECTED_CONFIRM_PHRASE = `APPLY ${PLAN_ROW_COUNT}`;

const ROLE_FORBIDDEN_MESSAGE = 'SpeciesCode can only be edited by global or db admin users.';
const GROUP_SPECIES_CONFLICT_MESSAGE = 'Two rows in this batch request different destination species for the same tree.';
const GROUP_CONFLICT_ROW_INDEX = 2;

const CORRECTED_TREE_ID = 4201;
const CORRECTED_TREE_TAG = '4201-TAG';
const CORRECTED_CENSUS_ID = 10;
const OLD_SPECIES_CODE = 'ACERRU';
const NEW_SPECIES_CODE = 'QUERAL';
const OLD_SPECIES_ID = 55;
const NEW_SPECIES_ID = 77;
const PLOT_ID = 1;

const SECOND_TREE_ID = 5302;
const SECOND_TREE_TAG = '5302-TAG';
const SECOND_CENSUS_ID = 10;
const SECOND_OLD_SPECIES_CODE = 'PINUST';
const SECOND_NEW_SPECIES_CODE = 'QUERRU';
const SECOND_OLD_SPECIES_ID = 12;
const SECOND_NEW_SPECIES_ID = 34;

// Distinct per-group counts so a swapped/aggregated value fails loudly.
const GROUP_ONE_ACTIVE_STEMS = 2;
const GROUP_ONE_INACTIVE_STEMS = 1;
const GROUP_ONE_ACTIVE_MEASUREMENTS = 6;
const GROUP_ONE_INACTIVE_MEASUREMENTS = 3;

const GROUP_TWO_ACTIVE_STEMS = 5;
const GROUP_TWO_INACTIVE_STEMS = 0;
const GROUP_TWO_ACTIVE_MEASUREMENTS = 9;
const GROUP_TWO_INACTIVE_MEASUREMENTS = 0;

// All three distinct so an off-by-one/collapsed count fails: 1 row requested
// the correction, 1 sibling row rode along, and 2 more measurements the
// batch never submitted are also affected tree-wide.
const REQUESTED_MEMBER_CORE_MEASUREMENT_ID = 9001;
const SIBLING_MEMBER_CORE_MEASUREMENT_ID = 9002;
const UNSUBMITTED_AFFECTED_CORE_MEASUREMENT_ID_1 = 9003;
const UNSUBMITTED_AFFECTED_CORE_MEASUREMENT_ID_2 = 9004;
const REQUESTED_MEMBER_ROW_INDEX = 0;
const SIBLING_MEMBER_ROW_INDEX = 1;

function buildRowPlans(count: number): RowPlan[] {
  return Array.from({ length: count }, (_, rowIndex) => ({
    rowIndex,
    status: 'matched' as const
  }));
}

function buildSpeciesCorrectionSummary(overrides: Partial<SpeciesCorrectionSummary> = {}): SpeciesCorrectionSummary {
  return {
    version: 1,
    targetTreeID: overrides.targetTreeID ?? CORRECTED_TREE_ID,
    treeTag: overrides.treeTag ?? CORRECTED_TREE_TAG,
    plotID: overrides.plotID ?? PLOT_ID,
    censusID: overrides.censusID ?? CORRECTED_CENSUS_ID,
    oldSpeciesID: overrides.oldSpeciesID ?? OLD_SPECIES_ID,
    oldSpeciesCode: overrides.oldSpeciesCode ?? OLD_SPECIES_CODE,
    newSpeciesID: overrides.newSpeciesID ?? NEW_SPECIES_ID,
    newSpeciesCode: overrides.newSpeciesCode ?? NEW_SPECIES_CODE,
    activeStemCount: overrides.activeStemCount ?? GROUP_ONE_ACTIVE_STEMS,
    inactiveStemCount: overrides.inactiveStemCount ?? GROUP_ONE_INACTIVE_STEMS,
    activeMeasurementCount: overrides.activeMeasurementCount ?? GROUP_ONE_ACTIVE_MEASUREMENTS,
    inactiveMeasurementCount: overrides.inactiveMeasurementCount ?? GROUP_ONE_INACTIVE_MEASUREMENTS,
    stems: overrides.stems ?? [],
    measurements: overrides.measurements ?? []
  };
}

function buildSpeciesCorrectionGroup(overrides: Partial<SpeciesCorrectionGroup> = {}): SpeciesCorrectionGroup {
  return {
    version: 1,
    treeID: overrides.treeID ?? CORRECTED_TREE_ID,
    censusID: overrides.censusID ?? CORRECTED_CENSUS_ID,
    correction: overrides.correction ?? buildSpeciesCorrectionSummary(),
    members: overrides.members ?? [
      { rowIndex: REQUESTED_MEMBER_ROW_INDEX, coreMeasurementID: REQUESTED_MEMBER_CORE_MEASUREMENT_ID, requestedCorrection: true },
      { rowIndex: SIBLING_MEMBER_ROW_INDEX, coreMeasurementID: SIBLING_MEMBER_CORE_MEASUREMENT_ID, requestedCorrection: false }
    ],
    affectedCoreMeasurementIDs: overrides.affectedCoreMeasurementIDs ?? [
      REQUESTED_MEMBER_CORE_MEASUREMENT_ID,
      SIBLING_MEMBER_CORE_MEASUREMENT_ID,
      UNSUBMITTED_AFFECTED_CORE_MEASUREMENT_ID_1,
      UNSUBMITTED_AFFECTED_CORE_MEASUREMENT_ID_2
    ],
    affectedStemGUIDs: overrides.affectedStemGUIDs ?? []
  };
}

function buildBulkPlan(overrides: Partial<BulkEditPlan> = {}): BulkEditPlan {
  return {
    dataType: overrides.dataType ?? 'measurementssummary',
    rowCount: overrides.rowCount ?? PLAN_ROW_COUNT,
    rowPlans: overrides.rowPlans ?? buildRowPlans(PLAN_ROW_COUNT),
    aggregateEffects: overrides.aggregateEffects ?? [],
    errors: overrides.errors,
    canApply: overrides.canApply,
    maxSeverity: overrides.maxSeverity ?? 'info',
    planHash: overrides.planHash ?? PLAN_HASH,
    generatedAt: overrides.generatedAt ?? '2026-04-20T12:00:00Z',
    duplicateDeletions: overrides.duplicateDeletions ?? [],
    speciesCorrectionGroups: overrides.speciesCorrectionGroups
  };
}

function buildRoleForbiddenError(overrides: Partial<RoleForbiddenFieldPreviewError> = {}): RoleForbiddenFieldPreviewError {
  return {
    kind: 'RoleForbiddenField',
    field: 'SpeciesCode',
    role: 'field crew',
    message: ROLE_FORBIDDEN_MESSAGE,
    severity: 'destructive',
    blocking: true,
    ...overrides
  };
}

function buildGroupSpeciesConflictError(overrides: Partial<TreeStemResolutionPreviewError> = {}): TreeStemResolutionPreviewError {
  return {
    kind: 'TreeStemResolution',
    subject: 'species',
    reason: 'group_species_conflict',
    field: 'SpeciesCode',
    message: GROUP_SPECIES_CONFLICT_MESSAGE,
    severity: 'destructive',
    blocking: true,
    rowIndex: GROUP_CONFLICT_ROW_INDEX,
    treeID: CORRECTED_TREE_ID,
    ...overrides
  };
}

describe('ImpactSummary', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn().mockResolvedValue(undefined);
    onCancel = vi.fn();
  });

  describe('Blocker banners', () => {
    it('renders a TreeStemResolution group_species_conflict error under impact-summary-blocking-errors with its real message, never under the role banner', () => {
      const bulkPlan = buildBulkPlan({ canApply: false, errors: [buildGroupSpeciesConflictError()] });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const blockingErrors = screen.getByTestId('impact-summary-blocking-errors');
      expect(blockingErrors).toHaveTextContent(GROUP_SPECIES_CONFLICT_MESSAGE);
      expect(blockingErrors).toHaveTextContent(`Row ${GROUP_CONFLICT_ROW_INDEX + 1}:`);
      expect(screen.queryByTestId('impact-summary-blocked')).not.toBeInTheDocument();
    });

    it('renders the role-blocked banner with the exact role copy for a RoleForbiddenField error, without the generic blocking-errors banner', () => {
      const bulkPlan = buildBulkPlan({ canApply: false, errors: [buildRoleForbiddenError()] });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByTestId('impact-summary-blocked')).toHaveTextContent('This revision cannot be applied by your current role.');
      expect(screen.queryByTestId('impact-summary-blocking-errors')).not.toBeInTheDocument();
    });

    it('renders both the role banner and the blocking-errors banner when both kinds of blockers are present', () => {
      const bulkPlan = buildBulkPlan({
        canApply: false,
        errors: [buildRoleForbiddenError(), buildGroupSpeciesConflictError()]
      });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByTestId('impact-summary-blocked')).toBeInTheDocument();
      expect(screen.getByTestId('impact-summary-blocking-errors')).toHaveTextContent(GROUP_SPECIES_CONFLICT_MESSAGE);
    });

    it('disables Apply in every blocked case: role-only, group-conflict-only, and both together', () => {
      const roleOnly = buildBulkPlan({ canApply: false, errors: [buildRoleForbiddenError()] });
      const { rerender } = render(<ImpactSummary bulkPlan={roleOnly} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.getByTestId('impact-summary-apply')).toBeDisabled();

      const conflictOnly = buildBulkPlan({ canApply: false, errors: [buildGroupSpeciesConflictError()] });
      rerender(<ImpactSummary bulkPlan={conflictOnly} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.getByTestId('impact-summary-apply')).toBeDisabled();

      const both = buildBulkPlan({ canApply: false, errors: [buildRoleForbiddenError(), buildGroupSpeciesConflictError()] });
      rerender(<ImpactSummary bulkPlan={both} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.getByTestId('impact-summary-apply')).toBeDisabled();
    });

    it('shows a generic (non-role) blocked explanation and disables Apply when canApply is false with no errors at all', () => {
      const bulkPlan = buildBulkPlan({ canApply: false, errors: undefined });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const blockingErrors = screen.getByTestId('impact-summary-blocking-errors');
      expect(blockingErrors).not.toHaveTextContent(/role/i);
      expect(screen.queryByTestId('impact-summary-blocked')).not.toBeInTheDocument();
      expect(screen.getByTestId('impact-summary-apply')).toBeDisabled();
    });
  });

  describe('Species-correction preview', () => {
    it('renders one container per group, each with its own treeTag and old→new species codes', () => {
      const groupOne = buildSpeciesCorrectionGroup();
      const groupTwo = buildSpeciesCorrectionGroup({
        treeID: SECOND_TREE_ID,
        censusID: SECOND_CENSUS_ID,
        correction: buildSpeciesCorrectionSummary({
          targetTreeID: SECOND_TREE_ID,
          treeTag: SECOND_TREE_TAG,
          censusID: SECOND_CENSUS_ID,
          oldSpeciesID: SECOND_OLD_SPECIES_ID,
          oldSpeciesCode: SECOND_OLD_SPECIES_CODE,
          newSpeciesID: SECOND_NEW_SPECIES_ID,
          newSpeciesCode: SECOND_NEW_SPECIES_CODE,
          activeStemCount: GROUP_TWO_ACTIVE_STEMS,
          inactiveStemCount: GROUP_TWO_INACTIVE_STEMS,
          activeMeasurementCount: GROUP_TWO_ACTIVE_MEASUREMENTS,
          inactiveMeasurementCount: GROUP_TWO_INACTIVE_MEASUREMENTS
        }),
        members: [{ rowIndex: 0, coreMeasurementID: 9101, requestedCorrection: true }],
        affectedCoreMeasurementIDs: [9101]
      });
      const bulkPlan = buildBulkPlan({ speciesCorrectionGroups: [groupOne, groupTwo] });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const containerOne = screen.getByTestId(`impact-summary-species-correction-${CORRECTED_TREE_ID}-${CORRECTED_CENSUS_ID}`);
      expect(within(containerOne).getByText(new RegExp(CORRECTED_TREE_TAG))).toBeInTheDocument();
      expect(within(containerOne).getByText(`${OLD_SPECIES_CODE} → ${NEW_SPECIES_CODE}`)).toBeInTheDocument();

      const containerTwo = screen.getByTestId(`impact-summary-species-correction-${SECOND_TREE_ID}-${SECOND_CENSUS_ID}`);
      expect(within(containerTwo).getByText(new RegExp(SECOND_TREE_TAG))).toBeInTheDocument();
      expect(within(containerTwo).getByText(`${SECOND_OLD_SPECIES_CODE} → ${SECOND_NEW_SPECIES_CODE}`)).toBeInTheDocument();

      // Distinct per-group stem/measurement counts must not be swapped between containers.
      expect(within(containerOne).getByText(`Active stems: ${GROUP_ONE_ACTIVE_STEMS} · Inactive stems: ${GROUP_ONE_INACTIVE_STEMS}`)).toBeInTheDocument();
      expect(within(containerTwo).getByText(`Active stems: ${GROUP_TWO_ACTIVE_STEMS} · Inactive stems: ${GROUP_TWO_INACTIVE_STEMS}`)).toBeInTheDocument();
    });

    it('reports requested-member, sibling-member, and additional-unsubmitted-affected counts separately when all three differ', () => {
      const group = buildSpeciesCorrectionGroup();
      const bulkPlan = buildBulkPlan({ speciesCorrectionGroups: [group] });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const container = screen.getByTestId(`impact-summary-species-correction-${CORRECTED_TREE_ID}-${CORRECTED_CENSUS_ID}`);
      // 1 requested, 1 sibling, 2 unsubmitted-but-affected — three distinct numbers.
      expect(within(container).getByText('Submitted rows requesting this correction: 1')).toBeInTheDocument();
      expect(within(container).getByText('Other submitted rows for this tree: 1')).toBeInTheDocument();
      expect(within(container).getByText('Additional measurements affected but not submitted: 2')).toBeInTheDocument();
    });

    it('reports active and inactive measurement counts separately rather than summed', () => {
      const group = buildSpeciesCorrectionGroup();
      const bulkPlan = buildBulkPlan({ speciesCorrectionGroups: [group] });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const container = screen.getByTestId(`impact-summary-species-correction-${CORRECTED_TREE_ID}-${CORRECTED_CENSUS_ID}`);
      const summedText = `Active measurements: ${GROUP_ONE_ACTIVE_MEASUREMENTS + GROUP_ONE_INACTIVE_MEASUREMENTS}`;
      expect(within(container).queryByText(new RegExp(summedText))).not.toBeInTheDocument();
      expect(
        within(container).getByText(`Active measurements: ${GROUP_ONE_ACTIVE_MEASUREMENTS} · Inactive measurements: ${GROUP_ONE_INACTIVE_MEASUREMENTS}`)
      ).toBeInTheDocument();
    });

    it('omits the species-corrections section entirely, and keeps stats/effects/apply working, when there are no species correction groups', async () => {
      const user = userEvent.setup();
      const bulkPlan = buildBulkPlan({ speciesCorrectionGroups: undefined });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.queryByTestId('impact-summary-species-corrections')).not.toBeInTheDocument();
      expect(screen.queryByTestId('impact-summary-species-correction-count')).not.toBeInTheDocument();
      expect(screen.getByTestId('impact-summary-stats')).toHaveTextContent(`Matched: ${PLAN_ROW_COUNT}`);

      await user.click(screen.getByTestId('impact-summary-apply'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('Destructive typed-confirm gating', () => {
    it('keeps Apply disabled until the exact APPLY {rowCount} phrase is typed, then enables it', async () => {
      const user = userEvent.setup();
      const bulkPlan = buildBulkPlan({ maxSeverity: 'destructive', rowCount: PLAN_ROW_COUNT });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const applyButton = screen.getByTestId('impact-summary-apply');
      expect(applyButton).toBeDisabled();

      await user.type(screen.getByTestId('impact-summary-typed-confirm-input'), EXPECTED_CONFIRM_PHRASE);
      expect(applyButton).not.toBeDisabled();
    });

    it('keeps Apply disabled even after typing the exact confirm phrase when the plan is also blocked', async () => {
      const user = userEvent.setup();
      const bulkPlan = buildBulkPlan({
        maxSeverity: 'destructive',
        rowCount: PLAN_ROW_COUNT,
        canApply: false,
        errors: [buildGroupSpeciesConflictError()]
      });
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      await user.type(screen.getByTestId('impact-summary-typed-confirm-input'), EXPECTED_CONFIRM_PHRASE);
      expect(screen.getByTestId('impact-summary-apply')).toBeDisabled();
    });
  });

  describe('User interaction', () => {
    it('calls onConfirm when Apply is clicked in an enabled (non-destructive, unblocked) state', async () => {
      const user = userEvent.setup();
      const bulkPlan = buildBulkPlan();
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      await user.click(screen.getByTestId('impact-summary-apply'));
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('calls onCancel when Cancel is clicked', async () => {
      const user = userEvent.setup();
      const bulkPlan = buildBulkPlan();
      render(<ImpactSummary bulkPlan={bulkPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      await user.click(screen.getByTestId('impact-summary-cancel'));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
