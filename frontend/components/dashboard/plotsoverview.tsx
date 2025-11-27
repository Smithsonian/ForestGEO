/**
 * Plots Overview Component
 *
 * Displays a read-only informational grid of plots within the selected site.
 * Users must use the sidebar to make selections - these cards are for display only.
 */

'use client';

import React, { useMemo } from 'react';
import { Box, Card, CardContent, Typography, Chip, Stack, Avatar, Skeleton, Divider, IconButton } from '@mui/joy';
import { PlotRDS } from '@/config/sqlrdsdefinitions/zones';
import GridOnIcon from '@mui/icons-material/GridOn';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import StraightenIcon from '@mui/icons-material/Straighten';
import SquareFootIcon from '@mui/icons-material/SquareFoot';
import PublicIcon from '@mui/icons-material/Public';
import HeightIcon from '@mui/icons-material/Height';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';

// Gradient colors for plot cards - earthy/nature tones
const PLOT_GRADIENTS = [
  'linear-gradient(135deg, #059669 0%, #047857 100%)', // Emerald
  'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)', // Cyan
  'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)', // Indigo
  'linear-gradient(135deg, #ca8a04 0%, #a16207 100%)', // Yellow
  'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', // Sky
  'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)', // Violet
  'linear-gradient(135deg, #65a30d 0%, #4d7c0f 100%)', // Lime
  'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)' // Red
];

// Shape icons mapping
const SHAPE_ICONS: Record<string, React.ElementType> = {
  square: CropSquareIcon,
  rectangle: ViewModuleIcon,
  default: GridOnIcon
};

export interface PlotWithCensusCount extends PlotRDS {
  censusCount?: number;
  lastCensusDate?: Date;
}

export interface PlotsOverviewProps {
  plots: PlotWithCensusCount[];
  siteName?: string;
  isLoading?: boolean;
  onPlotEdit?: (plot: PlotWithCensusCount) => void;
  onAddPlot?: () => void;
}

function PlotCardSkeleton() {
  return (
    <Card
      variant="soft"
      sx={{
        minHeight: 200,
        background: 'linear-gradient(90deg, rgba(0,0,0,0.06) 25%, rgba(0,0,0,0.02) 50%, rgba(0,0,0,0.06) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        '@keyframes shimmer': {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' }
        }
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Skeleton variant="circular" width={44} height={44} />
          <Skeleton variant="rectangular" width={90} height={22} sx={{ borderRadius: 'sm' }} />
        </Box>
        <Skeleton variant="text" width="60%" height={24} sx={{ mb: 0.5 }} />
        <Skeleton variant="text" width="80%" height={18} sx={{ mb: 1.5 }} />
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
          <Skeleton variant="rectangular" width={70} height={20} sx={{ borderRadius: 'sm' }} />
          <Skeleton variant="rectangular" width={70} height={20} sx={{ borderRadius: 'sm' }} />
        </Box>
        <Skeleton variant="rectangular" width="100%" height={6} sx={{ borderRadius: 'sm' }} />
      </CardContent>
    </Card>
  );
}

interface PlotCardProps {
  plot: PlotWithCensusCount;
  index: number;
  onEdit?: (plot: PlotWithCensusCount) => void;
}

// Get grid size category based on quadrat count
function getGridSizeCategory(numQuadrats: number | undefined): { label: string; color: string; dots: number } {
  if (numQuadrats === undefined || numQuadrats === 0) {
    return { label: 'No Grid', color: 'rgba(255,255,255,0.4)', dots: 0 };
  }
  if (numQuadrats < 50) {
    return { label: 'Small', color: 'rgba(255,255,255,0.6)', dots: 4 }; // 2x2
  }
  if (numQuadrats < 200) {
    return { label: 'Medium', color: 'rgba(255,255,255,0.75)', dots: 9 }; // 3x3
  }
  if (numQuadrats < 500) {
    return { label: 'Large', color: 'rgba(255,255,255,0.85)', dots: 16 }; // 4x4
  }
  return { label: 'Very Large', color: 'rgba(255,255,255,0.95)', dots: 25 }; // 5x5
}

