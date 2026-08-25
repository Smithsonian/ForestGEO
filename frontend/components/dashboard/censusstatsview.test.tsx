/**
 * @fileoverview Component tests for CensusStatsView (UX finding F10)
 *
 * The census classification stats must never contradict each other. Specifically:
 * - When there is no previous census, "Old Trees" is not comparable and must render
 *   the placeholder '—' with an explanatory tooltip, NOT a misleading 0.
 * - On a first census, "New Recruits" carries a subtitle explaining every stem is
 *   newly recorded.
 * - When values are real numbers (subsequent census), they render as formatted
 *   numbers exactly as before.
 *
 * @see /components/dashboard/censusstatsview.tsx
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CensusStatsView, {
  CensusStatsViewProps,
  FIRST_CENSUS_RECRUITS_SUBTITLE,
  INCOMPARABLE_METRIC_PLACEHOLDER,
  INCOMPARABLE_METRIC_TOOLTIP
} from './censusstatsview';

const OLD_TREES_TILE_TITLE = 'Old Trees';
const NEW_RECRUITS_TILE_TITLE = 'New Recruits';
const MULTI_STEMS_TILE_TITLE = 'Multi-Stems';
const SUBSEQUENT_RECRUITS_SUBTITLE = 'First-time measurements';

function buildProps(overrides: Partial<CensusStatsViewProps> = {}): CensusStatsViewProps {
  return {
    countTrees: 100,
    countStems: 150,
    stemTypes: {
      CountOldStems: 0,
      CountMultiStems: 0,
      CountNewRecruits: 0,
      isFirstCensus: false
    },
    progressTacho: {
      TotalQuadrats: 10,
      PopulatedQuadrats: 5,
      PopulatedPercent: 50,
      UnpopulatedQuadrats: []
    },
    activeUsers: 3,
    ...overrides
  };
}

describe('CensusStatsView', () => {
  it('renders the placeholder for a null (incomparable) classification metric instead of a zero', () => {
    render(
      <CensusStatsView
        {...buildProps({
          stemTypes: { CountOldStems: null, CountMultiStems: 40, CountNewRecruits: 150, isFirstCensus: true }
        })}
      />
    );

    // The Old Trees tile has no previous census to compare against -> em-dash, not 0.
    expect(screen.getByText(OLD_TREES_TILE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(INCOMPARABLE_METRIC_PLACEHOLDER)).toBeInTheDocument();
  });

  it('exposes the explanatory tooltip when a classification metric is incomparable', async () => {
    const user = userEvent.setup();
    render(
      <CensusStatsView
        {...buildProps({
          stemTypes: { CountOldStems: null, CountMultiStems: 40, CountNewRecruits: 150, isFirstCensus: true }
        })}
      />
    );

    await user.hover(screen.getByText(INCOMPARABLE_METRIC_PLACEHOLDER));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(INCOMPARABLE_METRIC_TOOLTIP);
  });

  it('shows the first-census subtitle on the New Recruits tile when isFirstCensus is true', () => {
    render(
      <CensusStatsView
        {...buildProps({
          stemTypes: { CountOldStems: null, CountMultiStems: 40, CountNewRecruits: 150, isFirstCensus: true }
        })}
      />
    );

    expect(screen.getByText(NEW_RECRUITS_TILE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(FIRST_CENSUS_RECRUITS_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText(SUBSEQUENT_RECRUITS_SUBTITLE)).not.toBeInTheDocument();
  });

  it('renders real classification numbers (formatted) and the default subtitle for a subsequent census', () => {
    render(
      <CensusStatsView
        {...buildProps({
          stemTypes: { CountOldStems: 12000, CountMultiStems: 3400, CountNewRecruits: 560, isFirstCensus: false }
        })}
      />
    );

    // Numbers render with locale formatting; no placeholder appears.
    expect(screen.getByText('12,000')).toBeInTheDocument();
    expect(screen.getByText('3,400')).toBeInTheDocument();
    expect(screen.getByText('560')).toBeInTheDocument();
    expect(screen.queryByText(INCOMPARABLE_METRIC_PLACEHOLDER)).not.toBeInTheDocument();

    // Default subtitle (not the first-census message) for a subsequent census.
    expect(screen.getByText(SUBSEQUENT_RECRUITS_SUBTITLE)).toBeInTheDocument();
    expect(screen.queryByText(FIRST_CENSUS_RECRUITS_SUBTITLE)).not.toBeInTheDocument();
  });

  it('keeps a real zero as "0" for a comparable metric (only null becomes the placeholder)', () => {
    render(
      <CensusStatsView
        {...buildProps({
          stemTypes: { CountOldStems: 0, CountMultiStems: 5, CountNewRecruits: 20, isFirstCensus: false }
        })}
      />
    );

    // A genuine zero old-stems count on a subsequent census is a real value, shown as 0.
    expect(screen.getByText(MULTI_STEMS_TILE_TITLE)).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(INCOMPARABLE_METRIC_PLACEHOLDER)).not.toBeInTheDocument();
  });
});
