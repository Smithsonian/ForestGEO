'use client';
import * as React from 'react';
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton, { listItemButtonClasses } from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { LoginLogout } from '@/components/loginlogout';
import { siteConfigNav, SiteConfigProps, validityMapping } from '@/config/macros/siteconfigs';
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch
} from '@/app/contexts/userselectionprovider';
import { usePathname, useRouter } from 'next/navigation';
import { Badge, IconButton, Menu, MenuItem, SelectOption, Stack, Tooltip } from '@mui/joy';
import AddIcon from '@mui/icons-material/Add';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';
import { useOrgCensusListContext, usePlotListContext, useSiteListContext } from '@/app/contexts/listselectionprovider';
import { useSession } from 'next-auth/react';
import { TransitionComponent } from '@/components/client/clientmacros';
import ListDivider from '@mui/joy/ListDivider';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from '@mui/joy/Avatar';
import { CensusLogo, PlotLogo } from '@/components/icons';
import { RainbowIcon } from '@/styles/rainbowicon';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';

import RolloverModal from './client/rollovermodal';
import RolloverStemsModal from './client/rolloverstemsmodal';
import { Plot, Site } from '@/config/sqlrdsdefinitions/zones';
import { OrgCensus, OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/timekeeping';
import { DeleteForever, MoreHoriz } from '@mui/icons-material';
import PlotCardModal from '@/components/client/plotcardmodal';

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
  const currentCensus = useOrgCensusContext();
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
          invisible={!isParentDataIncomplete || !currentSite || !currentPlot || !currentCensus}
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
  setCensusListLoaded: Dispatch<SetStateAction<boolean>>;
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
  const isAllValiditiesTrue = Object.entries(validity)
    .filter(([key]) => key !== 'subquadrats')
    .every(([, value]) => value);

  const [plot, setPlot] = useState<Plot>(currentPlot);
  const [census, setCensus] = useState<OrgCensus>(currentCensus);
  const [site, setSite] = useState<Site>(currentSite);
  const router = useRouter();
  const pathname = usePathname();

  const [measurementsToggle, setMeasurementsToggle] = useState(true);
  const [propertiesToggle, setPropertiesToggle] = useState(true);
  const [formsToggle, setFormsToggle] = useState(true);

  const [storedPlot, setStoredPlot] = useState<Plot>();
  const [storedCensus, setStoredCensus] = useState<OrgCensus>();
  const [storedSite, setStoredSite] = useState<Site>();

  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState(false);
  const [isRolloverStemsModalOpen, setIsRolloverStemsModalOpen] = useState(false);

  const { siteListLoaded, setCensusListLoaded, setManualReset } = props;

  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(340); // Default width
  const [anchorPlotEdit, setAnchorPlotEdit] = useState<HTMLElement | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<Plot>(undefined);
  const [openPlotCardModal, setOpenPlotCardModal] = useState(false);
  const [isSiteDropdownOpen, setSiteDropdownOpen] = useState(false);
  const [isPlotDropdownOpen, setPlotDropdownOpen] = useState(false);
  const [isCensusDropdownOpen, setCensusDropdownOpen] = useState(false);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorPlotEdit(event.currentTarget);
  };

  const handleClose = (event?: MouseEvent) => {
    const target = event?.target as HTMLElement;
    const selectElement = sidebarRef.current?.querySelector('.plot-selection');
    const menuElement = sidebarRef.current?.querySelector('.MuiMenu-root');
    if (menuElement?.contains(target)) {
      return;
    }
    if (selectElement?.contains(target)) {
      if (anchorPlotEdit) {
        setAnchorPlotEdit(null);
      }
      return;
    }
    setAnchorPlotEdit(null);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      handleClose(event);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [anchorPlotEdit]);

  const handleOptionClick = () => {
    setOpenPlotCardModal(true);
    setTimeout(() => handleClose(), 0); // Delay to ensure modal state updates first
  };

  useEffect(() => {
    const updateSidebarWidth = () => {
      if (sidebarRef.current) {
        const sidebarElements = sidebarRef.current.querySelectorAll('*');
        let maxWidth = 340; // Minimum width

        sidebarElements.forEach(element => {
          if (sidebarRef.current) {
            const elementRect = element.getBoundingClientRect();
            const sidebarRect = sidebarRef.current.getBoundingClientRect();
            const elementWidth = elementRect.right - sidebarRect.left;

            if (elementWidth > maxWidth) {
              maxWidth = elementWidth;
            }
          }
        });

        setSidebarWidth(Math.min(maxWidth + 10, 500));
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      updateSidebarWidth();
    });

    if (sidebarRef.current) {
      const sidebarElements = sidebarRef.current.querySelectorAll('*');
      sidebarElements.forEach(element => {
        resizeObserver.observe(element);
      });
    }

    // Initial calculation
    updateSidebarWidth();

    return () => {
      resizeObserver.disconnect();
    };
  }, [site, plot, census]);
  const handleOpenNewCensus = async () => {
    if (site === undefined || site.schemaName === undefined || plot === undefined || plot.plotID === undefined)
      throw new Error('new census start date was not set OR plot is undefined');
    setIsRolloverModalOpen(true);
  };

  const handleConfirmRollover = async (rolledOverPersonnel: boolean, rolledOverQuadrats: boolean) => {
    if (!rolledOverPersonnel && !rolledOverQuadrats) {
      // didn't roll over anything, need to create a new census still:
      // createdCensusID is undefined here
      const highestPlotCensusNumber =
        censusListContext && censusListContext.length > 0
          ? censusListContext.reduce(
              (max, census) => ((census?.plotCensusNumber ?? 0) > max ? (census?.plotCensusNumber ?? 0) : max),
              censusListContext[0]?.plotCensusNumber ?? 0
            )
          : 0;

      const mapper = new OrgCensusToCensusResultMapper();
      const newCensusID = await mapper.startNewCensus(currentSite?.schemaName ?? '', currentPlot?.plotID ?? 0, highestPlotCensusNumber + 1);
      if (!newCensusID) throw new Error('census creation failure');
      await new Promise(resolve => setTimeout(resolve, 300)); // debounce
    } else {
      await new Promise(resolve => setTimeout(resolve, 300)); // debounce
      // if (rolledOverQuadrats) { // passing census list loading trigger to stems rollover function:
      //   setIsRolloverStemsModalOpen(true);
      // } else setCensusListLoaded(false);
      // rollover of stems functionality created from testing component initially used to test personnel/quadrat rollover
      // (seemed a shame to just delete it when I could just rename the references stems)
      // will be added in the event that it is requested
    }
    setIsRolloverModalOpen(false);
    setCensusListLoaded(false);
  };

  const handleConfirmStemsRollover = async (rolledOverStems: boolean) => {
    // assumption: new census has already been created, BUT census list has not been reloaded
    // stored in createdCensusID
    // additional note: dialog handles actual rollover process. do not need to perform any API calls here.
    // --> stem rollover will not be triggered if quadrats are NOT rolled over
    setIsRolloverStemsModalOpen(false);
    await new Promise(resolve => setTimeout(resolve, 100));
    setCensusListLoaded(false);
  };

  useEffect(() => {
    setPlot(currentPlot);
    setCensus(currentCensus);
    setSite(currentSite);
  }, [currentPlot, currentCensus, currentSite]);

  useEffect(() => {
    if (storedSite && session) {
      const allowedSiteIDs = new Set(session.user.sites.map(site => site.siteID));
      if (allowedSiteIDs.has(storedSite.siteID)) {
        handleResumeSession().catch(console.error);
      } else {
        handleSiteSelection(undefined).catch(console.error);
      }
    }
  }, [storedSite, storedPlot, storedCensus, siteListLoaded]);

  const handleSiteSelection = async (selectedSite: Site | undefined) => {
    setSite(selectedSite);
    if (siteDispatch) {
      await siteDispatch({ site: selectedSite });
    }
    if (selectedSite === undefined) {
      await handlePlotSelection(undefined);
    }
  };

  const handlePlotSelection = async (selectedPlot: Plot) => {
    setPlot(selectedPlot);
    if (plotDispatch) {
      await plotDispatch({ plot: selectedPlot });
    }
    if (selectedPlot === undefined) {
      await handleCensusSelection(undefined);
    }
  };

  const handleCensusSelection = async (selectedCensus: OrgCensus) => {
    setCensus(selectedCensus);
    if (censusDispatch) {
      await censusDispatch({ census: selectedCensus });
      console.log(`await census dispatch completed for ${selectedCensus}`);
    }
  };

  const handleResumeSession = async () => {
    storedSite ? await handleSiteSelection(storedSite) : undefined;
    storedPlot ? await handlePlotSelection(storedPlot) : undefined;
    storedCensus ? await handleCensusSelection(storedCensus) : undefined;
  };

  const renderSiteValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography data-testid={'pending-site-select'}>Select a Site</Typography>;
    }

    const selectedValue = option.value;
    const selectedSite = siteListContext?.find(c => c?.siteName?.toString() === selectedValue);
    return (
      <>
        {selectedSite ? (
          <Stack direction={'column'} alignItems={'start'}>
            <Typography level="body-lg" className="sidebar-item" data-testid={'selected-site-name'}>{`Site: ${selectedSite?.siteName}`}</Typography>
            <Stack direction={'column'} alignItems={'start'}>
              <Typography level="body-sm" color={'primary'} className="sidebar-item" data-testid={'selected-site-schema'}>
                &mdash; Schema: {selectedSite.schemaName}
              </Typography>
            </Stack>
          </Stack>
        ) : (
          <Typography level="body-lg" className="sidebar-item" data-testid={'pending-site-select'}>
            Select a Site
          </Typography>
        )}
      </>
    );
  };

  const renderPlotValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography data-testid={'pending-plot-select'}>Select a Plot</Typography>;
    }

    const selectedValue = option.value;
    const selectedPlot = plotListContext?.find(c => c?.plotName === selectedValue);

    return (
      <>
        {selectedPlot ? (
          <Stack direction="column" alignItems="start">
            <Typography level="body-md" className="sidebar-item" data-testid={'selected-plot-name'}>{`Plot: ${selectedPlot?.plotName}`}</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
              <Typography level="body-sm" color={'primary'} data-testid={'selected-plot-quadrats'}>
                &mdash; {selectedPlot.numQuadrats || selectedPlot.numQuadrats === 0 ? `Quadrats: ${selectedPlot.numQuadrats}` : 'No Quadrats'}
              </Typography>
            </Box>
          </Stack>
        ) : (
          <Typography className="sidebar-item" data-testid={'pending-plot-select'}>
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

    const startDate = census?.dateRanges[0]?.startDate;
    const endDate = census?.dateRanges[0]?.endDate;

    const hasStartDate = startDate !== undefined && startDate !== null;
    const hasEndDate = endDate !== undefined && endDate !== null;

    // Ensure dates are rendered in a block layout to stack them vertically
    const dateMessage = (
      <>
        {hasStartDate && <Typography display="block">&mdash;{` First Record: ${new Date(startDate).toDateString()}`}</Typography>}
        {hasEndDate && <Typography display="block">&mdash;{` Last Record: ${new Date(endDate).toDateString()}`}</Typography>}
        {!hasStartDate && !hasEndDate && <Typography display="block">No Measurements</Typography>}
      </>
    );

    return (
      <Stack direction={'column'} alignItems={'start'}>
        <Typography level="body-md" className="sidebar-item" data-testid={'selected-census-plotcensusnumber'}>
          {`Census: ${selectedCensus?.plotCensusNumber}`}
        </Typography>
        <Stack direction={'column'} alignItems={'start'}>
          <Typography color={!census ? 'danger' : 'primary'} level="body-sm" className="sidebar-item" data-testid={'selected-census-dates'}>
            {census !== undefined && dateMessage}
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
      placeholder="Select a Census"
      className="census-select sidebar-item"
      name="None"
      required
      autoFocus
      size={'md'}
      renderValue={renderCensusValue}
      data-testid={'census-select-component'}
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
      <ListItem
        onMouseDown={event => event.preventDefault()} // Prevents closing the dropdown
        onClick={event => event.stopPropagation()} // Prevents any response
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%'
          }}
        >
          <Typography level="body-sm" color="primary">
            Add New Census
          </Typography>
          <IconButton
            size="sm"
            color="primary"
            data-testid={'add-new-census-button'}
            onClick={event => {
              event.stopPropagation();
              handleOpenNewCensus();
            }}
          >
            <AddIcon />
          </IconButton>
        </Box>
      </ListItem>
      <Divider orientation={'horizontal'} sx={{ my: 1 }} />
      {censusListContext
        ?.sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0))
        .map(item => (
          <Option data-testid={'census-selection-option'} key={item?.plotCensusNumber} value={item?.plotCensusNumber?.toString()}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%'
              }}
              className="sidebar-item"
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                <Typography level="body-lg" data-testid={'census-selection-option-plotcensusnumber'}>
                  Census: {item?.plotCensusNumber}
                </Typography>
                {item?.dateRanges?.map((dateRange, index) => (
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
                onClick={async () => {
                  await fetch(`/api/clearcensus?schema=${site?.schemaName}&censusID=${item?.dateRanges[0].censusID}`);
                  setManualReset(true);
                }}
              >
                <DeleteForever />
              </IconButton>
            </Box>
          </Option>
        ))}
    </Select>
  );

  const renderPlotOptions = () => (
    <Select
      placeholder="Select a Plot"
      className="plot-selection"
      name="None"
      required
      autoFocus
      size={'md'}
      data-testid={'plot-select-component'}
      renderValue={renderPlotValue}
      value={plot?.plotName || ''}
      listboxOpen={isPlotDropdownOpen}
      onListboxOpenChange={() => {
        setSiteDropdownOpen(false);
        setPlotDropdownOpen(true);
        setCensusDropdownOpen(false);
      }}
      onClose={() => setPlotDropdownOpen(false)}
      onFocus={event => event.preventDefault()}
      onChange={async (event: React.SyntheticEvent | null, newValue: string | null) => {
        event?.preventDefault();
        const selectedPlot = plotListContext?.find(plot => plot?.plotName === newValue) || undefined;
        await handlePlotSelection(selectedPlot);
      }}
    >
      {plotListContext?.map(item => (
        <Option value={item?.plotName} key={item?.plotName} data-testid={'plot-selection-option'}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              width: '100%'
            }}
            className="sidebar-item"
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
              <Stack direction={'row'} justifyContent={'space-between'} alignItems={'center'} width={'100%'}>
                <Typography level="body-md" data-testid={'plot-selection-option-plotname'}>
                  {item?.plotName}
                </Typography>
                <IconButton
                  variant={'soft'}
                  sx={{
                    justifyContent: 'center',
                    alignSelf: 'center'
                  }}
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => {
                    event.preventDefault();
                    setSelectedPlot(item);
                    handleOpen(event);
                  }}
                  // disabled={!(session?.user?.userStatus === 'db admin' || session?.user?.userStatus === 'global')}
                  disabled={!['db admin', 'global'].includes(session?.user?.userStatus ?? '')}
                >
                  <MoreHoriz />
                </IconButton>
              </Stack>
              <Typography level="body-sm" color={'primary'} data-testid={'plot-selection-option-quadrats'}>
                {item?.numQuadrats ? ` — Quadrats: ${item.numQuadrats}` : ` — No Quadrats`}
              </Typography>
            </Box>
          </Box>
        </Option>
      ))}
    </Select>
  );
  const renderSiteOptions = () => {
    const allowedSites = siteListContext
      ?.filter(site => session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID))
      .sort((a, b) => {
        const nameA = a.siteName?.toLowerCase() ?? '';
        const nameB = b.siteName?.toLowerCase() ?? '';
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });
    const otherSites = siteListContext
      ?.filter(site => !session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID))
      .sort((a, b) => {
        const nameA = a.siteName?.toLowerCase() ?? '';
        const nameB = b.siteName?.toLowerCase() ?? '';
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });

    return (
      <Select
        className="site-select sidebar-item"
        aria-label={'Select a Site'}
        placeholder="Select a Site"
        name="None"
        required
        autoFocus
        sx={{ marginRight: '1em' }}
        size={'md'}
        renderValue={renderSiteValue}
        data-testid={'site-select-component'}
        value={site ? siteListContext?.find(i => i.siteName === site.siteName)?.siteName : ''}
        listboxOpen={isSiteDropdownOpen}
        onListboxOpenChange={() => {
          setSiteDropdownOpen(true);
          setPlotDropdownOpen(false);
          setCensusDropdownOpen(false);
        }}
        onClose={() => setSiteDropdownOpen(false)}
        onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
          const selectedSite = siteListContext?.find(site => site?.siteName === newValue) || undefined;
          await handleSiteSelection(selectedSite);
        }}
      >
        <List>
          <ListItem sticky className="sidebar-item">
            <Typography level="body-xs" textTransform="uppercase">
              Deselect Site (will trigger app reset!):
            </Typography>
          </ListItem>
          <Option key="none" value="">
            None
          </Option>
        </List>
        <ListDivider role="none" />
        <List sx={{ '--ListItemDecorator-size': '28px' }}>
          <ListItem id="allowed-sites-group" sticky className="sidebar-item">
            <Typography level="body-xs" textTransform="uppercase">
              Allowed Sites ({allowedSites?.length})
            </Typography>
          </ListItem>
          {allowedSites?.map(site => (
            <Option key={site.siteID} value={site.siteName} data-testid={'site-selection-option-allowed'}>
              {site.siteName}
            </Option>
          ))}
        </List>
        <ListDivider role="none" />
        <List sx={{ '--ListItemDecorator-size': '28px' }}>
          <ListItem id="other-sites-group" sticky className="sidebar-item">
            <Typography level="body-xs" textTransform="uppercase">
              Other Sites ({otherSites?.length})
            </Typography>
          </ListItem>
          {otherSites?.map(site => (
            <Option key={site.siteID} value={site.siteName} disabled data-testid={'site-selection-option-other'}>
              {site.siteName}
            </Option>
          ))}
        </List>
      </Select>
    );
  };

  const shouldApplyTooltip = (item: SiteConfigProps, linkHref?: string): boolean => {
    if (linkHref) {
      // Check for sub-links
      switch (linkHref) {
        case '/summary':
          return !isAllValiditiesTrue;
        case '/subquadrats':
          return !validity['quadrats'];
        case '/quadratpersonnel':
          return !(validity['quadrats'] && validity['personnel']);
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
          return !(validity['quadrats'] && validity['personnel']);
        default:
          return false;
      }
    }
  };

  return (
    <>
      <Stack direction={'row'} sx={{ display: 'flex', width: 'fit-content' }}>
        <Box
          ref={sidebarRef}
          className="Sidebar"
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
            overflowY: 'auto'
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
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }}>
                <Avatar sx={{ marginRight: 1 }}>
                  <TravelExploreIcon />
                </Avatar>
                <Box sx={{ flexGrow: 1 }}>{renderSiteOptions()}</Box>
              </Box>
              {site !== undefined && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid={'plot-selection-box'}>
                    <Avatar size={'sm'} sx={{ marginRight: 1 }}>
                      <PlotLogo />
                    </Avatar>
                    <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center', marginRight: '1em' }}>{renderPlotOptions()}</Box>
                  </Box>
                  {plot !== undefined && (
                    <>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }} data-testid={'census-selection-box'}>
                        <Avatar size={'sm'} sx={{ marginRight: 1 }}>
                          <CensusLogo />
                        </Avatar>
                        <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center', marginRight: '1em' }}>{renderCensusOptions()}</Box>
                      </Box>
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
                  flexDirection: 'column',
                  [`& .${listItemButtonClasses.root}`]: {
                    // gap: 1.5,
                  }
                }}
              >
                <List
                  size="lg"
                  sx={{
                    // gap: 1,
                    '--List-nestedInsetStart': '30px',
                    '--ListItem-radius': theme => theme.vars.radius.sm
                  }}
                >
                  {siteConfigNav.map((item, index: number) => {
                    const Icon = item.icon;
                    const { toggle, setToggle } = toggleArray[index];
                    const delay = index * 200;

                    const getTooltipMessage = (href: string, isDataIncomplete: boolean) => {
                      if (isDataIncomplete) {
                        switch (href) {
                          case '/summary':
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
                          return !isAllValiditiesTrue;
                        case '/subquadrats':
                          return !validity['quadrats'];
                        case '/quadratpersonnel':
                          return !(validity['quadrats'] && validity['personnel']);
                        default:
                          return false;
                      }
                    };

                    if (item.expanded.length === 0) {
                      const isLinkDisabled = getDisabledState(item.href);
                      const isDataIncomplete = shouldApplyTooltip(item);

                      return (
                        <TransitionComponent
                          key={item.href}
                          in={site !== undefined && plot !== undefined}
                          // style={{ transitionDelay: `${delay}ms` }}
                          direction="down"
                        >
                          <ListItem data-testid={`navigate-list-item-nonexpanding-${item.label}`}>
                            {site !== undefined && plot !== undefined && census !== undefined ? (
                              <Tooltip title={isDataIncomplete ? 'Missing Core Data!' : ''} arrow disableHoverListener={!isDataIncomplete}>
                                <Box sx={{ display: 'flex', flex: 1 }} data-testid={'conditional-site-plot-census-defined-box-wrapper'}>
                                  <ListItemButton
                                    selected={pathname === item.href}
                                    data-testid={`navigate-list-item-button-nonexpanding-${item.href}`}
                                    sx={{ flex: 1, width: '100%' }}
                                    disabled={isLinkDisabled}
                                    color={pathname === item.href ? 'primary' : undefined}
                                    onClick={() => {
                                      if (!isLinkDisabled) {
                                        router.push(item.href);
                                      }
                                    }}
                                  >
                                    <Badge
                                      color="danger"
                                      variant={isDataIncomplete ? 'solid' : 'soft'}
                                      badgeContent={isDataIncomplete ? '!' : undefined}
                                      invisible={!isDataIncomplete}
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
                                  disabled={plot === undefined || census === undefined || isLinkDisabled}
                                  color={pathname === item.href ? 'primary' : undefined}
                                  onClick={() => {
                                    if (!isLinkDisabled) {
                                      router.push(item.href);
                                    }
                                  }}
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
                        <TransitionComponent
                          key={item.href}
                          in={site !== undefined && plot !== undefined}
                          // style={{ transitionDelay: `${delay}ms` }}
                          direction="down"
                        >
                          <ListItem nested data-testid={`navigate-list-item-expanding-${item.label}`}>
                            <SimpleToggler
                              renderToggle={MenuRenderToggle(
                                {
                                  plotSelectionRequired: plot === undefined,
                                  censusSelectionRequired: census === undefined,
                                  pathname: pathname ?? '',
                                  isParentDataIncomplete: isParentDataIncomplete
                                },
                                item,
                                toggle,
                                setToggle
                              )}
                              isOpen={!!toggle}
                              // isOpen
                            >
                              <List size={'md'}>
                                {item.expanded.map((link, subIndex) => {
                                  const SubIcon = link.icon;
                                  const delay = (subIndex + 1) * 200;
                                  const isDataIncomplete = shouldApplyTooltip(item, link.href);
                                  const isLinkDisabled = getDisabledState(link.href);
                                  const tooltipMessage = getTooltipMessage(link.href, isDataIncomplete || (link.href === '/summary' && !isAllValiditiesTrue));
                                  return (
                                    <TransitionComponent
                                      key={link.href}
                                      in={!!toggle}
                                      // in
                                      // style={{ transitionDelay: `${delay}ms` }}
                                      direction="down"
                                    >
                                      <ListItem data-testid={`navigate-list-item-expanded-${item.label}-${link.label}`}>
                                        {site !== undefined && plot !== undefined && census !== undefined ? (
                                          <Tooltip title={tooltipMessage} arrow disableHoverListener={!isDataIncomplete}>
                                            <Box sx={{ display: 'flex', flex: 1 }} data-testid={'expanding-conditional-site-plot-census-defined-box-wrapper'}>
                                              <ListItemButton
                                                data-testid={`navigate-list-item-expanded-button-${item.label}-${link.label}-${link.href}`}
                                                sx={{ flex: 1, width: '100%' }}
                                                selected={pathname === item.href + link.href}
                                                color={pathname === item.href + link.href ? 'primary' : undefined}
                                                disabled={isLinkDisabled}
                                                onClick={async () => {
                                                  if (link.href === '/postvalidation') {
                                                    const response = await fetch(
                                                      `/api/cmprevalidation/postvalidation/${currentSite?.schemaName}/${currentPlot?.plotID}/${currentCensus?.plotCensusNumber}`
                                                    );
                                                    if (response.ok) {
                                                      router.push(item.href + link.href);
                                                      return;
                                                    } else {
                                                      alert('No measurements found!');
                                                      return;
                                                    }
                                                  } else if (!isLinkDisabled) {
                                                    router.push(item.href + link.href);
                                                    return;
                                                  }
                                                }}
                                              >
                                                <Badge
                                                  color={link.href === '/summary' ? 'warning' : 'danger'}
                                                  variant={
                                                    link.href === '/summary' ? (!isAllValiditiesTrue ? 'solid' : 'soft') : isDataIncomplete ? 'solid' : 'soft'
                                                  }
                                                  badgeContent={
                                                    link.href === '/summary' ? (!isAllValiditiesTrue ? '!' : undefined) : isDataIncomplete ? '!' : undefined
                                                  }
                                                  invisible={link.href === '/summary' ? isAllValiditiesTrue : !isDataIncomplete}
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
                                              disabled={plot === undefined || census === undefined || isLinkDisabled}
                                              onClick={() => {
                                                if (!isLinkDisabled) {
                                                  router.push(item.href + link.href);
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
          <RolloverModal open={isRolloverModalOpen} onClose={() => setIsRolloverModalOpen(false)} onConfirm={handleConfirmRollover} />
          <RolloverStemsModal open={isRolloverStemsModalOpen} onClose={() => setIsRolloverStemsModalOpen(false)} onConfirm={handleConfirmStemsRollover} />
          <Divider orientation={'horizontal'} sx={{ mb: 2, mt: 2 }} />
          <LoginLogout />
        </Box>
        <Menu
          anchorEl={anchorPlotEdit}
          open={Boolean(anchorPlotEdit)}
          onClose={handleClose}
          placement={'bottom-end'}
          sx={{
            pointerEvents: 'auto'
          }}
        >
          <MenuItem
            onMouseDown={() => {
              handleOptionClick();
            }}
          >
            View/Edit this Plot
          </MenuItem>
        </Menu>
        {selectedPlot && (
          <PlotCardModal
            openPlotCardModal={openPlotCardModal}
            plot={selectedPlot}
            setOpenPlotCardModal={setOpenPlotCardModal}
            setManualReset={setManualReset}
          />
        )}
      </Stack>
    </>
  );
}
