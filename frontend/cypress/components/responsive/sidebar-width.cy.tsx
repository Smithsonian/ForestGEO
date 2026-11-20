import React from 'react';
import Sidebar from '@/components/sidebar';
import { useAppStore } from '@/config/store/appstore';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';
import type { PlotRDS, SitesRDS } from '@/lib/db/definitions/zones';
import { setMockSession } from '../../mocks/nextauthmock';
import { mountInAppTheme } from './support';

const VIEWPORTS = [
  { width: 900, height: 800 },
  { width: 1280, height: 800 }
] as const;
const CLIPPING_TOLERANCE_PX = 1;
const MIN_LONG_NAME_LENGTH = 40;
const API_PATTERN = '**/api/**';
const SIDEBAR_SELECTOR = 'nav#side-navigation';
const NAVIGATION_CONTROL_SELECTOR = `${SIDEBAR_SELECTOR} a, ${SIDEBAR_SELECTOR} button`;
const MIN_EXPECTED_NAVIGATION_CONTROLS = 5;

const LONG_SITE: SitesRDS = {
  siteID: 1,
  siteName: 'Smithsonian Conservation Biology Institute Large Forest Dynamics Plot',
  schemaName: 'forestgeo_smithsonian_conservation_biology_institute'
};
const LONG_PLOT: PlotRDS = { id: 1, plotID: 1, plotName: 'Northern Ridge Long-Term Forest Dynamics Plot Extension', numQuadrats: 1250 };
const CENSUS: OrgCensusRDS = {
  plotID: 1,
  plotCensusNumber: 3,
  censusIDs: [5],
  dateRanges: [
    {
      censusID: 5,
      censusStartDate: new Date('2024-01-15'),
      censusEndDate: new Date('2024-12-20'),
      firstMeasurementDate: new Date('2024-02-01'),
      lastMeasurementDate: new Date('2024-11-30')
    }
  ],
  description: 'Third full census of the northern ridge extension, including recruits',
  isActive: true
};

function seedSiteWithLongNames() {
  [LONG_SITE.siteName, LONG_SITE.schemaName, LONG_PLOT.plotName].forEach(name =>
    expect(name, 'seeded name is long').to.have.length.of.at.least(MIN_LONG_NAME_LENGTH)
  );
  setMockSession({
    data: { user: { name: 'Layout Tester', email: 'layout.tester@example.org', userStatus: 'global', sites: [LONG_SITE] } },
    status: 'authenticated'
  });
  useAppStore.setState({
    currentSite: LONG_SITE,
    currentPlot: LONG_PLOT,
    currentCensus: CENSUS,
    siteList: [LONG_SITE],
    plotList: [LONG_PLOT],
    censusList: [CENSUS]
  });
}

describe('Sidebar width', () => {
  VIEWPORTS.forEach(({ width, height }) => {
    it(`clips no navigation label or selector value at ${width}px`, () => {
      cy.viewport(width, height);
      cy.intercept(API_PATTERN, { body: {} });
      seedSiteWithLongNames();
      mountInAppTheme(<Sidebar siteListLoaded coreDataLoaded setCensusListLoaded={() => undefined} />);

      cy.get('[data-testid="selected-site-name"]').should('contain.text', LONG_SITE.siteName);
      cy.get('[data-testid="selected-plot-name"]').should('contain.text', LONG_PLOT.plotName);
      cy.get('[data-testid="selected-census-plotcensusnumber"]').should('contain.text', String(CENSUS.plotCensusNumber));
      cy.get(SIDEBAR_SELECTOR).then($sidebar => cy.log(`sidebar width at ${width}px viewport: ${$sidebar[0].getBoundingClientRect().width}px`));
      cy.get(NAVIGATION_CONTROL_SELECTOR)
        .should('have.length.at.least', MIN_EXPECTED_NAVIGATION_CONTROLS)
        .then($elements => {
          const clipped = $elements.toArray().flatMap(element => {
            const label = element.textContent?.trim() || element.getAttribute('aria-label') || '(no text)';
            const overflow = element.scrollWidth - element.clientWidth;
            return overflow > CLIPPING_TOLERANCE_PX ? [`"${label}" is clipped by ${overflow}px`] : [];
          });
          cy.log(`${$elements.length} controls measured, ${clipped.length} clipped`);
          expect(clipped, `clipped controls at ${width}px`).to.deep.equal([]);
        });
    });
  });
});
