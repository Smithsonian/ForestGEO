'use client';

/**
 * E2E-ONLY errors-explorer harness. Mounts the real ErrorsExplorer with a fixed
 * site/plot/census context so the real-DB error-correction e2e spec
 * (cypress/e2e/column-mapping-realdb/resolve-and-remove.cy.ts) can drive the
 * genuine errors grid -> /api/edits/preview -> /api/edits/apply edit-plan journey
 * against the seeded local MySQL without navigating the entire site-selection
 * chain (which reads the cross-site `catalog` schema the local test DB never seeds).
 *
 * Sibling of app/e2e-upload-harness: same force-fed HARNESS_SCHEMA/plot/census, so
 * the errors an upload leaves behind in `forestgeo_testing` (plot 1 / census 1) are
 * exactly the scope ErrorsExplorer queries here. Only the context providers are
 * scaffolded; the errors read, the edit preview/apply, and the DB writes are all real.
 *
 * Hard-gated to NEXT_PUBLIC_E2E_TESTING === 'true' && NODE_ENV !== 'production' so it
 * never renders in a real deployment.
 */

import { useEffect, useState } from 'react';
import { Typography } from '@mui/joy';
import ErrorsExplorer from '@/components/errors/errorsexplorer';
import { useAppStore } from '@/config/store/appstore';
import type { Site, Plot } from '@/lib/db/definitions/zones';
import type { OrgCensusRDS } from '@/lib/db/definitions/timekeeping';

const isE2EHarnessEnabled = process.env.NEXT_PUBLIC_E2E_TESTING === 'true' && process.env.NODE_ENV !== 'production';

const HARNESS_SCHEMA = 'forestgeo_testing';

const HARNESS_SITE: Site = {
  siteID: 1,
  siteName: 'E2E Harness Site',
  schemaName: HARNESS_SCHEMA
};

const HARNESS_PLOT: Plot = {
  plotID: 1,
  plotName: 'E2E Harness Plot',
  usesSubquadrats: false
};

const HARNESS_CENSUS: OrgCensusRDS = {
  plotID: 1,
  plotCensusNumber: 1,
  censusIDs: [1],
  dateRanges: [{ censusID: 1, startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') }],
  description: 'E2E harness census'
};

export default function E2EErrorsHarnessPage() {
  const setSite = useAppStore(state => state.setSite);
  const setPlot = useAppStore(state => state.setPlot);
  const setCensus = useAppStore(state => state.setCensus);
  const [contextReady, setContextReady] = useState(false);

  useEffect(() => {
    if (!isE2EHarnessEnabled) {
      return;
    }
    setSite(HARNESS_SITE);
    setPlot(HARNESS_PLOT);
    setCensus(HARNESS_CENSUS);
    setContextReady(true);
  }, [setSite, setPlot, setCensus]);

  if (!isE2EHarnessEnabled) {
    return <Typography level="body-lg">Not available.</Typography>;
  }

  return (
    <div data-testid="e2e-errors-harness" style={{ width: '100%', padding: 16 }}>
      <Typography level="title-lg">E2E Errors Harness</Typography>
      {contextReady && <ErrorsExplorer />}
    </div>
  );
}
