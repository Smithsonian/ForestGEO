import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PublishBlockerCallout from './publishblockercallout';
import { BLOCKER_FIX_HINTS, CENSUS_OVERVIEW_TEXT, formatBlockerRowCount, type CensusOverviewSummary } from '@/config/censusoverview';

const CALLOUT_TEST_ID = 'census-overview-blocker-callout';
const BLOCKER_ROW_TEST_ID = 'census-overview-blocker-row';
const BLOCKER_COUNT_TEST_ID = 'census-overview-blocker-count';
const UNKNOWN_ATTRIBUTE_ROWS = 3;

const BLOCKERS: CensusOverviewSummary['blockers'] = [
  { kind: 'unknown-attribute-code', count: UNKNOWN_ATTRIBUTE_ROWS },
  { kind: 'zero-exportable-rows', count: null }
];

function blockerRow(label: string): HTMLElement {
  const row = within(screen.getByTestId(CALLOUT_TEST_ID)).getByText(label).closest(`[data-testid="${BLOCKER_ROW_TEST_ID}"]`);
  if (!row) throw new Error(`No blocker row for "${label}"`);
  return row as HTMLElement;
}

describe('PublishBlockerCallout', () => {
  it('renders nothing when nothing blocks a publish', () => {
    const { container } = render(<PublishBlockerCallout blockers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names every blocker with its fix hint; only row-level kinds carry a row count', () => {
    render(<PublishBlockerCallout blockers={BLOCKERS} />);
    expect(screen.getByText(CENSUS_OVERVIEW_TEXT.blockerCalloutTitle)).toBeInTheDocument();

    const attributeRow = blockerRow(BLOCKER_FIX_HINTS['unknown-attribute-code'].label);
    console.log(`[option A blockers] attribute row "${attributeRow.textContent}"`);
    expect(within(attributeRow).getByText(BLOCKER_FIX_HINTS['unknown-attribute-code'].hint)).toBeInTheDocument();
    expect(within(attributeRow).getByTestId(BLOCKER_COUNT_TEST_ID)).toHaveTextContent(formatBlockerRowCount(UNKNOWN_ATTRIBUTE_ROWS));

    const emptyRow = blockerRow(BLOCKER_FIX_HINTS['zero-exportable-rows'].label);
    expect(within(emptyRow).getByText(BLOCKER_FIX_HINTS['zero-exportable-rows'].hint)).toBeInTheDocument();
    expect(within(emptyRow).queryByTestId(BLOCKER_COUNT_TEST_ID)).toBeNull();
  });
});
