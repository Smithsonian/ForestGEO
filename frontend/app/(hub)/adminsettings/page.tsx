'use client';

import { Box } from '@mui/joy';

export default function AdminSettingsPage() {
  // admin settings page should have user control, site control, plot control, and assignment control
  // user control: CRUD users --> catalog.users --> datagrid
  // site control: CRUD sites --> catalog.sites
  // assignment control: CRUD users<->sites --> catalog.usersiterelations
  // plot control: site control --> CRUD plots --> catalog.sites --> [site.schemaName].plots
  return <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', width: '100%' }}></Box>;
}
