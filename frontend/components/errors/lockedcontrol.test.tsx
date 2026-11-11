import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import LockedControl from './lockedcontrol';

const LOCK_REASON = "Save or cancel the row you're editing first";
const WRAPPER_TEST_ID = 'locked-control-wrapper';

describe('LockedControl (D-g: each disabled control says why)', () => {
  it('renders its child alone when there is no reason', () => {
    render(
      <LockedControl reason={null} testID={WRAPPER_TEST_ID}>
        <button type="button">Show</button>
      </LockedControl>
    );
    expect(screen.getByRole('button', { name: 'Show' })).toBeEnabled();
    expect(screen.queryByTestId(WRAPPER_TEST_ID)).toBeNull();
  });

  it('wraps a disabled child so hovering the wrapper shows the reason', async () => {
    render(
      <LockedControl reason={LOCK_REASON} testID={WRAPPER_TEST_ID}>
        <button type="button" disabled>
          Show
        </button>
      </LockedControl>
    );
    await userEvent.hover(screen.getByTestId(WRAPPER_TEST_ID));
    const tooltip = await screen.findByRole('tooltip');
    console.log('[view-errors locked control]', tooltip.textContent);
    expect(tooltip).toHaveTextContent(LOCK_REASON);
  });
});
