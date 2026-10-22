import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CensusesOverview from './censusesoverview';
import { CENSUS_DELETE_ADMIN_ONLY_REASON, CENSUS_DELETE_INACTIVE_REASON, CENSUS_DELETE_LATEST_ONLY_REASON } from '@/config/censusdeletion';
import type { UserAuthRoles } from '@/config/macros';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';

const PLOT_ID = 1;
const DELETE_ITEM_NAME = /Delete census/;

function buildCensus(plotCensusNumber: number, isActive: boolean): OrgCensusRDS {
  const censusID = 100 + plotCensusNumber;
  return {
    plotID: PLOT_ID,
    plotCensusNumber,
    censusIDs: [censusID],
    dateRanges: [{ censusID, startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') }],
    description: `Census ${plotCensusNumber}`,
    isActive
  };
}

const EARLIER_ACTIVE = buildCensus(1, true);
const LATEST_ACTIVE = buildCensus(2, true);
const NEWER_INACTIVE = buildCensus(3, false);

function renderOverview(censuses: OrgCensusRDS[], userRole: UserAuthRoles = 'global') {
  const onCensusDelete = vi.fn();
  const onSelectCensus = vi.fn();
  render(<CensusesOverview censuses={censuses} plotName="Test Plot" userRole={userRole} onCensusDelete={onCensusDelete} onSelectCensus={onSelectCensus} />);
  return { onCensusDelete, onSelectCensus };
}

function menuTrigger(plotCensusNumber: number): HTMLElement {
  return screen.getByRole('button', { name: `More actions for census ${plotCensusNumber}` });
}

async function openMenuWithMouse(user: ReturnType<typeof userEvent.setup>, plotCensusNumber: number): Promise<HTMLElement> {
  await user.click(menuTrigger(plotCensusNumber));
  return screen.findByRole('menuitem', { name: DELETE_ITEM_NAME });
}

function describeItem(item: HTMLElement): string {
  return `aria-disabled=${item.getAttribute('aria-disabled')} text="${item.textContent}"`;
}

describe('CensusesOverview census card menu (#525 items 2+3)', () => {
  it('lets an admin delete the latest active census without selecting the card', async () => {
    const user = userEvent.setup();
    const { onCensusDelete, onSelectCensus } = renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE]);
    const deleteItem = await openMenuWithMouse(user, LATEST_ACTIVE.plotCensusNumber);
    console.log(`[#525 items 2+3] latest active item: ${describeItem(deleteItem)}`);
    expect(deleteItem).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(deleteItem);

    expect(onCensusDelete).toHaveBeenCalledTimes(1);
    expect(onCensusDelete).toHaveBeenCalledWith(LATEST_ACTIVE);
    expect(onSelectCensus).not.toHaveBeenCalled();
  });

  it('disables delete on an earlier census and says only the latest can be deleted', async () => {
    const user = userEvent.setup();
    const { onSelectCensus } = renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE]);
    const deleteItem = await openMenuWithMouse(user, EARLIER_ACTIVE.plotCensusNumber);
    console.log(`[#525 items 2+3] earlier census item: ${describeItem(deleteItem)}`);

    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).toHaveTextContent(CENSUS_DELETE_LATEST_ONLY_REASON);
    expect(onSelectCensus).not.toHaveBeenCalled();
  });

  it('disables delete on an inactive newer census while the latest active census stays deletable', async () => {
    const user = userEvent.setup();
    renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE, NEWER_INACTIVE]);
    const inactiveItem = await openMenuWithMouse(user, NEWER_INACTIVE.plotCensusNumber);
    console.log(`[#525 items 2+3] inactive census item: ${describeItem(inactiveItem)}`);
    expect(inactiveItem).toHaveAttribute('aria-disabled', 'true');
    expect(inactiveItem).toHaveTextContent(CENSUS_DELETE_INACTIVE_REASON);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    const latestItem = await openMenuWithMouse(user, LATEST_ACTIVE.plotCensusNumber);
    console.log(`[#525 items 2+3] latest active item beside an inactive newer census: ${describeItem(latestItem)}`);
    expect(latestItem).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disables delete for a non-admin with the admin-only reason', async () => {
    const user = userEvent.setup();
    renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE], 'field crew');
    const deleteItem = await openMenuWithMouse(user, LATEST_ACTIVE.plotCensusNumber);

    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).toHaveTextContent(CENSUS_DELETE_ADMIN_ONLY_REASON);
  });

  it('opens the menu with Enter and deletes with ArrowDown + Enter, never selecting the card', async () => {
    const user = userEvent.setup();
    const { onCensusDelete, onSelectCensus } = renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE]);

    menuTrigger(LATEST_ACTIVE.plotCensusNumber).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: DELETE_ITEM_NAME });
    expect(onSelectCensus).not.toHaveBeenCalled();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    console.log(`[#525 items 2+3] keyboard delete: onCensusDelete=${onCensusDelete.mock.calls.length} onSelectCensus=${onSelectCensus.mock.calls.length}`);
    expect(onCensusDelete).toHaveBeenCalledTimes(1);
    expect(onCensusDelete).toHaveBeenCalledWith(LATEST_ACTIVE);
    expect(onSelectCensus).not.toHaveBeenCalled();
  });

  it('closes the menu with Escape without selecting the card', async () => {
    const user = userEvent.setup();
    const { onCensusDelete, onSelectCensus } = renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE]);

    menuTrigger(LATEST_ACTIVE.plotCensusNumber).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: DELETE_ITEM_NAME });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('menuitem')).not.toBeInTheDocument());
    expect(onSelectCensus).not.toHaveBeenCalled();
    expect(onCensusDelete).not.toHaveBeenCalled();
  });

  it('still selects the census when the card body itself is clicked', async () => {
    const user = userEvent.setup();
    const { onSelectCensus } = renderOverview([EARLIER_ACTIVE, LATEST_ACTIVE]);

    await user.click(screen.getByRole('button', { name: /^Census 2\. Status/ }));

    expect(onSelectCensus).toHaveBeenCalledWith(LATEST_ACTIVE);
  });
});
