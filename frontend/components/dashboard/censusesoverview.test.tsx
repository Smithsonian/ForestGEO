import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CensusesOverview from './censusesoverview';
import { CENSUS_DELETE_ADMIN_ONLY_REASON, CENSUS_DELETE_INACTIVE_REASON, CENSUS_DELETE_LATEST_ONLY_REASON } from '@/config/censusdeletion';
import type { UserAuthRoles } from '@/config/macros';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';

vi.mock('@/components/loading', () => ({
  ContentSkeleton: () => <div data-testid="skeleton" />
}));

// Date-only values arrive as ISO strings at UTC midnight (mysql2 pool timezone 'Z').
// They are cast because the declared type is Date, but JSON delivers strings.
const day = (iso: string) => iso as unknown as Date;

function census(plotCensusNumber: number, ranges: Record<string, unknown>): OrgCensusRDS {
  return {
    plotID: 1,
    plotCensusNumber,
    censusIDs: [plotCensusNumber],
    dateRanges: [{ censusID: plotCensusNumber, ...ranges }],
    description: ''
  } as OrgCensusRDS;
}

// Assertions hold in every browser zone; run the file under TZ=UTC, TZ=America/Los_Angeles and
// TZ=Pacific/Auckland. Nothing mutates process.env.TZ.
describe('CensusesOverview date handling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Noon UTC on 2026-10-20: the same calendar day in every zone from LA to Auckland.
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a census window starting 2027-01-01 as January, not December', () => {
    render(
      <CensusesOverview
        censuses={[
          census(1, {
            startDate: day('2027-01-01T00:00:00.000Z'),
            endDate: day('2027-12-31T00:00:00.000Z'),
            censusStartDate: day('2027-01-01T00:00:00.000Z'),
            censusEndDate: day('2027-12-31T00:00:00.000Z'),
            firstMeasurementDate: null,
            lastMeasurementDate: null
          })
        ]}
      />
    );
    expect(screen.getByText('Census window: Jan 2027 - Dec 2027')).toBeInTheDocument();
    expect(screen.queryByText(/Dec 2026/)).not.toBeInTheDocument();
  });

  it('uses the census window for status and duration, not the measurement dates', () => {
    // Window starts in the future; a single past measurement must not make it Completed / "0 days".
    render(
      <CensusesOverview
        censuses={[
          census(2, {
            startDate: day('2026-09-02T00:00:00.000Z'),
            endDate: day('2026-09-02T00:00:00.000Z'),
            censusStartDate: day('2027-01-01T00:00:00.000Z'),
            censusEndDate: null,
            firstMeasurementDate: day('2026-09-02T00:00:00.000Z'),
            lastMeasurementDate: day('2026-09-02T00:00:00.000Z')
          })
        ]}
      />
    );
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('0 days')).not.toBeInTheDocument();
    expect(screen.getByText('Measurements: Sep 2, 2026')).toBeInTheDocument();
  });

  it('marks a census Completed only when its window has ended and keeps measurement dates separate', () => {
    render(
      <CensusesOverview
        censuses={[
          census(3, {
            censusStartDate: day('2025-01-01T00:00:00.000Z'),
            censusEndDate: day('2025-12-31T00:00:00.000Z'),
            firstMeasurementDate: day('2025-02-15T00:00:00.000Z'),
            lastMeasurementDate: day('2025-03-03T00:00:00.000Z')
          })
        ]}
      />
    );
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Census window: Jan 2025 - Dec 2025')).toBeInTheDocument();
    expect(screen.getByText('Measurements: Feb 15, 2025 - Mar 3, 2025')).toBeInTheDocument();
    expect(screen.getByText('11 months')).toBeInTheDocument();
  });

  it('shows no measurement line and an unset window for a census without dates', () => {
    render(<CensusesOverview censuses={[census(4, { censusStartDate: null, censusEndDate: null, firstMeasurementDate: null, lastMeasurementDate: null })]} />);
    expect(screen.getByText('Census window not set')).toBeInTheDocument();
    expect(screen.getByText('Planned')).toBeInTheDocument();
    expect(screen.queryByText(/^Measurements:/)).not.toBeInTheDocument();
  });

  it('falls back to startDate/endDate for a legacy payload without window fields', () => {
    render(<CensusesOverview censuses={[census(5, { startDate: day('2025-02-01T00:00:00.000Z'), endDate: day('2025-04-30T00:00:00.000Z') })]} />);
    expect(screen.getByText('Census window: Feb 2025 - Apr 2025')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('labels a census with a closed range plus an open range as ongoing, with duration through today', () => {
    const open: OrgCensusRDS = {
      plotID: 1,
      plotCensusNumber: 7,
      censusIDs: [8, 7],
      dateRanges: [
        { censusID: 8, censusStartDate: day('2026-03-01T00:00:00.000Z'), censusEndDate: null },
        { censusID: 7, censusStartDate: day('2026-01-01T00:00:00.000Z'), censusEndDate: day('2026-02-01T00:00:00.000Z') }
      ],
      description: ''
    } as unknown as OrgCensusRDS;
    render(<CensusesOverview censuses={[open]} />);
    expect(screen.getByText('Census window: Jan 2026 - ongoing')).toBeInTheDocument();
    expect(screen.queryByText(/Feb 2026/)).not.toBeInTheDocument();
    expect(screen.getByText('In Progress')).toBeInTheDocument();
    expect(screen.getByText('9 months')).toBeInTheDocument();
  });

  it('does not throw for a census with no date ranges', () => {
    render(
      <CensusesOverview censuses={[{ plotID: 1, plotCensusNumber: 6, censusIDs: [6], dateRanges: [], description: '', isActive: true } as OrgCensusRDS]} />
    );
    expect(screen.getByText('Census window not set')).toBeInTheDocument();
  });
});

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

const EDIT_DATES_ITEM_NAME = /Edit census dates/;

function renderOverviewWithEditDates(censuses: OrgCensusRDS[], userRole: UserAuthRoles = 'global') {
  const onCensusDelete = vi.fn();
  const onCensusEditDates = vi.fn();
  const onSelectCensus = vi.fn();
  render(
    <CensusesOverview
      censuses={censuses}
      plotName="Test Plot"
      userRole={userRole}
      onCensusDelete={onCensusDelete}
      onCensusEditDates={onCensusEditDates}
      onSelectCensus={onSelectCensus}
    />
  );
  return { onCensusDelete, onCensusEditDates, onSelectCensus };
}

describe('CensusesOverview census card menu: Edit census dates', () => {
  it('lists Edit census dates above Delete census', async () => {
    const user = userEvent.setup();
    renderOverviewWithEditDates([EARLIER_ACTIVE, LATEST_ACTIVE]);
    await user.click(menuTrigger(LATEST_ACTIVE.plotCensusNumber));
    const items = await screen.findAllByRole('menuitem');
    console.log(`[edit census dates] menu items: ${items.map(item => `"${item.textContent}"`).join(', ')}`);
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(EDIT_DATES_ITEM_NAME);
    expect(items[1]).toHaveTextContent(DELETE_ITEM_NAME);
  });

  it('calls onCensusEditDates with that census and never selects the card', async () => {
    const user = userEvent.setup();
    const { onCensusEditDates, onCensusDelete, onSelectCensus } = renderOverviewWithEditDates([EARLIER_ACTIVE, LATEST_ACTIVE]);
    await user.click(menuTrigger(EARLIER_ACTIVE.plotCensusNumber));
    await user.click(await screen.findByRole('menuitem', { name: EDIT_DATES_ITEM_NAME }));

    console.log(`[edit census dates] onCensusEditDates=${onCensusEditDates.mock.calls.length} onSelectCensus=${onSelectCensus.mock.calls.length}`);
    expect(onCensusEditDates).toHaveBeenCalledTimes(1);
    expect(onCensusEditDates).toHaveBeenCalledWith(EARLIER_ACTIVE);
    expect(onCensusDelete).not.toHaveBeenCalled();
    expect(onSelectCensus).not.toHaveBeenCalled();
  });

  it('leaves Edit census dates enabled for a non-admin while Delete stays admin-only', async () => {
    const user = userEvent.setup();
    renderOverviewWithEditDates([EARLIER_ACTIVE, LATEST_ACTIVE], 'field crew');
    await user.click(menuTrigger(LATEST_ACTIVE.plotCensusNumber));
    const editItem = await screen.findByRole('menuitem', { name: EDIT_DATES_ITEM_NAME });
    const deleteItem = screen.getByRole('menuitem', { name: DELETE_ITEM_NAME });
    console.log(`[edit census dates] field crew edit: ${describeItem(editItem)} delete: ${describeItem(deleteItem)}`);
    expect(editItem).not.toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).toHaveTextContent(CENSUS_DELETE_ADMIN_ONLY_REASON);
  });
});
