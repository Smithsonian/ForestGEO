import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SpeciesLimitsModal from './specieslimitsmodal';
import type { SpeciesLimitsRDS, SpeciesRDS } from '@/lib/db/definitions/taxonomies';

const TEST_SPECIES: SpeciesRDS = { speciesID: 201, speciesName: 'berteriana', speciesCode: 'RUBI04' };
const TEST_LIMITS: SpeciesLimitsRDS[] = [{ speciesLimitID: 1, speciesID: 201, plotID: 1, censusID: 5, limitType: 'DBH', lowerBound: 5, upperBound: 60 }];
const LOWER_LIMIT_LABEL = 'Lower Limit';
const UPPER_LIMIT_LABEL = 'Upper Limit';

const TEST_CONTEXTS = vi.hoisted(() => ({
  site: { schemaName: 'testschema', siteName: 'Test Site' },
  plot: { plotID: 1, plotName: 'Test Plot', defaultDBHUnits: 'cm' },
  census: { plotCensusNumber: 5, dateRanges: [{ censusID: 5 }] }
}));

vi.mock('@/app/contexts/compat-hooks', () => ({
  useSiteContext: () => TEST_CONTEXTS.site,
  usePlotContext: () => TEST_CONTEXTS.plot,
  useOrgCensusContext: () => TEST_CONTEXTS.census
}));

function renderSpeciesLimitsModal(overrides: { setRefresh?: ReturnType<typeof vi.fn>; handleClose?: ReturnType<typeof vi.fn> } = {}) {
  const setRefresh = overrides.setRefresh ?? vi.fn();
  const handleCloseSpeciesLimitsModal = overrides.handleClose ?? vi.fn();
  render(
    <SpeciesLimitsModal
      openSpeciesLimitsModal
      handleCloseSpeciesLimitsModal={handleCloseSpeciesLimitsModal}
      incomingSpecies={TEST_SPECIES}
      allSpeciesLimits={TEST_LIMITS}
      setRefresh={setRefresh}
    />
  );
  return { setRefresh, handleCloseSpeciesLimitsModal };
}

describe('SpeciesLimitsModal - limit inputs (#524 item 4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names each limit input by its visible label', () => {
    renderSpeciesLimitsModal();

    const lowerInput = screen.queryByRole('spinbutton', { name: LOWER_LIMIT_LABEL });
    const upperInput = screen.queryByRole('spinbutton', { name: UPPER_LIMIT_LABEL });
    console.log(
      `[species limits labels] spinbuttons=${JSON.stringify(screen.queryAllByRole('spinbutton').map(input => ({ id: input.id, labelledBy: input.getAttribute('aria-labelledby') })))}`
    );

    expect(lowerInput, 'the lower-limit input must be named "Lower Limit", not by its own id').not.toBeNull();
    expect(upperInput, 'the upper-limit input must be named "Upper Limit", not by its own id').not.toBeNull();
    expect(screen.getByLabelText(LOWER_LIMIT_LABEL)).toBe(lowerInput);
    expect(screen.getByLabelText(UPPER_LIMIT_LABEL)).toBe(upperInput);
  });
});
