'use client';
import * as React from 'react';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { preloadKey } from '@/lib/query/preload';
import { queryKey } from '@/lib/query';
import { createFetchQuery } from '@/config/servergridhelpers';
import { formatDisplayDate } from '@/config/dateformats';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import { LoginLogout } from '@/components/loginlogout';
import { siteConfigNav, SiteConfigProps, validityMapping } from '@/config/macros/siteconfigs';
import { useOrgCensusContext, useOrgCensusDispatch, usePlotContext, usePlotDispatch, useSiteContext, useSiteDispatch } from '@/app/contexts/compat-hooks';
import { markExplicitSelectionClear } from '@/config/store/appstore';
import { usePathname, useRouter } from 'next/navigation';
import NextLink from 'next/link';
import ailogger from '@/ailogger';
import { Badge, IconButton, SelectOption, Stack, Tooltip } from '@mui/joy';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import { useOrgCensusListContext, usePlotListContext, useSiteListContext } from '@/app/contexts/compat-hooks';
import { useSession } from 'next-auth/react';
import { TransitionComponent } from '@/components/client/clientmacros';
import ListDivider from '@mui/joy/ListDivider';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from '@mui/joy/Avatar';
import { CensusLogo, PlotLogo } from '@/components/icons';
import { RainbowIcon } from '@/styles/rainbowicon';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { Plot, Site, SitesRDS } from '@/lib/db/definitions/zones';
import { OrgCensus } from '@/lib/db/definitions/timekeeping';
import { CheckCircle, Cancel, Clear, LockOutlined } from '@mui/icons-material';
import ValidationStatusBadge from '@/components/client/validationstatusbadge';

export interface SimpleTogglerProps {
  isOpen: boolean;
  children: React.ReactNode;
  renderToggle: any;
}

export function SimpleToggler({ isOpen, renderToggle, children }: Readonly<SimpleTogglerProps>) {
  return (
    <React.Fragment>
      {renderToggle}
      <Box
        data-testid={'simple-toggler'}
        sx={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: '0.2s ease',
          '& > *': {
            overflow: 'hidden'
          }
        }}
      >
        {children}
      </Box>
    </React.Fragment>
  );
}

interface MRTProps {
  plotSelectionRequired: boolean;
  censusSelectionRequired: boolean;
  pathname: string;
  isParentDataIncomplete: boolean;
}

function MenuRenderToggle(
  props: MRTProps,
  siteConfigProps: SiteConfigProps,
  menuOpen: boolean | undefined,
  setMenuOpen: Dispatch<SetStateAction<boolean>> | undefined
) {
  const Icon = siteConfigProps.icon;
  const { plotSelectionRequired, censusSelectionRequired, pathname, isParentDataIncomplete } = props;
  const currentSite = useSiteContext();
  const currentPlot = usePlotContext();
  const locked = plotSelectionRequired || censusSelectionRequired;
  const missingSelection = !currentSite ? 'site' : plotSelectionRequired ? 'plot' : censusSelectionRequired ? 'census' : null;
  return (
    <Tooltip title={missingSelection ? `Choose a ${missingSelection} to unlock` : isParentDataIncomplete ? 'Missing Core Data!' : ''} arrow>
      <span style={{ width: '100%' }}>
        <ListItemButton
          disabled={locked}
          color={pathname === siteConfigProps.href ? 'primary' : undefined}
          onClick={() => setMenuOpen?.(!menuOpen)}
          data-testid={'menu-render-toggle'}
          sx={{ width: '100%', padding: 0, margin: 0 }}
        >
          <Badge
            data-testid={'menu-render-toggle-tooltip-badge'}
            color="danger"
            variant={isParentDataIncomplete ? 'solid' : 'soft'}
            badgeContent={isParentDataIncomplete ? '!' : undefined}
            invisible={!isParentDataIncomplete || !currentSite || !currentPlot}
            aria-label={isParentDataIncomplete ? 'Warning: Some subsections have missing data' : undefined}
          >
            {locked ? <LockOutlined /> : <Icon />}
          </Badge>
          <ListItemContent data-testid={'menu-render-toggle-content'}>
            <Typography level={'title-sm'}>{siteConfigProps.label}</Typography>
          </ListItemContent>
          <KeyboardArrowDownIcon sx={{ transform: menuOpen ? 'rotate(180deg)' : 'none' }} />
        </ListItemButton>
      </span>
    </Tooltip>
  );
}

interface SidebarProps {
  siteListLoaded: boolean;
  coreDataLoaded: boolean;
  /** @deprecated This prop is unused and will be removed in a future version */
  setCensusListLoaded: () => void;
}

/**
 * MUI Base fires a programmatic onChange(null) — its internal itemsChange action carries
 * event: null (@mui/base useList) and its reducer prunes a controlled Select's value while
 * async-loaded options (re)register during boot. Treating that prune as a user deselect
 * wiped the persisted site/plot/census selection on every reload and bounced the user to
 * /dashboard (bug F7). Real user interactions (click/keyboard) always carry an event, so
 * only they may clear a selection.
 */
export const isProgrammaticSelectClear = (event: React.SyntheticEvent | null, newValue: number | string | null): boolean => event === null && newValue === null;

const ADMIN_NAV = [
  { href: '/admin/users', label: 'Users', icon: <CheckCircle /> },
  { href: '/admin/sites', label: 'Sites', icon: <TravelExploreIcon /> },
  { href: '/admin/userstosites', label: 'Assignments', icon: <AddCircleOutlineIcon /> },
  { href: '/admin/provision', label: 'Provisioning', icon: <AddCircleOutlineIcon /> },
  { href: '/admin/provision/runs', label: 'Provisioning runs', icon: <FormatListBulletedIcon /> }
];

