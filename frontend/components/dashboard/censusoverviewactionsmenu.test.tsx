import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event';
import CensusOverviewActionsMenu, { CENSUS_OVERVIEW_DELETE_ITEM_TEST_ID } from './censusoverviewactionsmenu';
import { CENSUS_OVERVIEW_TEXT } from '@/config/censusoverview';
import { CENSUS_DELETE_LATEST_ONLY_REASON } from '@/config/censusdeletion';

vi.mock('@/ailogger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const SCHEMA = 'forestgeo_test';
const REBUILD_DIALOG_ACTION = /download rebuild artifact/i;

function renderMenu(deleteBlockReason: string | null = null) {
  const onDelete = vi.fn();
  render(<CensusOverviewActionsMenu schema={SCHEMA} deleteBlockReason={deleteBlockReason} onDelete={onDelete} />);
  return { onDelete, user: userEvent.setup() };
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: CENSUS_OVERVIEW_TEXT.moreActionsLabel }));
  const items = await screen.findAllByRole('menuitem');
  console.log(`[option A actions menu] items ${JSON.stringify(items.map(item => `${item.textContent} aria-disabled=${item.getAttribute('aria-disabled')}`))}`);
  return items;
}

describe('CensusOverviewActionsMenu', () => {
  it('lists Rebuild ViewFullTable, then Delete census', async () => {
    const { user } = renderMenu();
    const items = await openMenu(user);
    expect(items.map(item => item.textContent)).toEqual([CENSUS_OVERVIEW_TEXT.rebuildViewFullTableAction, CENSUS_OVERVIEW_TEXT.deleteCensusAction]);
  });

  it('opens the rebuild dialog from the menu', async () => {
    const { user } = renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole('menuitem', { name: CENSUS_OVERVIEW_TEXT.rebuildViewFullTableAction }));
    expect(await screen.findByRole('button', { name: REBUILD_DIALOG_ACTION })).toBeInTheDocument();
  });

  it('calls onDelete when deletion is allowed', async () => {
    const { user, onDelete } = renderMenu();
    await openMenu(user);
    const deleteItem = screen.getByTestId(CENSUS_OVERVIEW_DELETE_ITEM_TEST_ID);
    expect(deleteItem).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(deleteItem);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('disables Delete census and shows why when deletion is blocked', async () => {
    const { user, onDelete } = renderMenu(CENSUS_DELETE_LATEST_ONLY_REASON);
    await openMenu(user);
    const deleteItem = screen.getByTestId(CENSUS_OVERVIEW_DELETE_ITEM_TEST_ID);
    expect(deleteItem).toHaveAttribute('aria-disabled', 'true');
    expect(deleteItem).toHaveTextContent(CENSUS_DELETE_LATEST_ONLY_REASON);
    // Joy sets pointer-events: none on a disabled item; force the click to prove onDelete still isn't reached.
    await userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never }).click(deleteItem);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
