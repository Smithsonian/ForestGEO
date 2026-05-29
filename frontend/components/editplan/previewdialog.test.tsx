import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PreviewDialog from './previewdialog';
import { EditPlan, Effect } from '@/config/editplan/types';

const PLAN_HASH = 'a'.repeat(64);

function makeEffect(overrides: Partial<Effect> = {}): Effect {
  return {
    id: overrides.id ?? 'effect-generic',
    severity: overrides.severity ?? 'info',
    category: overrides.category ?? 'field',
    title: overrides.title ?? 'Generic effect',
    detail: overrides.detail ?? 'A generic effect for testing.',
    affectedTable: overrides.affectedTable ?? 'coremeasurements',
    affectedRowCount: overrides.affectedRowCount ?? 0,
    references: overrides.references
  };
}

function makePlan(overrides: Partial<EditPlan> = {}): EditPlan {
  return {
    dataType: overrides.dataType ?? 'measurementssummary',
    targetID: overrides.targetID ?? 42,
    fieldChanges: overrides.fieldChanges ?? [
      { field: 'MeasuredDBH', from: 10, to: 12 },
      { field: 'MeasuredHOM', from: null, to: 1.3 }
    ],
    effects: overrides.effects ?? [],
    errors: overrides.errors,
    canApply: overrides.canApply,
    maxSeverity: overrides.maxSeverity ?? 'info',
    planHash: overrides.planHash ?? PLAN_HASH,
    generatedAt: overrides.generatedAt ?? '2026-04-20T12:00:00Z'
  };
}

