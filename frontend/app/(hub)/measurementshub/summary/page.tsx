import MeasurementsSummaryViewDataGrid from '@/components/datagrids/applications/msvdatagrid';

interface SummaryPageProps {
  searchParams: Promise<{ openFailed?: string | string[] }>;
}

export default async function SummaryPage({ searchParams }: SummaryPageProps) {
  // Entry point for "fix your failed uploads" links (e.g. from the Errors
  // Explorer): /measurementshub/summary?openFailed=1 lands with the Failed
  // Measurements modal already open. Closing it strips the query so a page
  // refresh does not re-open the modal.
  const { openFailed } = await searchParams;
  const shouldOpenFailedMeasurements = openFailed === '1';

  return (
    <MeasurementsSummaryViewDataGrid
      autoOpenFailedMeasurements={shouldOpenFailedMeasurements}
      failedMeasurementsCloseRedirectHref={shouldOpenFailedMeasurements ? '/measurementshub/summary' : undefined}
    />
  );
}
