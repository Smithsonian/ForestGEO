import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TreesAndStemsCard from './treesandstemscard';
import { FIRST_CENSUS_RECRUITS_SUBTITLE, INCOMPARABLE_METRIC_PLACEHOLDER, INCOMPARABLE_METRIC_TOOLTIP } from './censusstatsview';
import { TREES_AND_STEMS_ROWS } from '@/config/censusoverview';

const ROW_TEST_ID = 'trees-and-stems-row';
const DASHBOARD_OLD_STEMS_TITLE = 'Old Trees';
const SUBSEQUENT_CENSUS_STEM_TYPES = { CountOldStems: 11950, CountMultiStems: 1212, CountNewRecruits: 458, isFirstCensus: false };
const FIRST_CENSUS_STEM_TYPES = { CountOldStems: null, CountMultiStems: 40, CountNewRecruits: 150, isFirstCensus: true };

describe('TreesAndStemsCard', () => {
  it('shows trees, stems, stems per tree, and three rows labelled by their true unit', () => {
    render(<TreesAndStemsCard countTrees={12408} countStems={15932} stemTypes={SUBSEQUENT_CENSUS_STEM_TYPES} />);

    expect(screen.getByText('12,408')).toBeInTheDocument();
    expect(screen.getByText('15,932')).toBeInTheDocument();
    expect(screen.getByText('1.3 stems per tree')).toBeInTheDocument();
    const rows = screen.getAllByTestId(ROW_TEST_ID);
    console.log(
      '[#547 trees & stems] rows:',
      rows.map(row => row.textContent)
    );
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText(TREES_AND_STEMS_ROWS.previouslyMeasuredStems.label)).toBeInTheDocument();
    expect(within(rows[0]).getByText('11,950')).toBeInTheDocument();
    expect(within(rows[1]).getByText(TREES_AND_STEMS_ROWS.newRecruitStems.label)).toBeInTheDocument();
    expect(within(rows[1]).getByText('458')).toBeInTheDocument();
    expect(within(rows[2]).getByText(TREES_AND_STEMS_ROWS.multiStemTrees.label)).toBeInTheDocument();
    expect(within(rows[2]).getByText('1,212')).toBeInTheDocument();
    expect(screen.queryByText(DASHBOARD_OLD_STEMS_TITLE), 'the stem count must not be called trees').toBeNull();
  });

  it('shows the placeholder with its tooltip for previously measured stems on a first census', async () => {
    const user = userEvent.setup();
    render(<TreesAndStemsCard countTrees={100} countStems={150} stemTypes={FIRST_CENSUS_STEM_TYPES} />);

    expect(screen.getByText(FIRST_CENSUS_RECRUITS_SUBTITLE)).toBeInTheDocument();
    await user.hover(screen.getByText(INCOMPARABLE_METRIC_PLACEHOLDER));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(INCOMPARABLE_METRIC_TOOLTIP);
  });

  it('uses each row description as the label tooltip', async () => {
    const user = userEvent.setup();
    render(<TreesAndStemsCard countTrees={100} countStems={150} stemTypes={SUBSEQUENT_CENSUS_STEM_TYPES} />);

    await user.hover(screen.getByText(TREES_AND_STEMS_ROWS.multiStemTrees.label));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TREES_AND_STEMS_ROWS.multiStemTrees.description);
  });

  it('renders no counts while the metrics are loading', () => {
    render(<TreesAndStemsCard countTrees={12408} countStems={15932} stemTypes={SUBSEQUENT_CENSUS_STEM_TYPES} isLoading />);

    expect(screen.queryByText('12,408')).toBeNull();
    expect(screen.queryAllByTestId(ROW_TEST_ID)).toHaveLength(0);
  });
});
