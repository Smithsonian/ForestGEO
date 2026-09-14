import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describeDbhFloorSkips } from '@/config/dbhchangevalidations';
import ValidationStatusBadge from './validationstatusbadge';

const state = vi.hoisted(() => ({
  status: 'completed',
  progress: { completed: 2, total: 2, current: '' },
  errors: [] as string[],
  startValidationRun: vi.fn(),
  updateValidationProgress: vi.fn(),
  completeValidationRun: vi.fn()
}));

vi.mock('@/config/store/appstore', () => ({ useBackgroundValidationState: () => state }));
vi.mock('@/config/validation-runner', () => ({ ValidationRunner: { isRunning: () => false } }));

function openDetails() {
  render(<ValidationStatusBadge />);
  fireEvent.click(screen.getByRole('button', { name: 'Validation status' }));
}

describe('ValidationStatusBadge completion messages', () => {
  beforeEach(() => {
    state.status = 'completed';
    state.errors = [];
  });

  it('shows persisted notices for a completed run without presenting a failure', () => {
    const notice = describeDbhFloorSkips(42)!;
    state.errors = [notice];

    openDetails();

    expect(screen.getByText('Validation completed with notices')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(notice);
    expect(screen.queryByText(/validations? failed/)).not.toBeInTheDocument();
    expect(screen.queryByText('All 2 validations passed')).not.toBeInTheDocument();
  });

  it('keeps the success display for a completed run without notices', () => {
    openDetails();

    expect(screen.getByText('All 2 validations passed')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('still displays failures and their messages for failed runs', () => {
    state.status = 'failed';
    state.errors = ['Failed to refresh measurement views'];

    openDetails();

    expect(screen.getByText('1 validation failed')).toBeInTheDocument();
    expect(screen.getByText(state.errors[0])).toBeInTheDocument();
    expect(screen.queryByText('Validation completed with notices')).not.toBeInTheDocument();
  });
});