describe('PreviewDialog', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn().mockResolvedValue(undefined);
    onCancel = vi.fn();
  });

  describe('Rendering', () => {
    it('renders header with measurement targetID', () => {
      render(<PreviewDialog plan={makePlan({ targetID: 7 })} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByText(/Review changes.*Measurement #7/)).toBeInTheDocument();
    });

    it('renders each field change as a from/to row', () => {
      const plan = makePlan({
        fieldChanges: [
          { field: 'MeasuredDBH', from: 10, to: 12 },
          { field: 'Codes', from: 'L', to: 'L;M' }
        ]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const dbhRow = screen.getByTestId('edit-preview-field-MeasuredDBH');
      expect(within(dbhRow).getByText('10')).toBeInTheDocument();
      expect(within(dbhRow).getByText('12')).toBeInTheDocument();

      const codesRow = screen.getByTestId('edit-preview-field-Codes');
      expect(within(codesRow).getByText('L')).toBeInTheDocument();
      expect(within(codesRow).getByText('L;M')).toBeInTheDocument();
    });

    it('renders footer with undo note and both action buttons', () => {
      render(<PreviewDialog plan={makePlan()} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByText(/Undo available via Recent Changes or row menu/)).toBeInTheDocument();
      expect(screen.getByTestId('edit-preview-cancel')).toBeInTheDocument();
      expect(screen.getByTestId('edit-preview-apply')).toBeInTheDocument();
    });

    it('renders a severity chip in the title that reflects plan.maxSeverity', () => {
      const safe = makePlan({ maxSeverity: 'info' });
      const { rerender } = render(<PreviewDialog plan={safe} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.getByTestId('edit-preview-severity-info')).toBeInTheDocument();

      rerender(<PreviewDialog plan={makePlan({ maxSeverity: 'warn' })} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.getByTestId('edit-preview-severity-warn')).toBeInTheDocument();

      rerender(<PreviewDialog plan={makePlan({ maxSeverity: 'destructive' })} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.getByTestId('edit-preview-severity-destructive')).toBeInTheDocument();
    });

    it('renders typed-confirm input on destructive single-row edits', () => {
      const plan = makePlan({
        maxSeverity: 'destructive',
        effects: [makeEffect({ id: 'destr', severity: 'destructive', title: 'Destructive action' })]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByTestId('edit-preview-typed-confirm')).toBeInTheDocument();
      expect(screen.getByTestId('edit-preview-typed-confirm-input')).toBeInTheDocument();
    });

    it('hides typed-confirm input when plan is destructive but blocked by role', () => {
      const plan = makePlan({
        canApply: false,
        maxSeverity: 'destructive',
        errors: [
          {
            kind: 'RoleForbiddenField',
            field: 'SpeciesCode',
            role: 'field crew',
            message: 'SpeciesCode can only be edited by global or db admin users.',
            severity: 'destructive',
            blocking: true
          }
        ],
        effects: [makeEffect({ id: 'destr', severity: 'destructive' })]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.queryByTestId('edit-preview-typed-confirm')).not.toBeInTheDocument();
    });

    it('does not render typed-confirm input on warn or info severity', () => {
      const warnPlan = makePlan({ maxSeverity: 'warn', effects: [makeEffect({ severity: 'warn' })] });
      const { rerender } = render(<PreviewDialog plan={warnPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.queryByTestId('edit-preview-typed-confirm')).not.toBeInTheDocument();

      const infoPlan = makePlan({ maxSeverity: 'info' });
      rerender(<PreviewDialog plan={infoPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);
      expect(screen.queryByTestId('edit-preview-typed-confirm')).not.toBeInTheDocument();
    });
  });

  describe('Effect severity ordering', () => {
    it('renders destructive effects before warn before info', () => {
      const plan = makePlan({
        maxSeverity: 'destructive',
        effects: [
          makeEffect({ id: 'info-1', severity: 'info', title: 'Info first in input' }),
          makeEffect({ id: 'warn-1', severity: 'warn', title: 'Warn in middle' }),
          makeEffect({ id: 'destr-1', severity: 'destructive', title: 'Destructive last in input' })
        ]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const effectsContainer = screen.getByTestId('edit-preview-effects');
      const effectCards = within(effectsContainer).getAllByTestId(/^edit-effect-/);
      const renderedIDs = effectCards.map(card => card.getAttribute('data-testid'));

      expect(renderedIDs).toEqual(['edit-effect-destr-1', 'edit-effect-warn-1', 'edit-effect-info-1']);
    });

    it('renders the row count badge when effect affects rows', () => {
      const plan = makePlan({
        effects: [makeEffect({ id: 'rowcount', severity: 'warn', affectedRowCount: 3 })]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByTestId('edit-effect-rowcount-rowcount')).toHaveTextContent('3 rows');
    });
  });

  describe('User interaction', () => {
    it('calls onCancel when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(<PreviewDialog plan={makePlan()} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      await user.click(screen.getByTestId('edit-preview-cancel'));

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('calls onConfirm when Apply button is clicked', async () => {
      const user = userEvent.setup();
      render(<PreviewDialog plan={makePlan()} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      await user.click(screen.getByTestId('edit-preview-apply'));

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('disables Apply and Cancel while busy', () => {
      render(<PreviewDialog plan={makePlan()} onConfirm={onConfirm} onCancel={onCancel} busy={true} />);

      expect(screen.getByTestId('edit-preview-apply')).toBeDisabled();
      expect(screen.getByTestId('edit-preview-cancel')).toBeDisabled();
    });

    it('disables Apply for blocking role errors while keeping Cancel available', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const plan = makePlan({
        canApply: false,
        errors: [
          {
            kind: 'RoleForbiddenField',
            field: 'SpeciesCode',
            role: 'field crew',
            message: 'SpeciesCode can only be edited by global or db admin users.',
            severity: 'destructive',
            blocking: true
          }
        ],
        effects: [makeEffect({ id: 'AUTH_ROLE_FORBIDDEN_FIELD_SpeciesCode', severity: 'destructive' })],
        maxSeverity: 'destructive'
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByTestId('edit-preview-blocked')).toHaveTextContent('cannot be applied');
      expect(screen.getByTestId('edit-preview-apply')).toBeDisabled();
      expect(screen.getByTestId('edit-preview-cancel')).not.toBeDisabled();

      await user.click(screen.getByTestId('edit-preview-apply'));
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('does not call onConfirm when Apply is clicked while busy', async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      render(<PreviewDialog plan={makePlan()} onConfirm={onConfirm} onCancel={onCancel} busy={true} />);

      await user.click(screen.getByTestId('edit-preview-apply'));

      expect(onConfirm).not.toHaveBeenCalled();
    });

    // Symmetric guard with destructive duplicate deletion in revisions match —
    // single-cell destructive edits must require a deliberate keystroke before
    // the Apply button enables.
    it('disables Apply on destructive plans until the user types APPLY', async () => {
      const user = userEvent.setup();
      const plan = makePlan({
        maxSeverity: 'destructive',
        effects: [makeEffect({ id: 'destr', severity: 'destructive' })]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const applyButton = screen.getByTestId('edit-preview-apply');
      const input = screen.getByTestId('edit-preview-typed-confirm-input');

      expect(applyButton).toBeDisabled();

      await user.type(input, 'apply'); // case-insensitive
      expect(applyButton).not.toBeDisabled();

      await user.click(applyButton);
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('keeps Apply disabled on destructive plans when typed text is wrong', async () => {
      const user = userEvent.setup();
      const plan = makePlan({
        maxSeverity: 'destructive',
        effects: [makeEffect({ id: 'destr', severity: 'destructive' })]
      });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      const applyButton = screen.getByTestId('edit-preview-apply');
      const input = screen.getByTestId('edit-preview-typed-confirm-input');

      await user.type(input, 'YES');
      expect(applyButton).toBeDisabled();
    });

    it('resets typed-confirm when the plan hash changes (drift replay)', async () => {
      const user = userEvent.setup();
      const initialPlan = makePlan({
        maxSeverity: 'destructive',
        planHash: 'a'.repeat(64),
        effects: [makeEffect({ id: 'destr', severity: 'destructive' })]
      });
      const { rerender } = render(<PreviewDialog plan={initialPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      await user.type(screen.getByTestId('edit-preview-typed-confirm-input'), 'APPLY');
      expect(screen.getByTestId('edit-preview-apply')).not.toBeDisabled();

      // 409 drift: replace plan with a new hash. The user must re-type to
      // confirm — otherwise they'd be approving effects they never read.
      const refreshedPlan = makePlan({
        maxSeverity: 'destructive',
        planHash: 'b'.repeat(64),
        effects: [makeEffect({ id: 'destr', severity: 'destructive' })]
      });
      rerender(<PreviewDialog plan={refreshedPlan} onConfirm={onConfirm} onCancel={onCancel} busy={false} wasRefreshed={true} />);

      expect(screen.getByTestId('edit-preview-apply')).toBeDisabled();
    });

    it('renders the drift-replay banner when wasRefreshed is true', () => {
      render(<PreviewDialog plan={makePlan({ maxSeverity: 'warn' })} onConfirm={onConfirm} onCancel={onCancel} busy={false} wasRefreshed={true} />);

      expect(screen.getByTestId('edit-preview-refreshed-banner')).toBeInTheDocument();
    });

    it('does not render the drift-replay banner on the first preview', () => {
      render(<PreviewDialog plan={makePlan()} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.queryByTestId('edit-preview-refreshed-banner')).not.toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('renders empty-state copy when there are no field changes', () => {
      const plan = makePlan({ fieldChanges: [] });
      render(<PreviewDialog plan={plan} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByText('No field changes.')).toBeInTheDocument();
    });

    it('renders empty-state copy when there are no effects', () => {
      render(<PreviewDialog plan={makePlan({ effects: [] })} onConfirm={onConfirm} onCancel={onCancel} busy={false} />);

      expect(screen.getByText('No downstream effects detected.')).toBeInTheDocument();
    });
  });
});
