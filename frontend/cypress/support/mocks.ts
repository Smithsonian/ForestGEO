// cypress/support/mocks.ts

import * as nextAuthReact from 'next-auth/react';
import { PlotRDS, SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensusRDS } from '@/config/sqlrdsdefinitions/timekeeping';
import * as userContext from '@/app/contexts/userselectionprovider';
import * as lockAnimationContext from '@/app/contexts/lockanimationcontext';

const testSite1: SitesRDS = {
  siteName: 'Test Site 1',
  schemaName: 'site1'
};

const testSite2: SitesRDS = {
  siteName: 'Test Site 2',
  schemaName: 'site2'
};

const testPlot: PlotRDS = {
  plotID: 1,
  plotName: 'Test Plot'
};

const testCensus: OrgCensusRDS = {
  censusIDs: [],
  dateRanges: [],
  description: '',
  plotID: 1,
  plotCensusNumber: 1
};

export function mockUseSession(overrides = {}) {
  cy.stub(nextAuthReact, 'useSession').returns({
    data: {
      user: {
        name: 'J Doe',
        email: 'jdoe@forestgeo.org',
        userStatus: 'db admin',
        sites: [testSite1, testSite2],
        ...overrides
      }
    }
  });
}

export function mockUserContexts(site = testSite1, plot = testPlot, census = testCensus) {
  cy.stub(userContext, 'useSiteContext').returns(site);
  cy.stub(userContext, 'usePlotContext').returns(plot);
  cy.stub(userContext, 'useOrgCensusContext').returns(census);
}

export function mockLockAnimationContext() {
  cy.stub(lockAnimationContext, 'useLockAnimation').returns({
    triggerPulse: cy.stub().as('triggerPulse'),
    isPulsing: false
  });
}

export function mockApiResponses() {
  cy.intercept('GET', '/api/changelog/**', { fixture: 'changelog.json' }).as('getChangelog');
}

export function mockAilogger() {
  // Create a global mock for ailogger
  const mockLogger = {
    error: cy.stub().as('ailogger-error'),
    info: cy.stub().as('ailogger-info'),
    warn: cy.stub().as('ailogger-warn'),
    debug: cy.stub().as('ailogger-debug'),
    critical: cy.stub().as('ailogger-critical'),
    event: cy.stub().as('ailogger-event'),
    metric: cy.stub().as('ailogger-metric')
  };
  
  // Add to window so it can be accessed by the component
  cy.window().then((win) => {
    (win as any).mockAilogger = mockLogger;
  });
  
  return mockLogger;
}
