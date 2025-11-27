/**
 * Main Sidebar Component (New Architecture)
 *
 * Orchestrates all sidebar components with Zustand state management
 * This is a simplified version that uses the new decomposed components
 *
 * Note: This is Phase 1 - focused on selection components
 * Navigation menu integration will be added in Phase 2
 */

'use client';

import { Box, GlobalStyles, Avatar, Divider, Typography, Stack } from '@mui/joy';
import { useAppStore } from '@/config/store/appstore';
import { designTokens } from '@/config/design-tokens';
import SidebarContainer from './sidebarcontainer';
import SiteSelector from './siteselector';
import PlotSelector from './plotselector';
import CensusSelector from './censusselector';
import { RainbowIcon } from '@/styles/rainbowicon';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import { PlotLogo, CensusLogo } from '@/components/icons';
export default function NewSidebar() {
  const currentSite = useAppStore(state => state.currentSite);
  const currentPlot = useAppStore(state => state.currentPlot);
  const currentCensus = useAppStore(state => state.currentCensus);

  // Use constant sidebar width from design tokens
  const sidebarWidth = designTokens.sizes.sidebarMin;

  return (
    <SidebarContainer>
      <GlobalStyles
        styles={theme => ({
          ':root': {
            '--Sidebar-width': sidebarWidth,
            [theme.breakpoints.up('lg')]: {
              '--Sidebar-width': sidebarWidth
            }
          }
        })}
      />

      <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Header Section */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
          <Stack direction="column" sx={{ marginRight: '1em', width: '100%' }}>
            <Typography level="h1">
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ marginRight: 1.5 }}>
                  <RainbowIcon />
                </Box>
                ForestGEO
              </Box>
            </Typography>
          </Stack>

          <Divider orientation="horizontal" sx={{ my: 0.75, width: '100%' }} />

          {/* Site Selection */}
          <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid="site-selection-box">
            <Avatar sx={{ marginRight: 1 }} alt="site options icon">
              <TravelExploreIcon />
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <SiteSelector />
            </Box>
          </Box>

          {/* Plot Selection - Only show if site is selected */}
          {currentSite !== undefined && (
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid="plot-selection-box">
              <Avatar size="sm" sx={{ marginRight: 1 }} alt="plot options icon">
                <PlotLogo />
              </Avatar>
              <Box sx={{ flexGrow: 1, marginLeft: '0.5em' }}>
                <PlotSelector />
              </Box>
            </Box>
          )}

          {/* Census Selection - Only show if plot is selected */}
          {currentPlot !== undefined && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid="census-selection-box">
                <Avatar size="sm" sx={{ marginRight: 1 }} alt="census options icon">
                  <CensusLogo />
                </Avatar>
                <Box sx={{ flexGrow: 1, marginLeft: '0.5em' }}>
                  <CensusSelector />
                </Box>
              </Box>
              <Divider orientation="horizontal" sx={{ marginTop: 2, width: '100%' }} />
            </>
          )}
        </Box>

        {/* Navigation Menu Section */}
        {/* TODO: Add NavigationMenu component here in Phase 2 */}
        {currentCensus !== undefined && (
          <Box sx={{ mt: 2 }}>
            <Typography level="body-sm" color="neutral" sx={{ px: 2 }}>
              Navigation menu will be added here
            </Typography>
          </Box>
        )}
      </Box>
    </SidebarContainer>
  );
}
