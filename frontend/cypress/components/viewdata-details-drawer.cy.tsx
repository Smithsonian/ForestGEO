import React from 'react';
import ErrorRowDetailsPanel from '@/components/errors/errorrowdetailspanel';
import { ERROR_DETAILS_SHEET_WIDTH } from '@/config/errorsexplorer';

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const SUBPIXEL_TOLERANCE_PX = 0.5;

function mountPanel() {
  cy.mount(
    <ErrorRowDetailsPanel
      open
      row={{
        measurementID: 501,
        treeTag: '010203',
        stemTag: '1',
        quadratName: '0102',
        speciesCode: 'ACRU',
        measurementDate: '2024-06-03',
        isLinkedToStem: true,
        markedInvalidWithoutLoggedError: true
      }}
      errorDetails={null}
      status="ready"
      onRetry={() => undefined}
      onClose={() => undefined}
      canOpenRelatedRow={() => true}
      onOpenRelatedRow={() => undefined}
      measurementSection={<div data-testid="measurement-section">Measurement</div>}
      footerActions={<button type="button">Delete</button>}
    />
  );
}

describe('View Data details drawer', () => {
  it('is full width at 375 px', () => {
    cy.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mountPanel();
    cy.get('[role="dialog"]').then($dialog => {
      const width = $dialog[0].getBoundingClientRect().width;
      cy.log(`drawer width ${width}`);
      expect(Math.abs(width - PHONE_VIEWPORT.width)).to.be.at.most(SUBPIXEL_TOLERANCE_PX);
    });
  });

  it('is the sheet width at 1440 px', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountPanel();
    cy.get('[role="dialog"]').then($dialog => {
      expect(Math.abs($dialog[0].getBoundingClientRect().width - ERROR_DETAILS_SHEET_WIDTH)).to.be.at.most(SUBPIXEL_TOLERANCE_PX);
    });
  });
});
