'use client';

/**
 * E2E-ONLY upload harness. Mounts the real measurements UploadParentModal with a
 * fixed site/plot/census context so column-mapping e2e specs can exercise the
 * genuine UploadParseFiles -> UploadFireSQL journey without navigating the entire
 * populated measurements summary grid (the only production entry point).
 *
 * Hard-gated to NEXT_PUBLIC_E2E_TESTING === 'true' && NODE_ENV !== 'production' so it
 * never renders in a real deployment.
 */

import { useEffect, useState } from 'react';
import { Typography } from '@mui/joy';
import UploadParentModal from '@/components/uploadsystemhelpers/uploadparentmodal';
import { FormType } from '@/config/macros/formdetails';
import { useAppStore } from '@/config/store/appstore';
import type { Site, Plot } from '@/config/sqlrdsdefinitions/zones';
import type { OrgCensusRDS } from '@/config/sqlrdsdefinitions/timekeeping';

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

export default function E2EUploadHarnessPage() {
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
    <div data-testid="e2e-upload-harness">
      <Typography level="title-lg">E2E Upload Harness</Typography>
      {contextReady && <UploadParentModal isUploadModalOpen handleCloseUploadModal={() => {}} formType={FormType.measurements} />}
    </div>
  );
}
