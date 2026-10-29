import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CensusStatTiles, { type CensusStatTilesProps } from './censusstattiles';
import { CENSUS_OVERVIEW_TEXT, TREES_AND_STEMS_ROWS, type CensusOverviewSummary } from '@/config/censusoverview';
import { FIRST_CENSUS_RECRUITS_SUBTITLE, INCOMPARABLE_METRIC_TOOLTIP } from './censusstatsview';

const TREES_TILE_TEST_ID = 'census-stat-tile-trees';
const STEMS_TILE_TEST_ID = 'census-stat-tile-stems';
const QUADRATS_TILE_TEST_ID = 'census-stat-tile-quadrats';
const ERRORS_TILE_TEST_ID = 'census-stat-tile-errors';
const TRUNCATED_LIST_LENGTH = 205;
const JOY_ROUNDED_QUADRAT_BAR_VALUE = '1';

const STEM_TYPES: CensusStatTilesProps['stemTypes'] = { CountOldStems: 70, CountMultiStems: 4, CountNewRecruits: 7, isFirstCensus: false };
const ERROR_OVERVIEW: CensusOverviewSummary['errorOverview'] = {
  affectedMeasurements: 21,
  totalActiveMeasurements: 88,
  topErrorTypes: [],
  remainingErrorTypeCount: 0
};

function renderTiles(props: Partial<CensusStatTilesProps> = {}) {
  render(
    <CensusStatTiles
      countTrees={73}
      countStems={77}
      stemTypes={STEM_TYPES}
      isMetricsLoading={false}
      quadrats={{ total: 625, populated: 4 }}
      errorOverview={ERROR_OVERVIEW}
      isErrorOverviewLoading={false}
      {...props}
    />
  );
}

function tileText(testId: string): string {
  const text = screen.getByTestId(testId).textContent ?? '';
  console.log(`[option A tiles] ${testId}: "${text}"`);
  return text;
}

describe('CensusStatTiles', () => {
  it('shows trees with stems per tree and the multi-stem tree count', () => {
    renderTiles();
    const tile = screen.getByTestId(TREES_TILE_TEST_ID);
    expect(within(tile).getByText(CENSUS_OVERVIEW_TEXT.treesTileLabel)).toBeInTheDocument();
    expect(within(tile).getByText('73')).toBeInTheDocument();
    expect(tileText(TREES_TILE_TEST_ID)).toContain('1.1 stems per tree · 4 multi-stem');
  });

  it('shows stems with the previously measured and new-recruit counts', () => {
    renderTiles();
    expect(within(screen.getByTestId(STEMS_TILE_TEST_ID)).getByText('77')).toBeInTheDocument();
    expect(tileText(STEMS_TILE_TEST_ID)).toContain('70 previously measured · 7 new recruits');
  });

  it('says there is no previous census instead of a confident zero when the comparison is unavailable', async () => {
    const user = userEvent.setup();
    renderTiles({ stemTypes: { ...STEM_TYPES, CountOldStems: null, isFirstCensus: true } });
    expect(tileText(STEMS_TILE_TEST_ID)).toContain('no previous census · 7 new recruits');

    await user.hover(screen.getByText(CENSUS_OVERVIEW_TEXT.noPreviousCensus));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(INCOMPARABLE_METRIC_TOOLTIP);
    await user.unhover(screen.getByText(CENSUS_OVERVIEW_TEXT.noPreviousCensus));

    await user.hover(screen.getByText('7 new recruits'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(FIRST_CENSUS_RECRUITS_SUBTITLE);
  });

  it('explains each stem classification in a tooltip', async () => {
    const user = userEvent.setup();
    renderTiles();
    await user.hover(screen.getByText('70 previously measured'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TREES_AND_STEMS_ROWS.previouslyMeasuredStems.description);
  });

  it('counts unmeasured quadrats as total minus populated, never from the truncated name list', () => {
    renderTiles({ quadrats: { total: 625, populated: 4 } });
    const text = tileText(QUADRATS_TILE_TEST_ID);
    expect(within(screen.getByTestId(QUADRATS_TILE_TEST_ID)).getByText('4')).toBeInTheDocument();
    expect(text).toContain('of 625');
    expect(text).toContain('0.6% · 621 not yet measured');
    expect(text, 'the GROUP_CONCAT-truncated list length must not leak into the tile').not.toContain(String(TRUNCATED_LIST_LENGTH));
    const barValue = within(screen.getByTestId(QUADRATS_TILE_TEST_ID)).getByRole('progressbar').getAttribute('aria-valuenow');
    console.log(`[option A tiles] quadrat bar aria-valuenow=${barValue}`);
    expect(barValue, 'Joy rounds 4/625 = 0.64% to 1; the truncated list would give 205/625 = 33').toBe(JOY_ROUNDED_QUADRAT_BAR_VALUE);
  });

  it('says the plot has no quadrats rather than dividing by zero', () => {
    renderTiles({ quadrats: { total: 0, populated: 0 } });
    expect(tileText(QUADRATS_TILE_TEST_ID)).toContain(CENSUS_OVERVIEW_TEXT.noQuadrats);
  });

  it('shows affected measurements against the active total in the errors tile', () => {
    renderTiles();
    const text = tileText(ERRORS_TILE_TEST_ID);
    expect(within(screen.getByTestId(ERRORS_TILE_TEST_ID)).getByText('21')).toBeInTheDocument();
    expect(text).toContain('of 88');
    expect(text).toContain('23.9% of active measurements');
  });

  it('shows a dash instead of a percent when there are no active measurements', () => {
    renderTiles({ errorOverview: { ...ERROR_OVERVIEW, affectedMeasurements: 3, totalActiveMeasurements: 0 } });
    expect(tileText(ERRORS_TILE_TEST_ID)).toContain('— of active measurements');
  });

  it('keeps the errors tile as a skeleton while the summary loads, and the other tiles show their counts', () => {
    renderTiles({ errorOverview: null, isErrorOverviewLoading: true });
    expect(screen.getByTestId(ERRORS_TILE_TEST_ID)).toBeInTheDocument();
    expect(within(screen.getByTestId(ERRORS_TILE_TEST_ID)).queryByText('21')).toBeNull();
    expect(within(screen.getByTestId(TREES_TILE_TEST_ID)).getByText('73')).toBeInTheDocument();
  });

  it('leaves the errors tile out when there is no summary to wait for', () => {
    renderTiles({ errorOverview: null, isErrorOverviewLoading: false });
    expect(screen.queryByTestId(ERRORS_TILE_TEST_ID)).toBeNull();
  });

  it('renders no counts while the metrics load', () => {
    renderTiles({ isMetricsLoading: true });
    for (const testId of [TREES_TILE_TEST_ID, STEMS_TILE_TEST_ID, QUADRATS_TILE_TEST_ID]) {
      expect(screen.getByTestId(testId).textContent, testId).not.toMatch(/\d/);
    }
  });
});