export default function Sidebar(props: SidebarProps) {
  const { coreDataLoaded } = props;
  const { data: session } = useSession();
  const currentSite = useSiteContext();
  const siteDispatch = useSiteDispatch();
  const currentPlot = usePlotContext();
  const plotDispatch = usePlotDispatch();
  const currentCensus = useOrgCensusContext();
  const censusDispatch = useOrgCensusDispatch();
  const censusListContext = useOrgCensusListContext();
  const siteListContext = useSiteListContext();
  const plotListContext = usePlotListContext();
  const { validity, isChecking } = useDataValidityContext();
  const validityReady = coreDataLoaded && !isChecking;
  const isAllValiditiesTrue =
    !validityReady ||
    Object.entries(validity)
      .filter(([key]) => key !== 'subquadrats')
      .every(([, value]) => value);

  const router = useRouter();
  const pathname = usePathname();

  // Detect if we're on an admin page
  const isAdminPage = pathname?.includes('/admin') ?? false;

  const [measurementsToggle, setMeasurementsToggle] = useState(true);
  const [propertiesToggle, setPropertiesToggle] = useState(true);
  const [formsToggle, setFormsToggle] = useState(true);

  const { setCensusListLoaded: _setCensusListLoaded } = props;

  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(340); // Default width
  const [isSiteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const [isPlotDropdownOpen, setPlotDropdownOpen] = useState(false);
  const [isCensusDropdownOpen, setCensusDropdownOpen] = useState(false);
  // Admin pages used to forcibly clear the user's site/plot/census selections on mount.
  // That side-effect was hostile UX (sub-paths like /admin/provision/runs would wipe state),
  // and admin pages are overlays — they don't need a clean context. Removed in 2026-05 task 13.

  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;

    const updateSidebarWidth = () => {
      if (sidebarRef.current) {
        const scrollWidth = sidebarRef.current.scrollWidth;
        const calculatedWidth = Math.max(scrollWidth, 340); // Minimum width

        setSidebarWidth(Math.min(calculatedWidth + 10, 380)); // Reduced max width from 500 to 380
      }
    };

    // Debounce resize updates to prevent excessive recalculations
    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateSidebarWidth, 300);
    };

    const resizeObserver = new ResizeObserver(debouncedUpdate);

    // Only observe the container, not all children
    if (sidebarRef.current) {
      resizeObserver.observe(sidebarRef.current);
    }

    // Initial calculation
    updateSidebarWidth();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      resizeObserver.disconnect();
    };
  }, []); // Remove context dependencies - observer doesn't need to recreate

  const handleSiteSelection = async (selectedSite: Site | undefined) => {
    if (selectedSite === undefined) {
      // A user-driven deselect empties the whole selection cascade below; without this
      // marker the guarded persist storage would refuse to write the empty state.
      markExplicitSelectionClear();
    }
    if (siteDispatch) {
      await siteDispatch({ site: selectedSite });
    }
    if (selectedSite === undefined) {
      await handlePlotSelection(undefined);
    }
    // If on admin page and a site is selected, navigate to dashboard
    if (isAdminPage && selectedSite) {
      router.push('/dashboard');
    }
  };

  const handlePlotSelection = async (selectedPlot: Plot) => {
    if (plotDispatch) {
      await plotDispatch({ plot: selectedPlot });
    }
    if (selectedPlot === undefined) {
      await handleCensusSelection(undefined);
    }
  };

  const handleCensusSelection = async (selectedCensus: OrgCensus) => {
    if (censusDispatch) {
      await censusDispatch({ census: selectedCensus });
    }
  };

  const renderSiteValue = (option: SelectOption<number> | null) => {
    if (!option) {
      return <Typography data-testid={'pending-site-select'}>Select a Site</Typography>;
    }

    const selectedValue = option.value;
    const selectedSite = siteListContext?.find(c => c?.siteID === selectedValue);
    return (
      <>
        {selectedSite ? (
          <Stack direction={'column'} alignItems={'start'} aria-label={'site value render stack'} sx={{ maxWidth: '100%', minWidth: 0 }}>
            <Typography
              id={'site-selected'}
              level="body-lg"
              className="sidebar-item"
              data-testid={'selected-site-name'}
              sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
            >{`Site: ${selectedSite?.siteName}`}</Typography>
            <Stack direction={'column'} alignItems={'start'} aria-labelledby={'site-selected'}>
              <Typography
                level="body-sm"
                color={'primary'}
                className="sidebar-item"
                data-testid={'selected-site-schema'}
                sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
              >
                {' — '}Schema: {selectedSite.schemaName}
              </Typography>
            </Stack>
          </Stack>
        ) : (
          <Typography aria-label={'site select prompt'} level="body-lg" className="sidebar-item" data-testid={'pending-site-select'}>
            Select a Site
          </Typography>
        )}
      </>
    );
  };

  const renderPlotValue = (option: SelectOption<number> | null) => {
    if (!option) {
      return <Typography data-testid={'pending-plot-select'}>Select a Plot</Typography>;
    }

    const selectedValue = option.value;
    const selectedPlot = plotListContext?.find(c => c?.plotID === selectedValue);

    return (
      <>
        {selectedPlot ? (
          <Stack direction="column" alignItems="start" aria-label={'plot value render stack'} sx={{ maxWidth: '100%', minWidth: 0 }}>
            <Typography level="body-md" className="sidebar-item" data-testid={'selected-plot-name'}>{`Plot: ${selectedPlot?.plotName}`}</Typography>
            <Box aria-label={'selected plot information'} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
              <Typography level="body-sm" color={'primary'} data-testid={'selected-plot-quadrats'}>
                {' — '}
                {selectedPlot.numQuadrats || selectedPlot.numQuadrats === 0 ? `Quadrats: ${selectedPlot.numQuadrats}` : 'No Quadrats'}
              </Typography>
            </Box>
          </Stack>
        ) : (
          <Typography aria-label={'select a plot'} className="sidebar-item" data-testid={'pending-plot-select'}>
            Select a Plot
          </Typography>
        )}
      </>
    );
  };

  const renderCensusValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography data-testid={'pending-census-select'}>Select a Census</Typography>;
    }

    const selectedValue = option.value;
    const selectedCensus = censusListContext?.find(c => c?.plotCensusNumber?.toString() === selectedValue);

    if (!selectedCensus) {
      return <Typography className="sidebar-item">Select a Census</Typography>;
    }

    const startDate = currentCensus?.dateRanges?.[0]?.startDate;
    const endDate = currentCensus?.dateRanges?.[0]?.endDate;

    const hasStartDate = startDate !== undefined && startDate !== null;
    const hasEndDate = endDate !== undefined && endDate !== null;

    // Ensure dates are rendered in a block layout to stack them vertically
    const dateMessage = (
      <span aria-label={'census record information'} style={{ display: 'block' }}>
        {hasStartDate && <Typography display="block">{`— First Record: ${formatDisplayDate(startDate)}`}</Typography>}
        {hasEndDate && <Typography display="block">{`— Last Record: ${formatDisplayDate(endDate)}`}</Typography>}
        {!hasStartDate && !hasEndDate && <Typography display="block">No Measurements</Typography>}
      </span>
    );

    return (
      <Stack direction={'column'} alignItems={'start'} id={'selected-census-stack'} sx={{ maxWidth: '100%', minWidth: 0 }}>
        <Typography level="body-md" className="sidebar-item" data-testid={'selected-census-plotcensusnumber'}>
          {`Census: ${selectedCensus?.plotCensusNumber}`}
        </Typography>
        <Stack direction={'column'} alignItems={'start'}>
          <Typography color={!currentCensus ? 'danger' : 'primary'} level="body-sm" className="sidebar-item" data-testid={'selected-census-dates'}>
            {currentCensus !== undefined && dateMessage}
          </Typography>
        </Stack>
      </Stack>
    );
  };

  interface ToggleObject {
    toggle?: boolean;
    setToggle?: Dispatch<SetStateAction<boolean>>;
  }

  type ToggleArray = ToggleObject[];
  const toggleArray: ToggleArray = [
    { toggle: undefined, setToggle: undefined },
    { toggle: measurementsToggle, setToggle: setMeasurementsToggle },
    { toggle: propertiesToggle, setToggle: setPropertiesToggle },
    { toggle: formsToggle, setToggle: setFormsToggle }
  ];

  const renderCensusOptions = () => (
    <Select
      suppressHydrationWarning
      placeholder="Select a Census"
      className="census-select sidebar-item"
      name="None"
      required
      size={'md'}
      value={currentCensus?.plotCensusNumber?.toString() || ''}
      renderValue={renderCensusValue}
      data-testid={'census-select-component'}
      sx={{ width: '100%', minWidth: 0 }}
      aria-label="Select a Census. Required field for accessing measurement tools"
      listboxOpen={isCensusDropdownOpen}
      onListboxOpenChange={() => {
        setSiteDropdownOpen(false);
        setPlotDropdownOpen(false);
        setCensusDropdownOpen(true);
      }}
      onClose={() => setCensusDropdownOpen(false)}
      onChange={async (event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
        if (isProgrammaticSelectClear(event, selectedPlotCensusNumberStr)) return;
        if (selectedPlotCensusNumberStr === '' || selectedPlotCensusNumberStr === null) await handleCensusSelection(undefined);
        else {
          const selectedPlotCensusNumber = parseInt(selectedPlotCensusNumberStr, 10);
          const selectedCensus = censusListContext?.find(census => census?.plotCensusNumber === selectedPlotCensusNumber) || undefined;
          await handleCensusSelection(selectedCensus);
        }
      }}
    >
      {Array.isArray(censusListContext) &&
        censusListContext
          .sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0))
          .map(item => (
            <Option
              aria-label={`Census ${item?.plotCensusNumber}${item?.dateRanges?.length ? `, first measurement: ${item.dateRanges?.[0]?.startDate ? formatDisplayDate(item.dateRanges?.[0]?.startDate) : 'No measurements'}` : ''}`}
              data-testid={'census-selection-option'}
              key={item?.plotCensusNumber}
              value={item?.plotCensusNumber?.toString()}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                  gap: 1
                }}
                className="sidebar-item"
              >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Typography level="body-lg" data-testid={'census-selection-option-plotcensusnumber'}>
                    Census: {item?.plotCensusNumber}
                  </Typography>
                  {Array.isArray(item?.dateRanges) &&
                    item.dateRanges.map((dateRange, index) => (
                      <Stack key={index} direction={'row'}>
                        <Typography level="body-sm" color={'neutral'}>
                          {`${dateRange.startDate ? `First Msmt: ${formatDisplayDate(dateRange.startDate)}` : 'No Measurements'}`}
                        </Typography>
                        {dateRange.endDate && (
                          <Typography level="body-sm" color={'neutral'} sx={{ whiteSpace: 'pre' }}>
                            {' — '}
                          </Typography>
                        )}
                        <Typography level="body-sm" color={'neutral'}>
                          {`${dateRange.endDate ? `Last Msmt: ${formatDisplayDate(dateRange.endDate)}` : ''}`}
                        </Typography>
                      </Stack>
                    ))}
                </Box>
              </Box>
            </Option>
          ))}
    </Select>
  );

  // Separate plots with and without quadrats for grouped display
  const plotsWithQuadrats = React.useMemo(() => {
    if (!Array.isArray(plotListContext)) return [];
    return plotListContext
      .filter(plot => plot?.numQuadrats !== undefined && plot.numQuadrats > 0)
      .sort((a, b) => (a?.plotName ?? '').localeCompare(b?.plotName ?? ''));
  }, [plotListContext]);

  const plotsWithoutQuadrats = React.useMemo(() => {
    if (!Array.isArray(plotListContext)) return [];
    return plotListContext
      .filter(plot => plot?.numQuadrats === undefined || plot.numQuadrats === 0)
      .sort((a, b) => (a?.plotName ?? '').localeCompare(b?.plotName ?? ''));
  }, [plotListContext]);

  const renderPlotOptions = () => {
    const plotOptions: React.ReactNode[] = [];

    // Add "With Quadrats" section header and plots
    if (plotsWithQuadrats.length > 0) {
      plotOptions.push(
        <ListItem
          key="header-with-quadrats"
          sticky
          sx={{
            bgcolor: 'success.softBg',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 0.5,
            px: 1.5
          }}
        >
          <CheckCircle sx={{ fontSize: 16, color: 'success.400' }} />
          <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'success.400', fontWeight: 'lg' }}>
            With Quadrats ({plotsWithQuadrats.length})
          </Typography>
        </ListItem>
      );

      plotsWithQuadrats.forEach(item => {
        plotOptions.push(
          <Option key={item?.plotID} value={item?.plotID} aria-label={`plot name option: ${item?.plotName}`} data-testid="plot-selection-option">
            <Stack direction="column" alignItems="start" className="sidebar-item">
              <Typography level="body-md" data-testid="plot-selection-option-plotname">
                {item?.plotName}
              </Typography>
              <Typography level="body-sm" color="success">
                {' — '}Quadrats: {item?.numQuadrats}
              </Typography>
            </Stack>
          </Option>
        );
      });
    }

    // Add divider between sections if both exist
    if (plotsWithQuadrats.length > 0 && plotsWithoutQuadrats.length > 0) {
      plotOptions.push(<ListDivider key="section-divider" role="none" />);
    }

    // Add "Without Quadrats" section header and plots
    if (plotsWithoutQuadrats.length > 0) {
      plotOptions.push(
        <ListItem
          key="header-without-quadrats"
          sticky
          sx={{
            bgcolor: 'neutral.softBg',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 0.5,
            px: 1.5
          }}
        >
          <Cancel sx={{ fontSize: 16, color: 'neutral.400' }} />
          <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'neutral.400', fontWeight: 'lg' }}>
            Without Quadrats ({plotsWithoutQuadrats.length})
          </Typography>
        </ListItem>
      );

      plotsWithoutQuadrats.forEach(item => {
        plotOptions.push(
          <Option key={item?.plotID} value={item?.plotID} aria-label={`plot name option: ${item?.plotName}`} data-testid="plot-selection-option">
            <Stack direction="column" alignItems="start" className="sidebar-item">
              <Typography level="body-md" data-testid="plot-selection-option-plotname">
                {item?.plotName}
              </Typography>
              <Typography level="body-sm" color="neutral">
                {' — '}No Quadrats
              </Typography>
            </Stack>
          </Option>
        );
      });
    }

    return (
      <Select<number>
        placeholder="Select a Plot"
        className="plot-selection"
        name="None"
        required
        size="md"
        data-testid="plot-select-component"
        sx={{ width: '100%', minWidth: 0 }}
        aria-label="Select a Plot"
        renderValue={renderPlotValue}
        value={currentPlot?.plotID ?? null}
        listboxOpen={isPlotDropdownOpen}
        onListboxOpenChange={open => {
          setPlotDropdownOpen(open);
          if (open) {
            setSiteDropdownOpen(false);
            setCensusDropdownOpen(false);
          }
        }}
        onClose={() => setPlotDropdownOpen(false)}
        onChange={async (event: React.SyntheticEvent | null, newValue: number | null) => {
          if (isProgrammaticSelectClear(event, newValue)) return;
          event?.preventDefault();
          const selectedPlot = plotListContext?.find(plot => plot?.plotID === newValue) || undefined;
          await handlePlotSelection(selectedPlot);
        }}
        slotProps={{
          listbox: {
            sx: {
              maxHeight: 300,
              overflow: 'auto'
            }
          }
        }}
      >
        {plotOptions}
      </Select>
    );
  };
  const renderSiteOptions = () => {
    const isGlobalUser = session?.user?.userStatus === 'global';
    const sortByName = (a: SitesRDS, b: SitesRDS) => {
      const nameA = a.siteName?.toLowerCase() ?? '';
      const nameB = b.siteName?.toLowerCase() ?? '';
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    };
    const allowedSites = Array.isArray(siteListContext)
      ? siteListContext.filter(site => isGlobalUser || session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)).sort(sortByName)
      : [];
    const otherSites = Array.isArray(siteListContext)
      ? siteListContext.filter(site => !isGlobalUser && !session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)).sort(sortByName)
      : [];

    return (
      <Select
        className="site-select sidebar-item"
        aria-label={'Select a Site'}
        placeholder="Select a Site"
        name="None"
        required
        sx={{ width: '100%', minWidth: 0 }}
        size={'md'}
        renderValue={renderSiteValue}
        data-testid={'site-select-component'}
        value={currentSite?.siteID ?? null}
        listboxOpen={isSiteDropdownOpen}
        onListboxOpenChange={() => {
          setSiteDropdownOpen(true);
          setPlotDropdownOpen(false);
          setCensusDropdownOpen(false);
        }}
        onClose={() => setSiteDropdownOpen(false)}
        onChange={async (event: React.SyntheticEvent | null, newValue: number | null) => {
          if (isProgrammaticSelectClear(event, newValue)) return;
          const selectedSite = newValue ? siteListContext?.find(site => site?.siteID === newValue) : undefined;
          await handleSiteSelection(selectedSite);
        }}
      >
        <List>
          <ListItem sticky className="sidebar-item">
            <Typography level="body-xs" textTransform="uppercase">
              Clear selection:
            </Typography>
          </ListItem>
          <Option key="none" value={null as unknown as number} aria-label="Clear site selection">
            None
          </Option>
        </List>
        <ListDivider role="none" />
        <List sx={{ '--ListItemDecorator-size': '28px' }}>
          <ListItem id="allowed-sites-group" sticky className="sidebar-item">
            <Typography
              level="body-xs"
              textTransform="uppercase"
              aria-live="polite"
              aria-label={`Allowed Sites section, ${allowedSites.length} sites available`}
            >
              Allowed Sites ({allowedSites.length})
            </Typography>
          </ListItem>
          {allowedSites.map(site => (
            <Option key={site.siteID} value={site.siteID} data-testid={'site-selection-option-allowed'} aria-label={`Select ${site.siteName} site`}>
              {site.siteName}
            </Option>
          ))}
        </List>
        {otherSites.length > 0 && [
          <ListDivider key="other-sites-divider" role="none" />,
          <List key="other-sites-list" sx={{ '--ListItemDecorator-size': '28px' }}>
            <ListItem id="other-sites-group" sticky className="sidebar-item">
              <Typography
                level="body-xs"
                textTransform="uppercase"
                aria-live="polite"
                aria-label={`Other Sites section, ${otherSites.length} sites not available to you`}
              >
                Other Sites ({otherSites.length})
              </Typography>
            </ListItem>
            {otherSites.map(site => (
              <Option
                key={site.siteID}
                value={site.siteID}
                disabled
                data-testid={'site-selection-option-other'}
                aria-label={`${site.siteName} site, not accessible to current user`}
              >
                {site.siteName}
              </Option>
            ))}
          </List>
        ]}
      </Select>
    );
  };

  const navPreloadHandlers: Record<string, () => void> = React.useMemo(() => {
    const schema = currentSite?.schemaName;
    const plotID = currentPlot?.plotID;
    const plotCensusNumber = currentCensus?.plotCensusNumber;
    const censusID = currentCensus?.dateRanges?.[0]?.censusID;
    if (!schema) return {} as Record<string, () => void>;

    const scope = { siteSchema: schema, plotID, censusID };
    const PAGE_ZERO = 0;
    const DEFAULT_PAGE_SIZE = 10;
    // /summary and /errors are intentionally NOT prefetched here: the live grids fetch via
    // POST /api/fixeddatafilter with a filterModel/sortModel body, and their query keys
    // include those models, so a GET /api/fixeddata prefetch can never warm the right cache
    // (and measurementssummary/failedmeasurements are not even valid GET dataTypes — 400).
    const attributesKey = queryKey('grid:attributes', scope, { page: PAGE_ZERO, pageSize: DEFAULT_PAGE_SIZE });
    const attributesURL = createFetchQuery(schema, 'attributes', PAGE_ZERO, DEFAULT_PAGE_SIZE, plotID, plotCensusNumber);

    return {
      '/attributes': () => preloadKey(attributesKey, attributesURL)
    };
  }, [currentSite?.schemaName, currentPlot?.plotID, currentCensus?.plotCensusNumber, currentCensus?.dateRanges]);

  const shouldApplyTooltip = (item: SiteConfigProps, linkHref?: string): boolean => {
    if (linkHref) {
      // Check for sub-links
      switch (linkHref) {
        case '/summary':
        case '/errors':
          return !isAllValiditiesTrue;
        case '/subquadrats':
          return validityReady && !validity['quadrats'];
        case '/quadratpersonnel':
          return validityReady && !validity['quadrats'];
        default:
          const dataKey = validityMapping[linkHref];
          return validityReady && dataKey !== undefined && !validity[dataKey];
      }
    } else {
      // Check for main links
      switch (item.href) {
        case '/summary':
          return !isAllValiditiesTrue;
        case '/subquadrats':
          return validityReady && !validity['quadrats'];
        case '/quadratpersonnel':
          return validityReady && !validity['quadrats'];
        default:
          return false;
      }
    }
  };

  return (
    <>
      <Stack direction={'row'} sx={{ display: 'flex', width: '100%', maxWidth: '100vw', minWidth: 0 }}>
        <Box
          component="nav"
          ref={sidebarRef}
          id="side-navigation"
          className="Sidebar"
          aria-label="Site navigation sidebar"
          sx={{
            position: 'sticky',
            top: 0,
            left: 0,
            height: '100vh',
            width: { xs: '100%', md: `${sidebarWidth}px` },
            maxWidth: '100vw',
            boxSizing: 'border-box',
            p: 2,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            borderRight: '1px solid',
            borderColor: 'divider',
            overflowY: 'auto',
            '&:focus': {
              outline: '2px solid',
              outlineColor: 'primary.500',
              outlineOffset: '-2px'
            }
          }}
        >
          <GlobalStyles
            styles={theme => ({
              ':root': {
                '--Sidebar-width': `${sidebarWidth}px`,
                [theme.breakpoints.up('lg')]: {
                  '--Sidebar-width': `${sidebarWidth}px`
                }
              }
            })}
          />
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
              <Stack direction={'column'} sx={{ marginRight: '1em' }}>
                <Typography level="h2">
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ marginRight: 1.5 }}>
                      <RainbowIcon />
                    </Box>
                    ForestGEO
                  </Box>
                </Typography>
              </Stack>
              <Divider orientation="horizontal" sx={{ my: 0.75 }} />
              {/* Admin page: show user's own sites and site selector instruction */}
              {isAdminPage && (
                <Box sx={{ width: '100%', mb: 2 }}>
                  {session?.user?.sites && session.user.sites.length > 0 && (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 'md',
                        bgcolor: 'background.level1',
                        border: '1px solid',
                        borderColor: 'divider',
                        mb: 1.5
                      }}
                    >
                      <Typography level="body-xs" sx={{ color: 'neutral.400', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                        Your Site Access
                      </Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {session.user.sites.map(site => (
                          <Box
                            key={site.siteID}
                            sx={{
                              px: 1,
                              py: 0.25,
                              borderRadius: 'sm',
                              bgcolor: 'primary.softBg',
                              color: 'primary.softColor',
                              fontSize: '0.75rem',
                              fontWeight: 500
                            }}
                          >
                            {site.siteName}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                  {session?.user?.userStatus === 'global' && (
                    <>
                      <Typography level="body-xs" sx={{ color: 'neutral.400', mb: 0.5, fontWeight: 600, textTransform: 'uppercase' }}>
                        Administration
                      </Typography>
                      {ADMIN_NAV.map(item => (
                        <ListItemButton
                          key={item.href}
                          component={NextLink}
                          href={item.href}
                          selected={pathname === item.href}
                          color={pathname === item.href ? 'primary' : undefined}
                          sx={{ borderRadius: 'sm', mb: 0.5 }}
                        >
                          {item.icon}
                          <ListItemContent>
                            <Typography level="title-sm">{item.label}</Typography>
                          </ListItemContent>
                        </ListItemButton>
                      ))}
                      <ListItemButton component={NextLink} href="/dashboard" aria-label="Back to app" sx={{ borderRadius: 'sm', mb: 1 }}>
                        <ListItemContent>
                          <Typography level="title-sm">Back to app</Typography>
                        </ListItemContent>
                      </ListItemButton>
                    </>
                  )}
                  <Typography level="body-xs" sx={{ color: 'neutral.400', mb: 1 }}>
                    Select a site to exit admin and go to dashboard:
                  </Typography>
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }}>
                <Avatar sx={{ marginRight: 1 }} alt={'site options icon'}>
                  <TravelExploreIcon />
                </Avatar>
                <Box sx={{ flexGrow: 1 }}>{renderSiteOptions()}</Box>
              </Box>
              {currentSite !== undefined && !isAdminPage && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid={'plot-selection-box'}>
                    <Avatar size={'sm'} sx={{ marginRight: 1 }} alt={'plot options icon'}>
                      <PlotLogo />
                    </Avatar>
                    <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center', marginRight: currentPlot ? '0.5em' : '1em' }}>{renderPlotOptions()}</Box>
                    {currentPlot && (
                      <Tooltip title="Clear plot selection" arrow>
                        <IconButton
                          size="sm"
                          variant="plain"
                          color="neutral"
                          onClick={async () => {
                            await handlePlotSelection(undefined);
                          }}
                          sx={{
                            minWidth: 28,
                            minHeight: 28,
                            '&:hover': { bgcolor: 'danger.softBg', color: 'danger.400' }
                          }}
                          aria-label="Clear plot selection"
                        >
                          <Clear sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  {currentPlot !== undefined && (
                    <>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid={'census-selection-box'}>
                        <Avatar size={'sm'} sx={{ marginRight: 1 }} alt={'census options icon'}>
                          <CensusLogo />
                        </Avatar>
                        <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center', marginRight: currentCensus ? '0.5em' : '1em' }}>
                          {renderCensusOptions()}
                        </Box>
                        {currentCensus && (
                          <Tooltip title="Clear census selection" arrow>
                            <IconButton
                              size="sm"
                              variant="plain"
                              color="neutral"
                              onClick={async () => {
                                await handleCensusSelection(undefined);
                              }}
                              sx={{
                                minWidth: 28,
                                minHeight: 28,
                                '&:hover': { bgcolor: 'danger.softBg', color: 'danger.400' }
                              }}
                              aria-label="Clear census selection"
                            >
                              <Clear sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                      {currentCensus && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                          <ValidationStatusBadge
                            schema={currentSite?.schemaName}
                            plotID={currentPlot?.plotID}
                            censusID={currentCensus?.dateRanges?.[0]?.censusID}
                          />
                        </Box>
                      )}
                      <Divider orientation="horizontal" sx={{ marginTop: 2 }} />
                    </>
                  )}
                </>
              )}
            </Box>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                ml: -1
              }}
            >
              {' '}
              <Box
                sx={{
                  minHeight: 0,
                  overflow: 'hidden auto',
                  flexGrow: 1,
                  display: 'flex',
                  flexDirection: 'column'
                }}
              >
                <List
                  size="lg"
                  sx={{
                    '--List-nestedInsetStart': '30px',
                    '--ListItem-radius': theme => theme.vars.radius.sm
                  }}
                >
                  {siteConfigNav.map((item, index: number) => {
                    const Icon = item.icon;
                    const { toggle, setToggle } = toggleArray[index];

                    const getTooltipMessage = (href: string, isDataIncomplete: boolean) => {
                      if (isDataIncomplete) {
                        switch (href) {
                          case '/summary':
                          case '/errors':
                            return 'Missing supporting data!';
                          case '/subquadrats':
                            return 'Subquadrats cannot be viewed until quadrats are valid.';
                          case '/quadratpersonnel':
                            return 'QuadratPersonnel cannot be viewed until both quadrats and personnel are valid.';
                          default:
                            return 'Data needed to complete census!';
                        }
                      } else {
                        return undefined;
                      }
                    };

                    const getDisabledState = (href: string) => {
                      switch (href) {
                        case '/measurementshub':
                        case '/summary':
                        case '/errors':
                          return !isAllValiditiesTrue;
                        case '/subquadrats':
                          return validityReady && !validity['quadrats'];
                        case '/quadratpersonnel':
                          return validityReady && !validity['quadrats'];
                        default:
                          return false;
                      }
                    };

                    const focusMainContent = () => {
                      setTimeout(() => {
                        const mainContent = document.getElementById('main-content');
                        if (mainContent) {
                          mainContent.focus();
                          mainContent.scrollIntoView();
                        }
                      }, 100);
                    };

                    // Cmd/ctrl/shift/alt-click and middle-click on a real anchor open a new
                    // tab/window — the current tab does not navigate, so same-tab side effects
                    // (census clear, focus move, availability gate) must not run.
                    const isModifiedClick = (e: React.MouseEvent) => e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;

                    // Disabled nav items render as plain divs with no href (see component=/href=
                    // below), so browser link affordances (open in new tab, middle-click) have
                    // nothing to follow. This capture-phase handler is the runtime backstop:
                    // MUI's useButton skips a disabled item's `onClick` WITHOUT calling
                    // preventDefault(), so a bubble-phase onClick could never block a stray
                    // href on a disabled item — capture-phase can.
                    const preventNavigationIfDisabled = (isDisabled: boolean) => (e: React.MouseEvent) => {
                      if (isDisabled) {
                        e.preventDefault();
                      }
                    };

                    const handleEnabledNavClick = (e: React.MouseEvent) => {
                      if (isModifiedClick(e)) return;
                      focusMainContent();
                    };

                    if (item.expanded.length === 0) {
                      const isDashboard = item.href === '/dashboard';
                      const isLinkDisabled = isDashboard ? false : getDisabledState(item.href);
                      const isDataIncomplete = isDashboard ? false : shouldApplyTooltip(item);
                      const isNavDisabledWithoutSelection = currentPlot === undefined || currentCensus === undefined || isLinkDisabled;

                      const handleDashboardClick = (e: React.MouseEvent) => {
                        if (isModifiedClick(e)) return;
                        // Same-tab navigation must wait for the census-clear dispatch:
                        // letting the NextLink navigate immediately mounts the dashboard
                        // with the census still selected, so it fetches census-scoped
                        // metrics that then flash and vanish when the clear lands.
                        e.preventDefault();
                        void (async () => {
                          try {
                            await handleCensusSelection(undefined);
                          } catch (error) {
                            ailogger.error('Failed to clear census selection before dashboard navigation', error instanceof Error ? error : undefined);
                            return;
                          }
                          router.push(item.href);
                          focusMainContent();
                        })();
                      };

                      // Dashboard button is always visible, other non-expanding items require site+plot
                      // Keep the information architecture visible before selection; unavailable
                      // destinations are shown disabled instead of disappearing.
                      const transitionIn = true;

                      return (
                        <TransitionComponent key={item.href} in={transitionIn} direction="down">
                          <ListItem data-testid={`navigate-list-item-nonexpanding-${item.label}`}>
                            {isDashboard ? (
                              <Box sx={{ display: 'flex', flex: 1 }} data-testid={'dashboard-nav-wrapper'}>
                                <ListItemButton
                                  component={NextLink}
                                  href={item.href}
                                  selected={pathname === item.href && !currentCensus}
                                  data-testid={`navigate-list-item-button-nonexpanding-${item.href}`}
                                  sx={{ flex: 1, width: '100%' }}
                                  color={pathname === item.href && !currentCensus ? 'primary' : undefined}
                                  onClick={handleDashboardClick}
                                >
                                  <Icon />
                                  <ListItemContent>
                                    <Typography level={'title-sm'}>{item.label}</Typography>
                                  </ListItemContent>
                                </ListItemButton>
                              </Box>
                            ) : currentSite !== undefined && currentPlot !== undefined && currentCensus !== undefined ? (
                              <Tooltip title={isDataIncomplete ? 'Missing Core Data!' : ''} arrow disableHoverListener={!isDataIncomplete}>
                                <Box sx={{ display: 'flex', flex: 1 }} data-testid={'conditional-site-plot-census-defined-box-wrapper'}>
                                  <ListItemButton
                                    key={`${item.href}-${isNavDisabledWithoutSelection ? 'locked' : 'link'}`}
                                    component={isNavDisabledWithoutSelection ? 'div' : NextLink}
                                    href={isNavDisabledWithoutSelection ? undefined : item.href}
                                    selected={pathname === item.href}
                                    data-testid={`navigate-list-item-button-nonexpanding-${item.href}`}
                                    sx={{ flex: 1, width: '100%' }}
                                    disabled={isLinkDisabled}
                                    color={pathname === item.href ? 'primary' : undefined}
                                    onClickCapture={preventNavigationIfDisabled(isLinkDisabled)}
                                    onClick={handleEnabledNavClick}
                                  >
                                    <Badge
                                      color="danger"
                                      variant={isDataIncomplete ? 'solid' : 'soft'}
                                      badgeContent={isDataIncomplete ? '!' : undefined}
                                      invisible={!isDataIncomplete}
                                      aria-label={isDataIncomplete ? 'Error: Missing core data required for this section' : undefined}
                                    >
                                      <Icon />
                                    </Badge>
                                    <ListItemContent>
                                      <Typography level={'title-sm'}>{item.label}</Typography>
                                    </ListItemContent>
                                  </ListItemButton>
                                </Box>
                              </Tooltip>
                            ) : (
                              <Tooltip title={`Choose a ${currentSite === undefined ? 'site' : currentPlot === undefined ? 'plot' : 'census'} to unlock`} arrow>
                                <Box sx={{ display: 'flex', flex: 1 }} data-testid={'conditional-site-plot-census-undefined-box-wrapper'}>
                                  <ListItemButton
                                    component="div"
                                    selected={pathname === item.href}
                                    sx={{ flex: 1, width: '100%' }}
                                    disabled={isNavDisabledWithoutSelection}
                                    color={pathname === item.href ? 'primary' : undefined}
                                    onClickCapture={preventNavigationIfDisabled(isNavDisabledWithoutSelection)}
                                    onClick={handleEnabledNavClick}
                                  >
                                    <LockOutlined />
                                    <ListItemContent>
                                      <Typography level={'title-sm'}>{item.label}</Typography>
                                    </ListItemContent>
                                  </ListItemButton>
                                </Box>
                              </Tooltip>
                            )}
                          </ListItem>
                        </TransitionComponent>
                      );
                    } else {
                      const isParentDataIncomplete = item.expanded.some(subItem => {
                        const dataKey = validityMapping[subItem.href];
                        return validityReady && dataKey !== undefined && !validity[dataKey];
                      });

                      return (
                        <TransitionComponent key={item.href} in={true} direction="down">
                          <ListItem nested data-testid={`navigate-list-item-expanding-${item.label}`}>
                            <SimpleToggler
                              renderToggle={MenuRenderToggle(
                                {
                                  plotSelectionRequired: currentPlot === undefined,
                                  censusSelectionRequired: item.href !== '/fixeddatainput' && currentCensus === undefined,
                                  pathname: pathname ?? '',
                                  isParentDataIncomplete: isParentDataIncomplete
                                },
                                item,
                                toggle,
                                setToggle
                              )}
                              isOpen={!!toggle}
                            >
                              <List size={'md'}>
                                {item.expanded.map((link, _subIndex) => {
                                  const SubIcon = link.icon;
                                  const isMeasurementsViewLink = link.href === '/summary' || link.href === '/errors';
                                  const isDataIncomplete = shouldApplyTooltip(item, link.href);
                                  const isLinkDisabled = getDisabledState(link.href);
                                  const isSubLinkDisabledWithoutSelection =
                                    currentPlot === undefined || (item.href !== '/fixeddatainput' && currentCensus === undefined) || isLinkDisabled;
                                  const tooltipMessage = getTooltipMessage(link.href, isDataIncomplete || (isMeasurementsViewLink && !isAllValiditiesTrue));

                                  const handleSubLinkClick = (e: React.MouseEvent) => {
                                    if (link.href === '/postvalidation') {
                                      // Modified clicks open the anchor's href in a new tab NATIVELY:
                                      // a window.open() issued after an awaited fetch runs outside the
                                      // click's transient user activation and gets popup-blocked
                                      // (Safari always; Chrome once the fetch outlives the activation
                                      // window). The destination page handles the no-measurements case
                                      // itself — it must, since it is directly addressable by URL.
                                      if (isModifiedClick(e)) return;
                                      // Same-tab navigation stays gated on the async availability
                                      // check, so it preventDefault()s and navigates programmatically
                                      // once the fetch resolves.
                                      e.preventDefault();
                                      void (async () => {
                                        const response = await fetch(
                                          `/api/cmprevalidation/postvalidation/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}`
                                        );
                                        if (response.ok) {
                                          router.push(item.href + link.href);
                                          focusMainContent();
                                        } else {
                                          alert('No measurements found!');
                                        }
                                      })();
                                      return;
                                    }
                                    if (isModifiedClick(e)) return;
                                    focusMainContent();
                                  };
                                  return (
                                    <TransitionComponent key={link.href} in={!!toggle} direction="down">
                                      <ListItem data-testid={`navigate-list-item-expanded-${item.label}-${link.label}`}>
                                        {currentSite !== undefined &&
                                        currentPlot !== undefined &&
                                        (item.href === '/fixeddatainput' || currentCensus !== undefined) ? (
                                          <Tooltip title={tooltipMessage} arrow disableHoverListener={!isDataIncomplete}>
                                            <Box sx={{ display: 'flex', flex: 1 }} data-testid={'expanding-conditional-site-plot-census-defined-box-wrapper'}>
                                              <ListItemButton
                                                key={`${item.href}${link.href}-${isLinkDisabled ? 'locked' : 'link'}`}
                                                component={isLinkDisabled ? 'div' : NextLink}
                                                href={isLinkDisabled ? undefined : item.href + link.href}
                                                data-testid={`navigate-list-item-expanded-button-${item.label}-${link.label}-${link.href}`}
                                                sx={{ flex: 1, width: '100%' }}
                                                selected={pathname === item.href + link.href}
                                                color={pathname === item.href + link.href ? 'primary' : undefined}
                                                disabled={isLinkDisabled}
                                                onMouseEnter={navPreloadHandlers[link.href]}
                                                onFocus={navPreloadHandlers[link.href]}
                                                onClickCapture={preventNavigationIfDisabled(isLinkDisabled)}
                                                onClick={handleSubLinkClick}
                                              >
                                                <Badge
                                                  color={isMeasurementsViewLink ? 'warning' : 'danger'}
                                                  variant={
                                                    isMeasurementsViewLink ? (!isAllValiditiesTrue ? 'solid' : 'soft') : isDataIncomplete ? 'solid' : 'soft'
                                                  }
                                                  badgeContent={
                                                    isMeasurementsViewLink ? (!isAllValiditiesTrue ? '!' : undefined) : isDataIncomplete ? '!' : undefined
                                                  }
                                                  invisible={isMeasurementsViewLink ? isAllValiditiesTrue : !isDataIncomplete}
                                                  aria-label={
                                                    isMeasurementsViewLink
                                                      ? !isAllValiditiesTrue
                                                        ? 'Warning: Measurements views contain incomplete data sections'
                                                        : undefined
                                                      : isDataIncomplete
                                                        ? 'Error: Missing required data for this section'
                                                        : undefined
                                                  }
                                                >
                                                  <SubIcon />
                                                </Badge>
                                                <ListItemContent>
                                                  <Typography level={'title-sm'}>{link.label}</Typography>
                                                </ListItemContent>
                                              </ListItemButton>
                                            </Box>
                                          </Tooltip>
                                        ) : (
                                          <Tooltip
                                            title={`Choose a ${currentSite === undefined ? 'site' : currentPlot === undefined ? 'plot' : 'census'} to unlock`}
                                            arrow
                                          >
                                            <Box sx={{ display: 'flex', flex: 1 }} data-testid={'expanding-conditional-site-plot-census-undefined-box-wrapper'}>
                                              <ListItemButton
                                                component="div"
                                                sx={{ flex: 1, width: '100%' }}
                                                selected={pathname == item.href + link.href}
                                                color={pathname === item.href ? 'primary' : undefined}
                                                disabled={isSubLinkDisabledWithoutSelection}
                                                onMouseEnter={navPreloadHandlers[link.href]}
                                                onFocus={navPreloadHandlers[link.href]}
                                                onClickCapture={preventNavigationIfDisabled(isSubLinkDisabledWithoutSelection)}
                                                onClick={handleEnabledNavClick}
                                              >
                                                <LockOutlined />
                                                <ListItemContent>
                                                  <Typography level={'title-sm'}>{link.label}</Typography>
                                                </ListItemContent>
                                              </ListItemButton>
                                            </Box>
                                          </Tooltip>
                                        )}
                                      </ListItem>
                                    </TransitionComponent>
                                  );
                                })}
                              </List>
                            </SimpleToggler>
                          </ListItem>
                        </TransitionComponent>
                      );
                    }
                  })}
                </List>
              </Box>
            </Box>
          </Box>
          <Divider orientation={'horizontal'} sx={{ mb: 2, mt: 2 }} />
          <LoginLogout />
        </Box>
      </Stack>
    </>
  );
}
