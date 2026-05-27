/**
 * Sites Overview Component
 *
 * Displays a read-only informational grid of sites the user has access to.
 * Users must use the sidebar to make selections - these cards are for display only.
 */

'use client';

import React from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack, Avatar } from '@mui/joy';
import { ContentSkeleton } from '@/components/loading';
import { SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import ForestIcon from '@mui/icons-material/Forest';
import ParkIcon from '@mui/icons-material/Park';
import LandscapeIcon from '@mui/icons-material/Landscape';
import PublicIcon from '@mui/icons-material/Public';
import GridViewIcon from '@mui/icons-material/GridView';
import StorageIcon from '@mui/icons-material/Storage';
import SettingsIcon from '@mui/icons-material/Settings';

// Rotating site icons for variety
const SITE_ICONS = [ForestIcon, ParkIcon, LandscapeIcon, PublicIcon];

// Gradient colors for site cards
const SITE_GRADIENTS = [
  'linear-gradient(135deg, #16a34a 0%, #15803d 100%)', // Forest green
  'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)', // Teal
  'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', // Purple
  'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)', // Orange
  'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)', // Blue
  'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)', // Red
  'linear-gradient(135deg, #65a30d 0%, #4d7c0f 100%)', // Lime
  'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)' // Cyan
];

interface SiteWithPlotCount extends SitesRDS {
  plotCount?: number;
}

export interface SitesOverviewProps {
  sites: SiteWithPlotCount[];
  isLoading?: boolean;
  onSelectSite?: (site: SiteWithPlotCount) => void;
}

function SiteCardSkeleton() {
  return <ContentSkeleton kind="dashboard-card" />;
}

interface SiteCardProps {
  site: SiteWithPlotCount;
  index: number;
  onSelect?: (site: SiteWithPlotCount) => void;
}

function SiteCard({ site, index, onSelect }: SiteCardProps) {
  const IconComponent = SITE_ICONS[index % SITE_ICONS.length];
  const gradient = SITE_GRADIENTS[index % SITE_GRADIENTS.length];

  return (
    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
    <Card
      component={onSelect ? 'div' : 'article'}
      variant="solid"
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-label={`Site: ${site.siteName}. Schema: ${site.schemaName}.${site.plotCount !== undefined ? ` ${site.plotCount} plots available.` : ''}${onSelect ? ' Click to select.' : ''}`}
      onClick={onSelect ? () => onSelect(site) : undefined}
      onKeyDown={
        onSelect
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(site);
              }
            }
          : undefined
      }
      sx={{
        background: `radial-gradient(circle at calc(100% + 30px) -30px, rgba(255,255,255,0.08) 0 60px, transparent 61px), radial-gradient(circle at 100% 0%, rgba(255,255,255,0.15) 0%, transparent 50%), ${gradient}`,
        color: 'white',
        minHeight: 180,
        overflow: 'hidden',
        border: 'none',
        ...(onSelect && {
          cursor: 'pointer',
          transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          '&:hover': {
            transform: 'translateY(-3px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
          }
        })
      }}
    >
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Avatar
            alt=""
            sx={{
              bgcolor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              width: 48,
              height: 48,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            <IconComponent sx={{ fontSize: 24 }} />
          </Avatar>

          {site.plotCount !== undefined && (
            <Chip
              size="sm"
              variant="soft"
              sx={{
                bgcolor: 'rgba(255,255,255,0.2)',
                color: 'white',
                backdropFilter: 'blur(4px)',
                fontWeight: 600
              }}
              startDecorator={<GridViewIcon sx={{ fontSize: 14 }} />}
            >
              {site.plotCount} {site.plotCount === 1 ? 'Plot' : 'Plots'}
            </Chip>
          )}
        </Box>

        <Typography
          level="h4"
          sx={{
            fontWeight: 700,
            mb: 0.5,
            textShadow: '0 2px 4px rgba(0,0,0,0.1)',
            fontSize: '1.125rem'
          }}
        >
          {site.siteName}
        </Typography>

        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1.5 }}>
          <StorageIcon sx={{ fontSize: 14, opacity: 0.9 }} />
          <Typography
            level="body-sm"
            sx={{
              color: 'rgba(255,255,255,0.9)',
              fontWeight: 500,
              fontSize: '0.8125rem'
            }}
          >
            {site.schemaName}
          </Typography>
        </Stack>

        <Box sx={{ mt: 'auto', display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          <Chip
            size="sm"
            variant="soft"
            sx={{
              bgcolor: 'rgba(0,0,0,0.15)',
              color: site.subquadratDimX !== undefined && site.subquadratDimY !== undefined ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)',
              fontSize: '0.6875rem',
              height: 'auto',
              py: 0.25,
              fontStyle: site.subquadratDimX !== undefined && site.subquadratDimY !== undefined ? 'normal' : 'italic'
            }}
            startDecorator={<GridViewIcon sx={{ fontSize: 10 }} />}
          >
            {site.subquadratDimX !== undefined && site.subquadratDimY !== undefined
              ? `${site.subquadratDimX}m x ${site.subquadratDimY}m`
              : 'Subquadrat size not set'}
          </Chip>

          <Chip
            size="sm"
            variant="soft"
            sx={{
              bgcolor: 'rgba(0,0,0,0.15)',
              color: site.doubleDataEntry !== undefined ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)',
              fontSize: '0.6875rem',
              height: 'auto',
              py: 0.25,
              fontStyle: site.doubleDataEntry !== undefined ? 'normal' : 'italic'
            }}
            startDecorator={<SettingsIcon sx={{ fontSize: 10 }} />}
          >
            {site.doubleDataEntry !== undefined ? (site.doubleDataEntry ? 'Double Entry' : 'Single Entry') : 'Entry mode not set'}
          </Chip>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function SitesOverview({ sites, isLoading = false, onSelectSite }: SitesOverviewProps) {
  if (isLoading) {
    return (
      <Box
        component="section"
        aria-label="Loading sites"
        aria-busy="true"
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
            xl: 'repeat(4, 1fr)'
          },
          gap: 2
        }}
      >
        {Array.from({ length: 8 }).map((_, index) => (
          <SiteCardSkeleton key={index} />
        ))}
      </Box>
    );
  }

  if (!sites || sites.length === 0) {
    return (
      <Card
        variant="outlined"
        sx={{
          textAlign: 'center',
          py: 6,
          px: 3
        }}
      >
        <Avatar
          alt=""
          sx={{
            width: 64,
            height: 64,
            bgcolor: 'neutral.softBg',
            color: 'neutral.solidBg',
            margin: '0 auto',
            mb: 2
          }}
        >
          <PublicIcon sx={{ fontSize: 32 }} />
        </Avatar>
        <Typography level="h4" sx={{ mb: 1 }}>
          No Sites Available
        </Typography>
        <Typography level="body-md" color="neutral">
          You don&apos;t have access to any sites yet. Please contact an administrator to request access.
        </Typography>
      </Card>
    );
  }

  return (
    <Box
      component="ul"
      aria-label="Available sites"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, 1fr)',
          lg: 'repeat(3, 1fr)',
          xl: 'repeat(4, 1fr)'
        },
        gap: 2,
        listStyle: 'none',
        padding: 0,
        margin: 0
      }}
    >
      {sites.map((site, index) => (
        <Box component="li" key={site.siteID ?? index}>
          <SiteCard site={site} index={index} onSelect={onSelectSite} />
        </Box>
      ))}
    </Box>
  );
}

export { SiteCard, SiteCardSkeleton };
