'use client';

import { Alert, Typography } from '@mui/joy';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RenderGridFormExplanations from '@/components/client/rendergridformexplanations';
import ViewFullTableDataGrid from '@/components/datagrids/applications/viewfulltabledatagrid';
import { DatagridType } from '@/config/macros/formdetails';

export default function ViewFullTablePage() {
  return (
    <>
      <RenderGridFormExplanations datagridType={DatagridType.viewfulltable} />
      <Alert color="neutral" variant="soft" startDecorator={<InfoOutlinedIcon />} data-testid="viewfulltable-readonly-banner" sx={{ mb: 1 }}>
        <Typography level="body-sm">
          Read-only archive. To edit measurements, use the <strong>View Data</strong> page; to fix ingestion or validation errors, use{' '}
          <strong>View Errors</strong>.
        </Typography>
      </Alert>
      <ViewFullTableDataGrid />
    </>
  );
}