function PlotCard({ plot, index, onEdit }: PlotCardProps) {
  const gradient = PLOT_GRADIENTS[index % PLOT_GRADIENTS.length];
  const ShapeIcon = SHAPE_ICONS[plot.plotShape?.toLowerCase() ?? 'default'] || SHAPE_ICONS.default;

  // Get grid size category for visual indicator
  const gridSize = getGridSizeCategory(plot.numQuadrats);

  // Format area with appropriate units and conversion for readability
  const formatArea = () => {
    if (plot.area === undefined || plot.area === null) return null;
    const rawUnits = plot.defaultAreaUnits || 'ha';
    let area = Number(plot.area);
    let displayUnits = rawUnits;

    // Convert less common units to more readable formats
    // hm2 (hectometers squared) = 1 hectare
    // dam2 (decameters squared) = 100 m2, so 1 ha = 100 dam2
    if (rawUnits === 'hm2') {
      displayUnits = 'ha'; // hm2 is equivalent to hectares, just rename
    } else if (rawUnits === 'dam2') {
      area = area / 100; // Convert dam2 to hectares
      displayUnits = 'ha';
    } else if (rawUnits === 'm2' && area >= 10000) {
      area = area / 10000; // Convert m2 to hectares for large areas
      displayUnits = 'ha';
    }

    // Format with appropriate decimal places
    const formattedArea = area >= 100 ? Math.round(area).toLocaleString() : area.toFixed(area >= 10 ? 1 : 2);

    return `${formattedArea} ${displayUnits}`;
  };

  // Format dimensions - handle NULL values gracefully
  const formatDimensions = () => {
    if (plot.dimensionX === undefined || plot.dimensionX === null || plot.dimensionY === undefined || plot.dimensionY === null) return null;
    const units = plot.defaultDimensionUnits || 'm';
    // Format dimensions without excessive decimal places
    const dimX = Number(plot.dimensionX);
    const dimY = Number(plot.dimensionY);
    const formatDim = (d: number) => (Number.isInteger(d) ? d.toString() : d.toFixed(1));
    return `${formatDim(dimX)} x ${formatDim(dimY)} ${units}`;
  };

  return (
    <Card
      component="article"
      variant="solid"
      aria-label={`Plot: ${plot.plotName}.${plot.locationName ? ` Location: ${plot.locationName}.` : ''}${plot.numQuadrats !== undefined ? ` ${plot.numQuadrats} quadrats.` : ''}`}
      sx={{
        background: gradient,
        color: 'white',
        minHeight: 200,
        position: 'relative',
        overflow: 'hidden',
        border: 'none',

        // Decorative gradient overlay
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 40%, rgba(0,0,0,0.1) 100%)',
          pointerEvents: 'none'
        }
      }}
    >
      {/* Background decoration - grid pattern */}
      <Box
        aria-hidden="true"
        sx={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 100,
          height: 100,
          opacity: 0.08,
          pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px'
        }}
      />

      <CardContent sx={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Avatar
            alt=""
            sx={{
              bgcolor: 'rgba(255,255,255,0.2)',
              backdropFilter: 'blur(10px)',
              width: 44,
              height: 44,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            <ShapeIcon sx={{ fontSize: 22 }} />
          </Avatar>

          <Stack direction="row" spacing={0.5} alignItems="center">
            {plot.numQuadrats !== undefined && (
              <Chip
                size="sm"
                variant="soft"
                sx={{
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  backdropFilter: 'blur(4px)',
                  fontWeight: 600,
                  fontSize: '0.75rem'
                }}
                startDecorator={<GridOnIcon sx={{ fontSize: 12 }} />}
              >
                {plot.numQuadrats} Quadrats
              </Chip>
            )}
            {onEdit && (
              <IconButton
                size="sm"
                variant="soft"
                onClick={e => {
                  e.stopPropagation();
                  onEdit(plot);
                }}
                aria-label={`Edit plot ${plot.plotName}`}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  backdropFilter: 'blur(4px)',
                  '&:hover': {
                    bgcolor: 'rgba(255,255,255,0.3)'
                  }
                }}
              >
                <EditIcon sx={{ fontSize: 16 }} />
              </IconButton>
            )}
          </Stack>
        </Box>

        <Typography
          level="h4"
          sx={{
            fontWeight: 700,
            mb: 0.25,
            textShadow: '0 2px 4px rgba(0,0,0,0.1)',
            fontSize: '1rem'
          }}
        >
          {plot.plotName}
        </Typography>

        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
          <LocationOnIcon sx={{ fontSize: 12, opacity: plot.locationName ? 0.9 : 0.5 }} />
          <Typography
            level="body-xs"
            sx={{
              color: plot.locationName ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)',
              fontWeight: 500,
              fontStyle: plot.locationName ? 'normal' : 'italic'
            }}
          >
            {plot.locationName ? (
              <>
                {plot.locationName}
                {plot.countryName && `, ${plot.countryName}`}
              </>
            ) : (
              'Location not specified'
            )}
          </Typography>
        </Stack>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          {formatDimensions() && (
            <Chip
              size="sm"
              variant="soft"
              sx={{
                bgcolor: 'rgba(0,0,0,0.15)',
                color: 'rgba(255,255,255,0.95)',
                fontSize: '0.625rem',
                height: 'auto',
                py: 0.25
              }}
              startDecorator={<StraightenIcon sx={{ fontSize: 10 }} />}
            >
              {formatDimensions()}
            </Chip>
          )}

          {formatArea() && (
            <Chip
              size="sm"
              variant="soft"
              sx={{
                bgcolor: 'rgba(0,0,0,0.15)',
                color: 'rgba(255,255,255,0.95)',
                fontSize: '0.625rem',
                height: 'auto',
                py: 0.25
              }}
              startDecorator={<SquareFootIcon sx={{ fontSize: 10 }} />}
            >
              {formatArea()}
            </Chip>
          )}

          {plot.globalZ !== undefined && plot.globalZ !== null && (
            <Chip
              size="sm"
              variant="soft"
              sx={{
                bgcolor: 'rgba(0,0,0,0.15)',
                color: 'rgba(255,255,255,0.95)',
                fontSize: '0.625rem',
                height: 'auto',
                py: 0.25
              }}
              startDecorator={<HeightIcon sx={{ fontSize: 10 }} />}
            >
              {plot.globalZ}m elev.
            </Chip>
          )}
        </Box>

        {/* Quadrat grid size indicator */}
        {plot.numQuadrats !== undefined && plot.numQuadrats > 0 && (
          <Box sx={{ mt: 'auto' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" alignItems="center" spacing={0.75}>
                {/* Mini grid visualization */}
                <Box
                  aria-hidden="true"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${Math.sqrt(gridSize.dots)}, 1fr)`,
                    gap: '2px',
                    width: 'fit-content'
                  }}
                >
                  {Array.from({ length: gridSize.dots }).map((_, i) => (
                    <Box
                      key={i}
                      sx={{
                        width: 4,
                        height: 4,
                        borderRadius: '1px',
                        bgcolor: gridSize.color
                      }}
                    />
                  ))}
                </Box>
                <Typography level="body-xs" sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.625rem' }}>
                  {gridSize.label} Grid
                </Typography>
              </Stack>
              <Typography level="body-xs" sx={{ color: 'rgba(255,255,255,0.95)', fontWeight: 600, fontSize: '0.6875rem' }}>
                {plot.numQuadrats.toLocaleString()} quadrats
              </Typography>
            </Stack>
          </Box>
        )}

        {/* Census count badge */}
        {plot.censusCount !== undefined && plot.censusCount > 0 && (
          <Chip
            size="sm"
            variant="soft"
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              bgcolor: 'rgba(255,255,255,0.95)',
              color: gradient.includes('#059669') ? '#059669' : '#0891b2',
              fontWeight: 700,
              fontSize: '0.6875rem'
            }}
          >
            {plot.censusCount} {plot.censusCount === 1 ? 'Census' : 'Censuses'}
          </Chip>
        )}
      </CardContent>
    </Card>
  );
}

// Grid layout styles shared across sections
const gridStyles = {
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
};

// Card for adding a new plot
function AddPlotCard({ onAdd }: { onAdd: () => void }) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onAdd();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <Box
      component="button"
      type="button"
      onClick={onAdd}
      onKeyDown={handleKeyDown}
      aria-label="Add a new plot"
      sx={{
        minHeight: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: '2px dashed',
        borderColor: 'neutral.outlinedBorder',
        bgcolor: 'transparent',
        borderRadius: 'sm',
        transition: 'all 0.2s ease',
        width: '100%',
        '&:hover, &:focus-visible': {
          borderColor: 'primary.500',
          bgcolor: 'primary.softBg',
          transform: 'translateY(-2px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          outline: 'none'
        }
      }}
    >
      <Stack alignItems="center" spacing={1.5}>
        <Avatar
          alt=""
          sx={{
            width: 56,
            height: 56,
            bgcolor: 'primary.softBg',
            color: 'primary.500'
          }}
        >
          <AddIcon sx={{ fontSize: 28 }} />
        </Avatar>
        <Typography level="title-md" sx={{ fontWeight: 600, color: 'primary.700' }}>
          Add New Plot
        </Typography>
        <Typography level="body-sm" color="neutral">
          Create a new plot for this site
        </Typography>
      </Stack>
    </Box>
  );
}

export default function PlotsOverview({ plots, siteName, isLoading = false, onPlotEdit, onAddPlot }: PlotsOverviewProps) {
  // Separate plots with and without quadrats, sort alphabetically within each group
  const { plotsWithQuadrats, plotsWithoutQuadrats } = useMemo(() => {
    if (!Array.isArray(plots)) {
      return { plotsWithQuadrats: [], plotsWithoutQuadrats: [] };
    }

    const withQuadrats = plots
      .filter(plot => plot?.numQuadrats !== undefined && plot.numQuadrats > 0)
      .sort((a, b) => (a?.plotName ?? '').localeCompare(b?.plotName ?? ''));

    const withoutQuadrats = plots
      .filter(plot => plot?.numQuadrats === undefined || plot.numQuadrats === 0)
      .sort((a, b) => (a?.plotName ?? '').localeCompare(b?.plotName ?? ''));

    return { plotsWithQuadrats: withQuadrats, plotsWithoutQuadrats: withoutQuadrats };
  }, [plots]);

  if (isLoading) {
    return (
      <Box component="section" aria-label="Loading plots" aria-busy="true" sx={gridStyles}>
        {Array.from({ length: 8 }).map((_, index) => (
          <PlotCardSkeleton key={index} />
        ))}
      </Box>
    );
  }

  if (!plots || plots.length === 0) {
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
          <GridOnIcon sx={{ fontSize: 32 }} />
        </Avatar>
        <Typography level="h4" sx={{ mb: 1 }}>
          No Plots Available
        </Typography>
        <Typography level="body-md" color="neutral">
          {siteName ? `${siteName} doesn't have any plots configured yet.` : "This site doesn't have any plots configured yet."} Please contact an administrator
          to set up plots.
        </Typography>
      </Card>
    );
  }

  return (
    <Box component="section" aria-label={siteName ? `Plots in ${siteName}` : 'Available plots'}>
      {siteName && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
          <PublicIcon sx={{ color: 'primary.500', fontSize: 20 }} />
          <Typography level="title-md" sx={{ fontWeight: 600 }}>
            {siteName}
          </Typography>
          <Chip size="sm" variant="soft" color="primary">
            {plots.length} {plots.length === 1 ? 'Plot' : 'Plots'}
          </Chip>
        </Stack>
      )}

      {/* Plots with quadrats section */}
      {plotsWithQuadrats.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <CheckCircleIcon sx={{ color: 'success.500', fontSize: 18 }} />
            <Typography level="title-sm" sx={{ fontWeight: 600, color: 'success.700' }}>
              With Quadrats
            </Typography>
            <Chip size="sm" variant="soft" color="success">
              {plotsWithQuadrats.length}
            </Chip>
          </Stack>
          <Box component="ul" sx={gridStyles}>
            {plotsWithQuadrats.map((plot, index) => (
              <Box component="li" key={plot.plotID ?? `with-${index}`}>
                <PlotCard plot={plot} index={index} onEdit={onPlotEdit} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Divider between sections */}
      {plotsWithQuadrats.length > 0 && plotsWithoutQuadrats.length > 0 && <Divider sx={{ my: 3 }} />}

      {/* Plots without quadrats section */}
      {plotsWithoutQuadrats.length > 0 && (
        <Box>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
            <CancelIcon sx={{ color: 'neutral.500', fontSize: 18 }} />
            <Typography level="title-sm" sx={{ fontWeight: 600, color: 'neutral.600' }}>
              Without Quadrats
            </Typography>
            <Chip size="sm" variant="soft" color="neutral">
              {plotsWithoutQuadrats.length}
            </Chip>
          </Stack>
          <Box component="ul" sx={gridStyles}>
            {plotsWithoutQuadrats.map((plot, index) => (
              <Box component="li" key={plot.plotID ?? `without-${index}`}>
                <PlotCard plot={plot} index={plotsWithQuadrats.length + index} onEdit={onPlotEdit} />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Add new plot card - always shown at the end if callback is provided */}
      {onAddPlot && (
        <Box sx={{ mt: plotsWithQuadrats.length > 0 || plotsWithoutQuadrats.length > 0 ? 3 : 0 }}>
          <Box sx={gridStyles}>
            <Box component="div">
              <AddPlotCard onAdd={onAddPlot} />
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export { PlotCard, PlotCardSkeleton };
