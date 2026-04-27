'use client';
import * as React from 'react';
import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { preloadKey } from '@/lib/query/preload';
import { queryKey } from '@/lib/query';
import { createFetchQuery } from '@/config/servergridhelpers';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { LoginLogout } from '@/components/loginlogout';
import { siteConfigNav, SiteConfigProps, validityMapping } from '@/config/macros/siteconfigs';
import { useOrgCensusContext, useOrgCensusDispatch, usePlotContext, usePlotDispatch, useSiteContext, useSiteDispatch } from '@/app/contexts/compat-hooks';
import { usePathname, useRouter } from 'next/navigation';
import { Badge, IconButton, SelectOption, Stack, Tooltip } from '@mui/joy';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import { useOrgCensusListContext, usePlotListContext, useSiteListContext } from '@/app/contexts/compat-hooks';
import { useSession } from 'next-auth/react';
import { useLoading } from '@/app/contexts/loadingprovider';
import { TransitionComponent } from '@/components/client/clientmacros';
import ListDivider from '@mui/joy/ListDivider';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from '@mui/joy/Avatar';
import { CensusLogo, PlotLogo } from '@/components/icons';
import { RainbowIcon } from '@/styles/rainbowicon';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { Plot, Site, SitesRDS } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus, OrgCensusRDS } from '@/config/sqlrdsdefinitions/timekeeping';
import { DeleteForever, CheckCircle, Cancel, Clear } from '@mui/icons-material';
import CensusDeletionModal from '@/components/client/modals/censusdeletionmodal';
import ValidationStatusBadge from '@/components/client/validationstatusbadge';
import ailogger from '@/ailogger';

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
  return (
    <ListItemButton
      disabled={plotSelectionRequired || censusSelectionRequired}
      color={pathname === siteConfigProps.href ? 'primary' : undefined}
      onClick={() => {
        if (setMenuOpen) {
          setMenuOpen(!menuOpen);
        }
      }}
      data-testid={'menu-render-toggle'}
      sx={{ width: '100%', padding: 0, margin: 0 }}
    >
      <Tooltip data-testid={'menu-render-toggle-tooltip'} title={isParentDataIncomplete ? 'Missing Core Data!' : undefined} arrow>
        <Badge
          data-testid={'menu-render-toggle-tooltip-badge'}
          color="danger"
          variant={isParentDataIncomplete ? 'solid' : 'soft'}
          badgeContent={isParentDataIncomplete ? '!' : undefined}
          invisible={!isParentDataIncomplete || !currentSite || !currentPlot}
          aria-label={isParentDataIncomplete ? 'Warning: Some subsections have missing data' : undefined}
        >
          <Icon />
        </Badge>
      </Tooltip>
      <ListItemContent data-testid={'menu-render-toggle-content'}>
        <Typography level={'title-sm'}>{siteConfigProps.label}</Typography>
      </ListItemContent>
      <KeyboardArrowDownIcon sx={{ transform: menuOpen ? 'rotate(180deg)' : 'none' }} />
    </ListItemButton>
  );
}

interface SidebarProps {
  siteListLoaded: boolean;
  coreDataLoaded: boolean;
  /** @deprecated This prop is unused and will be removed in a future version */
  setCensusListLoaded: () => void;
  setManualReset: Dispatch<SetStateAction<boolean>>;
}

