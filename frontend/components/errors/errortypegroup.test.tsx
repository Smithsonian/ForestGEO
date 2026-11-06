import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  EDIT_LOCK_TOOLTIPS,
  ERROR_TYPE_GROUP_INITIAL_LIMIT,
  FALLBACK_ERROR_CODE,
  FALLBACK_ERROR_MESSAGE,
  VIEW_ERRORS_TEXT,
  type ErrorTypeFacet
} from '@/config/errorsexplorer';
import ErrorTypeGroup, { type ErrorTypeGroupProps } from './errortypegroup';
import ErrorTypeGroupList from './errortypegrouplist';

const gridMounts: string[] = [];
vi.mock('./errorsexplorergrid', () => ({
  default: (props: { gridKey: string; ariaLabel: string; errorType: { code: string } }) => {
    gridMounts.push(props.gridKey);
    return <div data-testid={`grid-${props.errorType.code}`} aria-label={props.ariaLabel} />;
  }
}));

const DIFFERENT_SPECIES: ErrorTypeFacet = {
  source: 'validation',
  code: '7',
  message: 'Flagged;Different species',
  fields: ['stemTag', 'speciesCode'],
  count: 3,
  hasContradiction: true
};
const ATTRIBUTE: ErrorTypeFacet = {
  source: 'validation',
  code: '14',
  message: 'Attribute code does not exist in attributes table',
  fields: ['attributes'],
  count: 2,
  hasContradiction: false
};
const FALLBACK: ErrorTypeFacet = {
  source: 'ingestion',
  code: FALLBACK_ERROR_CODE,
  message: FALLBACK_ERROR_MESSAGE,
  fields: [],
  count: 1,
  hasContradiction: false
};
const ACTIVE = 88;

function renderGroup(overrides: Partial<ErrorTypeGroupProps> = {}) {
  const props = {
    facet: ATTRIBUTE,
    gridKey: 'group:attr',
    expanded: false,
    onToggle: vi.fn(),
    collapseDisabledReason: null,
    activeMeasurements: ACTIVE,
    gridProps: {} as ErrorTypeGroupProps['gridProps'],
    ...overrides
  } satisfies ErrorTypeGroupProps;
  render(<ErrorTypeGroup {...props} />);
  return props;
}

describe('ErrorTypeGroup', () => {
  it('heads the section with a labelled, expandable button inside an h2', () => {
    renderGroup({ facet: DIFFERENT_SPECIES });
    const heading = screen.getByRole('heading', { level: 2 });
    const toggle = within(heading).getByRole('button');
    console.log('[view-errors group header]', toggle.textContent);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Different species');
    expect(toggle).not.toHaveTextContent('Flagged;');
    expect(within(toggle).getByText(VIEW_ERRORS_TEXT.validationChip)).toBeInTheDocument();
    expect(within(toggle).getByText(VIEW_ERRORS_TEXT.contradictionChip)).toBeInTheDocument();
    expect(toggle).toHaveTextContent('3 rows · 3.4%');
  });

  it('shows no source chip for the fallback identity (D-h)', () => {
    renderGroup({ facet: FALLBACK });
    const toggle = within(screen.getByRole('heading', { level: 2 })).getByRole('button');
    expect(toggle).toHaveTextContent('Marked invalid, no error logged');
    expect(within(toggle).queryByText(VIEW_ERRORS_TEXT.ingestionChip)).toBeNull();
  });

  it('shows the hint while collapsed and mounts no grid', () => {
    gridMounts.length = 0;
    renderGroup();
    expect(screen.getByText(/aren't defined for this site/)).toBeInTheDocument();
    expect(screen.queryByTestId('grid-14')).toBeNull();
    expect(gridMounts).toEqual([]);
  });

  it('mounts its grid with the group label when expanded', () => {
    renderGroup({ expanded: true });
    expect(screen.getByTestId('grid-14')).toHaveAttribute('aria-label', 'Attribute code does not exist in attributes table rows');
  });

  it('disables collapsing, not expanding, while its grid owns the lock', async () => {
    const onToggle = vi.fn();
    renderGroup({ expanded: true, collapseDisabledReason: EDIT_LOCK_TOOLTIPS.editing, onToggle });
    const toggle = within(screen.getByRole('heading', { level: 2 })).getByRole('button');
    expect(toggle).toBeDisabled();
    await userEvent.hover(toggle.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(EDIT_LOCK_TOOLTIPS.editing);
  });

  it('points aria-controls at the panel with one space-free id even when the grid key is JSON with spaces', () => {
    const gridKeyWithSpaces = JSON.stringify({ source: 'validation', code: '14', message: ATTRIBUTE.message });
    renderGroup({ expanded: true, gridKey: gridKeyWithSpaces });
    const toggle = within(screen.getByRole('heading', { level: 2 })).getByRole('button');
    const controlsIdref = toggle.getAttribute('aria-controls');
    console.log('[view-errors group panel id]', { gridKeyWithSpaces, controlsIdref });
    expect(controlsIdref).toBeTruthy();
    expect(controlsIdref).not.toMatch(/\s/);
    const panel = screen.getByTestId('grid-14').parentElement as HTMLElement;
    expect(panel.id).toBe(controlsIdref);
  });

  it('calls onToggle from the header button', async () => {
    const props = renderGroup();
    await userEvent.click(within(screen.getByRole('heading', { level: 2 })).getByRole('button'));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorTypeGroupList', () => {
  const MANY: ErrorTypeFacet[] = Array.from({ length: ERROR_TYPE_GROUP_INITIAL_LIMIT + 2 }, (_, index) => ({
    ...ATTRIBUTE,
    code: `C${index}`,
    count: 20 - index
  }));

  it('lists the first ten, then reveals the rest, with the footnote', async () => {
    render(
      <ErrorTypeGroupList
        errorTypes={MANY}
        renderGroup={facet => <div key={facet.code} data-testid="group" />}
        exactMessages={[]}
        onClearExactMessages={vi.fn()}
        clearDisabledReason={null}
      />
    );
    expect(screen.getAllByTestId('group')).toHaveLength(ERROR_TYPE_GROUP_INITIAL_LIMIT);
    expect(screen.getByText(VIEW_ERRORS_TEXT.footnote)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show 2 more error types' }));
    expect(screen.getAllByTestId('group')).toHaveLength(ERROR_TYPE_GROUP_INITIAL_LIMIT + 2);
  });

  it('shows the Filtered-to chip with the display label and clears it', async () => {
    const onClear = vi.fn();
    render(
      <ErrorTypeGroupList
        errorTypes={[DIFFERENT_SPECIES]}
        renderGroup={() => null}
        exactMessages={['Flagged;Different species']}
        onClearExactMessages={onClear}
        clearDisabledReason={null}
      />
    );
    expect(screen.getByText(`${VIEW_ERRORS_TEXT.filteredToPrefix} Different species`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.removeFilter }));
    expect(onClear).toHaveBeenCalled();
  });

  it('disables the chip remove icon while locked', () => {
    render(
      <ErrorTypeGroupList
        errorTypes={[DIFFERENT_SPECIES]}
        renderGroup={() => null}
        exactMessages={['Flagged;Different species']}
        onClearExactMessages={vi.fn()}
        clearDisabledReason={EDIT_LOCK_TOOLTIPS.editing}
      />
    );
    expect(screen.getByRole('button', { name: VIEW_ERRORS_TEXT.removeFilter })).toBeDisabled();
  });
});
