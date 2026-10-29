import React from 'react';
import { Box } from '@mui/joy';
import CensusStatTiles from '@/components/dashboard/censusstattiles';
import CensusSummaryPanels from '@/components/dashboard/censussummarypanels';
import type { CensusOverviewSummary } from '@/config/censusoverview';

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1440, height: 1020 };
/** The hub layout pads its content column by Joy spacing 1 on each side and clips overflow. */
const HUB_CONTENT_PADDING_PX = 8;
const SUBPIXEL_TOLERANCE_PX = 0.5;
const CONTENT_TEST_ID = 'census-overview-narrow-content';
const SUMMARY_PANELS_TEST_ID = 'census-summary-panels';
const CARD_TEST_IDS = [
  'census-stat-tile-trees',
  'census-stat-tile-stems',
  'census-stat-tile-quadrats',
  'census-stat-tile-errors',
  'validation-errors-card',
  'publish-preview-card'
];
const LONG_ERROR_MESSAGE = 'DBH growth exceeds the maximum annual rate allowed for this species between consecutive censuses';

const SUMMARY: CensusOverviewSummary = {
  errorOverview: {
    affectedMeasurements: 21,
    totalActiveMeasurements: 88,
    topErrorTypes: [
      { message: LONG_ERROR_MESSAGE, count: 3 },
      { message: 'Attribute code does not exist in attributes table', count: 2 }
    ],
    remainingErrorTypeCount: 0
  },
  exportPreview: {
    totalActiveMeasurements: 88,
    exportableCount: 67,
    skippedCount: 21,
    skipReasons: [
      { kind: 'not-validated', count: 21 },
      { kind: 'missing-link', count: 4 }
    ],
    exportedWithUnresolvedErrorCount: 3
  },
  blockers: []
};

function mountOverviewSections() {
  cy.mount(
    <Box
      data-testid={CONTENT_TEST_ID}
      sx={{ width: '100%', boxSizing: 'border-box', px: `${HUB_CONTENT_PADDING_PX}px`, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 3 }}
    >
      <CensusStatTiles
        countTrees={73}
        countStems={77}
        stemTypes={{ CountOldStems: 70, CountMultiStems: 4, CountNewRecruits: 7, isFirstCensus: false }}
        isMetricsLoading={false}
        quadrats={{ total: 625, populated: 4 }}
        errorOverview={SUMMARY.errorOverview}
        isErrorOverviewLoading={false}
      />
      <CensusSummaryPanels summary={SUMMARY} />
    </Box>
  );
}

function contentBox(content: HTMLElement): { left: number; right: number } {
  const rect = content.getBoundingClientRect();
  return { left: rect.left + HUB_CONTENT_PADDING_PX, right: rect.right - HUB_CONTENT_PADDING_PX };
}

describe('Census Overview sections on a narrow screen', () => {
  it('keeps every tile and panel inside the content column at phone width', () => {
    cy.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mountOverviewSections();

    cy.get(`[data-testid="${CONTENT_TEST_ID}"]`).then($content => {
      const bounds = contentBox($content[0]);
      cy.log(`content column ${bounds.left}–${bounds.right}px`);
      for (const testId of CARD_TEST_IDS) {
        cy.get(`[data-testid="${testId}"]`).then($card => {
          const rect = $card[0].getBoundingClientRect();
          const report = `${testId}: left=${rect.left} right=${rect.right} width=${rect.width}; column ${bounds.left}–${bounds.right}`;
          cy.log(report);
          expect(rect.right, `${report} — the card overflows the column and the hub layout clips it`).to.be.at.most(bounds.right + SUBPIXEL_TOLERANCE_PX);
          expect(rect.left, report).to.be.at.least(bounds.left - SUBPIXEL_TOLERANCE_PX);
        });
      }
      cy.get(`[data-testid="${SUMMARY_PANELS_TEST_ID}"]`).then($panels => {
        const panels = $panels[0];
        cy.log(`summary panels scrollWidth=${panels.scrollWidth} clientWidth=${panels.clientWidth}`);
        expect(panels.scrollWidth, 'nothing inside the panels grid is wider than the grid').to.be.at.most(panels.clientWidth);
      });
    });
  });

  it('still puts the two panels side by side on a desktop screen', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountOverviewSections();

    cy.get('[data-testid="validation-errors-card"]').then($errors => {
      cy.get('[data-testid="publish-preview-card"]').then($publish => {
        const errorsRect = $errors[0].getBoundingClientRect();
        const publishRect = $publish[0].getBoundingClientRect();
        cy.log(`validation errors top=${errorsRect.top} right=${errorsRect.right}; publish preview top=${publishRect.top} left=${publishRect.left}`);
        expect(publishRect.top, 'both panels start on the same row').to.be.closeTo(errorsRect.top, SUBPIXEL_TOLERANCE_PX);
        expect(publishRect.left, 'the publish panel sits to the right of the errors panel').to.be.greaterThan(errorsRect.right);
      });
    });
  });
});
