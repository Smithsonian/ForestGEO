import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MenuList } from '@mui/joy';
import ValidationActionsMenu from './validationactionsmenu';

const noop = () => undefined;
const noopAsync = async () => undefined;

function renderMenu(counts: { pendingCount?: number; overridableCount?: number; revalidatableCount?: number }, onRunValidations: () => void = noop) {
  // The component renders MenuItems for use inside a parent Menu; MenuList
  // supplies the required ListContext without needing an anchored popup.
  return render(
    <MenuList>
      <ValidationActionsMenu onRunValidations={onRunValidations} onOverrideValidations={noop} onResetValidations={noop} onRefreshView={noopAsync} {...counts} />
    </MenuList>
  );
}

function runValidationsItem(): HTMLElement {
  const label = screen.getByText('Run Validations');
  const item = label.closest('[role="menuitem"]');
  if (!item) throw new Error('Run Validations menu item not found');
  return item as HTMLElement;
}

describe('ValidationActionsMenu — Run Validations gating', () => {
  it('is enabled with pending rows and describes the pending count', () => {
    renderMenu({ pendingCount: 3, overridableCount: 0, revalidatableCount: 0 });

    expect(screen.getByText('Validate 3 pending row(s)')).toBeInTheDocument();
    expect(runValidationsItem()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('is enabled with failed-but-revalidatable rows and describes the re-check count, not the overridable count', () => {
    renderMenu({ pendingCount: 0, overridableCount: 5, revalidatableCount: 2 });

    expect(screen.getByText('Re-check 2 failed row(s)')).toBeInTheDocument();
    expect(screen.queryByText('Re-check 5 failed row(s)')).not.toBeInTheDocument();
    expect(runValidationsItem()).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('is disabled when the only failures are ingestion failures a rerun cannot fix', () => {
    // overridableCount includes IsValidated FALSE/NULL rows regardless of
    // origin; revalidatableCount excludes ingestion failures (StemGUID NULL).
    // Rerun must not be offered when it would be a no-op.
    const onRun = vi.fn();
    renderMenu({ pendingCount: 0, overridableCount: 4, revalidatableCount: 0 }, onRun);

    expect(screen.getByText('No rows to validate')).toBeInTheDocument();
    expect(runValidationsItem()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(runValidationsItem());
    expect(onRun).not.toHaveBeenCalled();
  });

  it('is disabled when there is nothing to validate at all', () => {
    renderMenu({ pendingCount: 0, overridableCount: 0, revalidatableCount: 0 });

    expect(screen.getByText('No rows to validate')).toBeInTheDocument();
    expect(runValidationsItem()).toHaveAttribute('aria-disabled', 'true');
  });

  it('invokes onRunValidations when clicked in an enabled state', () => {
    const onRun = vi.fn();
    renderMenu({ pendingCount: 0, overridableCount: 2, revalidatableCount: 2 }, onRun);

    fireEvent.click(runValidationsItem());
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('keeps the override action driven by the full overridable count', () => {
    renderMenu({ pendingCount: 0, overridableCount: 5, revalidatableCount: 2 });

    expect(screen.getByText('Force 5 failed or not-yet-validated row(s) to pass')).toBeInTheDocument();
  });
});
