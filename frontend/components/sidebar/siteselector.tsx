/**
 * Site Selector Component
 *
 * Handles site selection in the sidebar
 * Uses Zustand store for state management
 */

'use client';

import { Select, Option, Typography, Stack, SelectOption } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';
import { Site } from '@/config/sqlrdsdefinitions/zones';

export default function SiteSelector() {
  const currentSite = useAppStore(state => state.currentSite);
  const siteList = useAppStore(state => state.siteList);
  const setSite = useAppStore(state => state.setSite);

  const renderSiteValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return (
        <Typography data-testid="pending-site-select" level="body-lg" className="sidebar-item">
          Select a Site
        </Typography>
      );
    }

    const selectedValue = option.value;
    const selectedSite = siteList?.find(s => s?.siteName === selectedValue);

    if (!selectedSite) {
      return (
        <Typography level="body-lg" className="sidebar-item" data-testid="pending-site-select">
          Select a Site
        </Typography>
      );
    }

    return (
      <Stack direction="column" alignItems="start" aria-label="site value render stack">
        <Typography id="site-selected" level="body-lg" className="sidebar-item" data-testid="selected-site-name">
          Site: {selectedSite.siteName}
        </Typography>
        <Stack direction="column" alignItems="start" aria-labelledby="site-selected">
          <Typography level="body-sm" color="primary" className="sidebar-item" data-testid="selected-site-schema">
            &mdash; Schema: {selectedSite.schemaName}
          </Typography>
        </Stack>
      </Stack>
    );
  };

  const handleSiteChange = async (_event: React.SyntheticEvent | null, selectedSiteName: string | null) => {
    if (selectedSiteName === '' || selectedSiteName === null) {
      setSite(undefined);
    } else {
      const selected = siteList?.find(s => s?.siteName === selectedSiteName);
      setSite(selected as Site);
    }
  };

  return (
    <Select
      suppressHydrationWarning
      placeholder="Select a Site. Required"
      className="site-select sidebar-item"
      name="None"
      required
      size="md"
      renderValue={renderSiteValue}
      value={currentSite?.siteName || ''}
      onChange={handleSiteChange}
      data-testid="site-select-component"
      aria-label="Select a Site. Required field for accessing measurement tools"
    >
      {Array.isArray(siteList) &&
        siteList.map(site => (
          <Option
            aria-label={`Site: ${site?.siteName}, Schema: ${site?.schemaName}`}
            data-testid="site-selection-option"
            key={site?.siteID}
            value={site?.siteName}
          >
            <Stack direction="column" alignItems="start" className="sidebar-item">
              <Typography level="body-lg" data-testid="site-selection-option-name">
                {site?.siteName}
              </Typography>
              <Typography level="body-sm" color="neutral">
                Schema: {site?.schemaName}
              </Typography>
            </Stack>
          </Option>
        ))}
    </Select>
  );
}