export default function Sidebar(props: SidebarProps) {
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
  const { validity } = useDataValidityContext();
  const { setLoading } = useLoading();
  const isAllValiditiesTrue = Object.entries(validity)
    .filter(([key]) => key !== 'subquadrats')
    .every(([, value]) => value);

  const router = useRouter();
  const pathname = usePathname();

  // Detect if we're on an admin page
  const isAdminPage = pathname?.includes('/admin') ?? false;

  const [measurementsToggle, setMeasurementsToggle] = useState(true);
  const [propertiesToggle, setPropertiesToggle] = useState(true);
  const [formsToggle, setFormsToggle] = useState(true);

  const { setCensusListLoaded: _setCensusListLoaded, setManualReset } = props;

  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(340); // Default width
  const [isSiteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const [isPlotDropdownOpen, setPlotDropdownOpen] = useState(false);
  const [isCensusDropdownOpen, setCensusDropdownOpen] = useState(false);
  const [isClearDropdownOpen, setIsClearDropdownOpen] = useState(false);
  const [censusToDelete, setCensusToDelete] = useState<OrgCensusRDS | null>(null);
  const [isDeletingCensus, setIsDeletingCensus] = useState(false);
  const [adminResetDone, setAdminResetDone] = useState(false);

  // Clear selections when entering admin pages
  useEffect(() => {
    if (isAdminPage && !adminResetDone) {
      const clearSelections = async () => {
        if (currentSite && siteDispatch) await siteDispatch({ site: undefined });
        if (currentPlot && plotDispatch) await plotDispatch({ plot: undefined });
        if (currentCensus && censusDispatch) await censusDispatch({ census: undefined });
      };
      clearSelections();
      setAdminResetDone(true);
    } else if (!isAdminPage) {
      setAdminResetDone(false);
    }
  }, [isAdminPage, adminResetDone, currentSite, currentPlot, currentCensus, siteDispatch, plotDispatch, censusDispatch]);

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

  // Handler for census deletion from the shared modal
  const handleCensusDelete = useCallback(
    async (deleteType: 'msmts' | 'full') => {
      const censusID = censusToDelete?.dateRanges?.[0]?.censusID;
      if (!currentSite?.schemaName || !censusID) {
        ailogger.error('Missing required context: schema or censusID', undefined, {
          schema: currentSite?.schemaName || 'unknown',
          censusID: censusID || 'unknown'
        });
        setIsClearDropdownOpen(false);
        setCensusToDelete(null);
        return;
      }

      setIsDeletingCensus(true);
      const loadingMessage = deleteType === 'msmts' ? 'Deleting census measurements...' : 'Deleting census measurements and fixed data...';
      setLoading(true, loadingMessage);
      setIsClearDropdownOpen(false);

      try {
        const response = await fetch(`/api/clearcensus?schema=${currentSite.schemaName}&censusID=${censusID}&type=${deleteType}`);
        if (!response.ok) {
          throw new Error(`Failed to clear census: ${response.status}`);
        }
        setCensusToDelete(null);
        setManualReset(true);
      } catch (error: any) {
        ailogger.error(`Failed to delete census: ${error?.message ?? error}`, error instanceof Error ? error : undefined);
      } finally {
        setLoading(false);
        setIsDeletingCensus(false);
      }
    },
    [censusToDelete, currentSite?.schemaName, setLoading, setManualReset]
  );

  const renderSiteValue = (option: SelectOption<number> | null) => {
    if (!option) {
      return <Typography data-testid={'pending-site-select'}>Select a Site</Typography>;
    }

    const selectedValue = option.value;
    const selectedSite = siteListContext?.find(c => c?.siteID === selectedValue);
    return (
      <>
        {selectedSite ? (
          <Stack direction={'column'} alignItems={'start'} aria-label={'site value render stack'}>
            <Typography
              id={'site-selected'}
              level="body-lg"
              className="sidebar-item"
              data-testid={'selected-site-name'}
            >{`Site: ${selectedSite?.siteName}`}</Typography>
            <Stack direction={'column'} alignItems={'start'} aria-labelledby={'site-selected'}>
              <Typography level="body-sm" color={'primary'} className="sidebar-item" data-testid={'selected-site-schema'}>
                &mdash; Schema: {selectedSite.schemaName}
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
          <Stack direction="column" alignItems="start" aria-label={'plot value render stack'}>
            <Typography level="body-md" className="sidebar-item" data-testid={'selected-plot-name'}>{`Plot: ${selectedPlot?.plotName}`}</Typography>
            <Box aria-label={'selected plot information'} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
              <Typography level="body-sm" color={'primary'} data-testid={'selected-plot-quadrats'}>
                &mdash; {selectedPlot.numQuadrats || selectedPlot.numQuadrats === 0 ? `Quadrats: ${selectedPlot.numQuadrats}` : 'No Quadrats'}
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
        {hasStartDate && <Typography display="block">&mdash;{` First Record: ${new Date(startDate).toDateString()}`}</Typography>}
        {hasEndDate && <Typography display="block">&mdash;{` Last Record: ${new Date(endDate).toDateString()}`}</Typography>}
        {!hasStartDate && !hasEndDate && <Typography display="block">No Measurements</Typography>}
      </span>
    );

    return (
      <Stack direction={'column'} alignItems={'start'} id={'selected-census-stack'}>
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
      placeholder="Select a Census. Required"
      className="census-select sidebar-item"
      name="None"
      required
      size={'md'}
      value={currentCensus?.plotCensusNumber?.toString() || ''}
      renderValue={renderCensusValue}
      data-testid={'census-select-component'}
      aria-label="Select a Census. Required field for accessing measurement tools"
      listboxOpen={isCensusDropdownOpen}
      onListboxOpenChange={() => {
        setSiteDropdownOpen(false);
        setPlotDropdownOpen(false);
        setCensusDropdownOpen(true);
      }}
      onClose={() => setCensusDropdownOpen(false)}
      onChange={async (_event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
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
              aria-label={`Census ${item?.plotCensusNumber}${item?.dateRanges?.length ? `, first measurement: ${item.dateRanges?.[0]?.startDate ? new Date(item.dateRanges?.[0]?.startDate).toDateString() : 'No measurements'}` : ''}`}
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
                      <React.Fragment key={index}>
                        <Stack direction={'row'}>
                          <Typography level="body-sm" color={'neutral'}>
                            {`${dateRange.startDate ? ` — First Msmt: ${new Date(dateRange.startDate).toDateString()}` : ' — No Measurements'}`}
                          </Typography>
                          {dateRange.endDate && (
                            <Typography level="body-sm" color={'neutral'} sx={{ paddingLeft: '1em', paddingRight: '1em' }}>
                              &lt;===&gt;
                            </Typography>
                          )}
                          <Typography level="body-sm" color={'neutral'}>
                            {`${dateRange.endDate ? ` — Last Msmt: ${new Date(dateRange.endDate).toDateString()}` : ''}`}
                          </Typography>
                        </Stack>
                      </React.Fragment>
                    ))}
                </Box>
                <IconButton
                  variant={'soft'}
                  color={'danger'}
                  onClick={e => {
                    e.stopPropagation(); // Prevent dropdown selection
                    if (item) setCensusToDelete(item);
                    setIsClearDropdownOpen(true);
                  }}
                  disabled={
                    (item?.plotCensusNumber ?? 0) <
                    (Array.isArray(censusListContext)
                      ? censusListContext.reduce((currentMax, item) => Math.max(currentMax, item?.plotCensusNumber ?? 0), 0)
                      : 0)
                  }
                >
                  <DeleteForever />
                </IconButton>
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
          <CheckCircle sx={{ fontSize: 16, color: 'success.500' }} />
          <Typography level="body-xs" sx={{ textTransform: 'uppercase', color: 'success.500', fontWeight: 'lg' }}>
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
                &mdash; Quadrats: {item?.numQuadrats}
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
                &mdash; No Quadrats
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
        sx={{ marginRight: '1em' }}
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
        onChange={async (_event: React.SyntheticEvent | null, newValue: number | null) => {
          const selectedSite = newValue ? siteListContext?.find(site => site?.siteID === newValue) : undefined;
          await handleSiteSelection(selectedSite);
        }}
      >
        <List>
          <ListItem sticky className="sidebar-item">
            <Typography level="body-xs" textTransform="uppercase">
              Deselect Site (will trigger app reset!):
            </Typography>
          </ListItem>
          <Option key="none" value={null as unknown as number} aria-label="Deselect site, will trigger application reset">
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
        <ListDivider role="none" />
        <List sx={{ '--ListItemDecorator-size': '28px' }}>
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
    const summaryKey = queryKey('grid:measurementssummary', scope, { page: PAGE_ZERO, pageSize: DEFAULT_PAGE_SIZE });
    const summaryURL = createFetchQuery(schema, 'measurementssummary', PAGE_ZERO, DEFAULT_PAGE_SIZE, plotID, plotCensusNumber);
    const errorsKey = queryKey('grid:failedmeasurements', scope, { page: PAGE_ZERO, pageSize: DEFAULT_PAGE_SIZE });
    const errorsURL = createFetchQuery(schema, 'failedmeasurements', PAGE_ZERO, DEFAULT_PAGE_SIZE, plotID, plotCensusNumber);
    const attributesKey = queryKey('grid:attributes', scope, { page: PAGE_ZERO, pageSize: DEFAULT_PAGE_SIZE });
    const attributesURL = createFetchQuery(schema, 'attributes', PAGE_ZERO, DEFAULT_PAGE_SIZE, plotID, plotCensusNumber);

    return {
      '/summary': () => preloadKey(summaryKey, summaryURL),
      '/errors': () => preloadKey(errorsKey, errorsURL),
      '/attributes': () => preloadKey(attributesKey, attributesURL)
    };
  }, [
    currentSite?.schemaName,
    currentPlot?.plotID,
    currentCensus?.plotCensusNumber,
    currentCensus?.dateRanges
  ]);

  const shouldApplyTooltip = (item: SiteConfigProps, linkHref?: string): boolean => {
    if (linkHref) {
      // Check for sub-links
      switch (linkHref) {
        case '/summary':
        case '/errors':
          return !isAllValiditiesTrue;
        case '/subquadrats':
          return !validity['quadrats'];
        case '/quadratpersonnel':
          return !validity['quadrats'];
        default:
          const dataKey = validityMapping[linkHref];
          return dataKey !== undefined && !validity[dataKey];
      }
    } else {
      // Check for main links
      switch (item.href) {
        case '/summary':
          return !isAllValiditiesTrue;
        case '/subquadrats':
          return !validity['quadrats'];
        case '/quadratpersonnel':
          return !validity['quadrats'];
        default:
          return false;
      }
    }
  };

  return (
    <>
      <Stack direction={'row'} sx={{ display: 'flex', width: 'fit-content' }}>
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
            width: `${sidebarWidth}px`,
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
                <Typography level="h1">
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
                            '&:hover': { bgcolor: 'danger.softBg', color: 'danger.500' }
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
                                '&:hover': { bgcolor: 'danger.softBg', color: 'danger.500' }
                              }}
                              aria-label="Clear census selection"
                            >
                              <Clear sx={{ fontSize: 18 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                      {currentCensus && (
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
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
                          return !validity['quadrats'];
                        case '/quadratpersonnel':
                          return !validity['quadrats'];
                        default:
                          return false;
                      }
                    };

                    if (item.expanded.length === 0) {
                      const isDashboard = item.href === '/dashboard';
                      const isLinkDisabled = isDashboard ? false : getDisabledState(item.href);
                      const isDataIncomplete = isDashboard ? false : shouldApplyTooltip(item);

                      const handleDashboardClick = async () => {
                        await handleCensusSelection(undefined);
                        router.push('/dashboard');
                        setTimeout(() => {
                          const mainContent = document.getElementById('main-content');
                          if (mainContent) {
                            mainContent.focus();
                            mainContent.scrollIntoView();
                          }
                        }, 100);
                      };

                      const handleNavClick = () => {
                        if (!isLinkDisabled) {
                          router.push(item.href);
                          setTimeout(() => {
                            const mainContent = document.getElementById('main-content');
                            if (mainContent) {
                              mainContent.focus();
                              mainContent.scrollIntoView();
                            }
                          }, 100);
                        }
                      };

                      // Dashboard button is always visible, other non-expanding items require site+plot
                      const transitionIn = isDashboard ? true : currentSite !== undefined && currentPlot !== undefined;

                      return (
                        <TransitionComponent key={item.href} in={transitionIn} direction="down">
                          <ListItem data-testid={`navigate-list-item-nonexpanding-${item.label}`}>
                            {isDashboard ? (
                              <Box sx={{ display: 'flex', flex: 1 }} data-testid={'dashboard-nav-wrapper'}>
                                <ListItemButton
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
                                    selected={pathname === item.href}
                                    data-testid={`navigate-list-item-button-nonexpanding-${item.href}`}
                                    sx={{ flex: 1, width: '100%' }}
                                    disabled={isLinkDisabled}
                                    color={pathname === item.href ? 'primary' : undefined}
                                    onClick={handleNavClick}
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
                              <Box sx={{ display: 'flex', flex: 1 }} data-testid={'conditional-site-plot-census-undefined-box-wrapper'}>
                                <ListItemButton
                                  selected={pathname === item.href}
                                  sx={{ flex: 1, width: '100%' }}
                                  disabled={currentPlot === undefined || currentCensus === undefined || isLinkDisabled}
                                  color={pathname === item.href ? 'primary' : undefined}
                                  onClick={handleNavClick}
                                >
                                  <Icon />
                                  <ListItemContent>
                                    <Typography level={'title-sm'}>{item.label}</Typography>
                                  </ListItemContent>
                                </ListItemButton>
                              </Box>
                            )}
                          </ListItem>
                        </TransitionComponent>
                      );
                    } else {
                      const isParentDataIncomplete = item.expanded.some(subItem => {
                        const dataKey = validityMapping[subItem.href];
                        return dataKey !== undefined && !validity[dataKey];
                      });

                      return (
                        <TransitionComponent key={item.href} in={currentSite !== undefined && currentPlot !== undefined} direction="down">
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
                                  const tooltipMessage = getTooltipMessage(link.href, isDataIncomplete || (isMeasurementsViewLink && !isAllValiditiesTrue));
                                  return (
                                    <TransitionComponent key={link.href} in={!!toggle} direction="down">
                                      <ListItem data-testid={`navigate-list-item-expanded-${item.label}-${link.label}`}>
                                        {currentSite !== undefined &&
                                        currentPlot !== undefined &&
                                        (item.href === '/fixeddatainput' || currentCensus !== undefined) ? (
                                          <Tooltip title={tooltipMessage} arrow disableHoverListener={!isDataIncomplete}>
                                            <Box sx={{ display: 'flex', flex: 1 }} data-testid={'expanding-conditional-site-plot-census-defined-box-wrapper'}>
                                              <ListItemButton
                                                data-testid={`navigate-list-item-expanded-button-${item.label}-${link.label}-${link.href}`}
                                                sx={{ flex: 1, width: '100%' }}
                                                selected={pathname === item.href + link.href}
                                                color={pathname === item.href + link.href ? 'primary' : undefined}
                                                disabled={isLinkDisabled}
                                                onMouseEnter={navPreloadHandlers[link.href]}
                                                onFocus={navPreloadHandlers[link.href]}
                                                onClick={async () => {
                                                  if (link.href === '/postvalidation') {
                                                    const response = await fetch(
                                                      `/api/cmprevalidation/postvalidation/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}`
                                                    );
                                                    if (response.ok) {
                                                      router.push(item.href + link.href);
                                                      // Move focus to main content after navigation
                                                      setTimeout(() => {
                                                        const mainContent = document.getElementById('main-content');
                                                        if (mainContent) {
                                                          mainContent.focus();
                                                          mainContent.scrollIntoView();
                                                        }
                                                      }, 100);
                                                      return;
                                                    } else {
                                                      alert('No measurements found!');
                                                      return;
                                                    }
                                                  } else if (!isLinkDisabled) {
                                                    router.push(item.href + link.href);
                                                    // Move focus to main content after navigation
                                                    setTimeout(() => {
                                                      const mainContent = document.getElementById('main-content');
                                                      if (mainContent) {
                                                        mainContent.focus();
                                                        mainContent.scrollIntoView();
                                                      }
                                                    }, 100);
                                                    return;
                                                  }
                                                }}
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
                                          <Box sx={{ display: 'flex', flex: 1 }} data-testid={'expanding-conditional-site-plot-census-undefined-box-wrapper'}>
                                            <ListItemButton
                                              sx={{ flex: 1, width: '100%' }}
                                              selected={pathname == item.href + link.href}
                                              color={pathname === item.href ? 'primary' : undefined}
                                              disabled={
                                                currentPlot === undefined || (item.href !== '/fixeddatainput' && currentCensus === undefined) || isLinkDisabled
                                              }
                                              onMouseEnter={navPreloadHandlers[link.href]}
                                              onFocus={navPreloadHandlers[link.href]}
                                              onClick={() => {
                                                if (!isLinkDisabled) {
                                                  router.push(item.href + link.href);
                                                  // Move focus to main content after navigation
                                                  setTimeout(() => {
                                                    const mainContent = document.getElementById('main-content');
                                                    if (mainContent) {
                                                      mainContent.focus();
                                                      mainContent.scrollIntoView();
                                                    }
                                                  }, 100);
                                                }
                                              }}
                                            >
                                              <SubIcon />
                                              <ListItemContent>
                                                <Typography level={'title-sm'}>{link.label}</Typography>
                                              </ListItemContent>
                                            </ListItemButton>
                                          </Box>
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
        <CensusDeletionModal
          open={isClearDropdownOpen}
          onClose={() => {
            setIsClearDropdownOpen(false);
            setCensusToDelete(null);
          }}
          onDelete={handleCensusDelete}
          census={censusToDelete}
          isDeleting={isDeletingCensus}
        />
      </Stack>
    </>
  );
}
