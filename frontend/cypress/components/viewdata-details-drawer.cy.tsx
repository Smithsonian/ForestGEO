import React from 'react';
import ErrorRowDetailsPanel from '@/components/errors/errorrowdetailspanel';
import LockedControl from '@/components/errors/lockedcontrol';
import Header from '@/components/header';
import { ERROR_DETAILS_SHEET_WIDTH } from '@/config/errorsexplorer';

const PHONE_VIEWPORT = { width: 375, height: 667 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const SUBPIXEL_TOLERANCE_PX = 0.5;
const LOCKED_CONTROL_TEST_ID = 'locked-delete-control';
const LOCK_REASON = 'Open this row on its page to delete it';

function mountPanel({ withAppHeader = false, lockReason = null }: { withAppHeader?: boolean; lockReason?: string | null } = {}) {
  cy.mount(
    <>
      {withAppHeader && <Header />}
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
        footerActions={
          <LockedControl reason={lockReason} testID={LOCKED_CONTROL_TEST_ID}>
            <button type="button" disabled={lockReason !== null}>
              Delete
            </button>
          </LockedControl>
        }
      />
    </>
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

  it('is not covered by the app header at 375 px: the Close button is the topmost element at its centre', () => {
    cy.viewport(PHONE_VIEWPORT.width, PHONE_VIEWPORT.height);
    mountPanel({ withAppHeader: true });
    cy.get('[role="banner"]').should('exist').and('have.css', 'position', 'fixed');
    cy.get('button[aria-label="Close details"]').then($closeButton => {
      const bounds = $closeButton[0].getBoundingClientRect();
      const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      cy.log(`close button top ${bounds.top}, topmost element ${topmost?.tagName} ${topmost?.getAttribute('aria-label') ?? ''}`);
      expect($closeButton[0].contains(topmost)).to.equal(true);
    });
  });

  it('is the sheet width at 1440 px', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountPanel();
    cy.get('[role="dialog"]').then($dialog => {
      expect(Math.abs($dialog[0].getBoundingClientRect().width - ERROR_DETAILS_SHEET_WIDTH)).to.be.at.most(SUBPIXEL_TOLERANCE_PX);
    });
  });

  it('shows a locked control explanation above the sheet: the tooltip is the topmost element at its centre', () => {
    cy.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
    mountPanel({ lockReason: LOCK_REASON });
    cy.get(`[data-testid="${LOCKED_CONTROL_TEST_ID}"]`).trigger('mouseover');
    cy.contains('[role="tooltip"]', LOCK_REASON)
      .should('be.visible')
      .then($tooltip => {
        // The themed tooltip sets pointer-events: none, which elementFromPoint skips; restoring it does not change stacking.
        $tooltip.css('pointer-events', 'auto');
        const bounds = $tooltip[0].getBoundingClientRect();
        const topmost = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        cy.log(`tooltip z-index ${getComputedStyle($tooltip[0]).zIndex}, topmost element ${topmost?.tagName} ${topmost?.getAttribute('role') ?? ''}`);
        expect($tooltip[0].contains(topmost), 'the tooltip is not covered by the drawer or its backdrop').to.equal(true);
      });
  });
});
