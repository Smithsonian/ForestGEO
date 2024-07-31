"use client";
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
import { LoginLogout } from "@/components/loginlogout";
import { siteConfigNav, validityMapping } from "@/config/macros/siteconfigs";
import { SiteConfigProps } from "@/config/macros/siteconfigs";
import { Site } from "@/config/sqlrdsdefinitions/tables/sitesrds";
import { Plot } from "@/config/sqlrdsdefinitions/tables/plotrds";
import { useOrgCensusContext, useOrgCensusDispatch, usePlotContext, usePlotDispatch, useSiteContext, useSiteDispatch } from "@/app/contexts/userselectionprovider";
import { usePathname, useRouter } from "next/navigation";
import { Button, SelectOption, Stack, Badge, Tooltip, IconButton, } from "@mui/joy";
import AddIcon from '@mui/icons-material/Add';
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';
import { useOrgCensusListContext, usePlotListContext, useSiteListContext } from "@/app/contexts/listselectionprovider";
import { useSession } from "next-auth/react";
import { TransitionComponent } from "@/components/client/clientmacros";
import ListDivider from "@mui/joy/ListDivider";
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from "@mui/joy/Avatar";
import { CensusLogo, PlotLogo } from "@/components/icons";
import { RainbowIcon } from '@/styles/rainbowicon';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { OrgCensus, OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/orgcensusrds';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';
import RolloverModal from './client/rollovermodal';
import RolloverStemsModal from './client/rolloverstemsmodal';

export interface SimpleTogglerProps {
  isOpen: boolean;
  children: React.ReactNode;
  renderToggle: any;
}

export function SimpleToggler({ isOpen, renderToggle, children, }: Readonly<SimpleTogglerProps>) {
  return (
    <React.Fragment>
      {renderToggle}
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: '0.2s ease',
          '& > *': {
            overflow: 'hidden',
          },
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
      sx={{ width: '100%', padding: 0, margin: 0 }}>
      <Tooltip title={isParentDataIncomplete ? "Missing Core Data!" : "Requirements Met"} arrow>
        <Badge
          color="danger"
          variant={isParentDataIncomplete ? 'solid' : 'soft'}
          badgeContent={isParentDataIncomplete ? '!' : undefined}
          invisible={!isParentDataIncomplete || !currentSite || !currentPlot || !currentCensus}
        >
          <Icon />
        </Badge>
      </Tooltip>
      <ListItemContent>
        <Typography level={"title-sm"}>{siteConfigProps.label}</Typography>
      </ListItemContent>
      <KeyboardArrowDownIcon
        sx={{ transform: menuOpen ? 'rotate(180deg)' : 'none' }}
      />
    </ListItemButton>
  );
}

interface SidebarProps {
  siteListLoaded: boolean
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

  const [measurementsToggle, setMeasurementsToggle] = useState(false);
  const [propertiesToggle, setPropertiesToggle] = useState(false);
  const [formsToggle, setFormsToggle] = useState(false);

  const [storedPlot, setStoredPlot] = useState<Plot>();
  const [storedCensus, setStoredCensus] = useState<OrgCensus>();
  const [storedSite, setStoredSite] = useState<Site>();

  const [isRolloverModalOpen, setIsRolloverModalOpen] = useState(false);
  const [isRolloverStemsModalOpen, setIsRolloverStemsModalOpen] = useState(false);

  const { siteListLoaded, setCensusListLoaded } = props;

  const { triggerRefresh } = useDataValidityContext();

  const { isPulsing, triggerPulse } = useLockAnimation();
  const reopenButtonRef = useRef(null);
  const addButtonRef = useRef(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(340); // Default width
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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
    if ((site === undefined || site.schemaName === undefined) || (plot === undefined || plot.plotID === undefined)) throw new Error("new census start date was not set OR plot is undefined");
    setIsRolloverModalOpen(true);
  };

  const handleConfirmRollover = async (rolledOverPersonnel: boolean, rolledOverQuadrats: boolean) => {
    if (!rolledOverPersonnel && !rolledOverQuadrats) {
      // didn't roll over anything, need to create a new census still:
      // createdCensusID is undefined here
      const highestPlotCensusNumber = censusListContext && censusListContext.length > 0
        ? censusListContext.reduce((max, census) =>
          (census?.plotCensusNumber ?? 0) > max ? (census?.plotCensusNumber ?? 0) : max, censusListContext[0]?.plotCensusNumber ?? 0)
        : 0;
      if (!highestPlotCensusNumber) throw new Error("highest plot census number calculation failed");

      const mapper = new OrgCensusToCensusResultMapper();
      const newCensusID = await mapper.startNewCensus(currentSite?.schemaName ?? '', currentPlot?.plotID ?? 0, highestPlotCensusNumber + 1);
      if (!newCensusID) throw new Error("census creation failure");
      await new Promise(resolve => setTimeout(resolve, 500)); // debounce
    } else {
      await new Promise(resolve => setTimeout(resolve, 500)); // debounce
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
    await new Promise(resolve => setTimeout(resolve, 500));
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
    }
  };

  const handleResumeSession = async () => {
    storedSite ? await handleSiteSelection(storedSite) : undefined;
    storedPlot ? await handlePlotSelection(storedPlot) : undefined;
    storedCensus ? await handleCensusSelection(storedCensus) : undefined;
  };

  const renderSiteValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Site</Typography>;
    }

    const selectedValue = option.value;
    const selectedSite = siteListContext?.find(c => c?.siteName?.toString() === selectedValue);
    return (
      <>
        {selectedSite ? (
          <Stack direction={"column"} alignItems={'start'}>
            <Typography level='body-lg' className="sidebar-item">{`Site: ${selectedSite?.siteName}`}</Typography>
            <Stack direction={"column"} alignItems={'start'}>
              <Typography level="body-sm" color={"primary"} className="sidebar-item">
                &mdash; Schema: {selectedSite.schemaName}
              </Typography>
            </Stack>
          </Stack>
        ) : (
          <Typography level='body-lg' className="sidebar-item">Select a Site</Typography>
        )}
      </>
    );
  };

  const renderPlotValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Plot</Typography>;
    }

    const selectedValue = option.value;
    const selectedPlot = plotListContext?.find(c => c?.plotName === selectedValue);

    return (
      <>
        {selectedPlot ? (
          <Stack direction="column" alignItems="start">
            <Typography level='body-md' className="sidebar-item">{`Plot: ${selectedPlot?.plotName}`}</Typography>
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }} className="sidebar-item">
              <Typography level="body-sm" color={"primary"}>
                &mdash; Quadrats: {selectedPlot.numQuadrats}
              </Typography>
            </Box>
          </Stack>
        ) : (
          <Typography className="sidebar-item">Select a Plot</Typography>
        )}
      </>
    );
  };

  const renderCensusValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Census</Typography>;
    }

    const selectedValue = option.value;
    const selectedCensus = censusListContext?.find(c => c?.plotCensusNumber?.toString() === selectedValue);
    // return selectedCensus ? <Typography>{`Census: ${selectedCensus?.plotCensusNumber}`}</Typography> :
    //   <Typography>No Census</Typography>;
    return (
      <>
        {selectedCensus ? (
          <Stack direction={"column"} alignItems={'start'}>
            <Typography level='body-md' className="sidebar-item">{`Census: ${selectedCensus?.plotCensusNumber}`}</Typography>
            <Stack direction={"column"} alignItems={'start'}>
              <Typography color={(!census) ? "danger" : "primary"} level="body-sm" className="sidebar-item">
                {(census !== undefined) && (
                  <>{(census.dateRanges[0]?.startDate !== undefined) ? `\u2014 First Record: ${new Date(census?.dateRanges[0]?.startDate).toDateString()}` : 'No Records'}</>
                )}
              </Typography>
              <Typography color={(!census) ? "danger" : "primary"} level="body-sm" className="sidebar-item">
                {(census !== undefined) && (
                  <>{(census.dateRanges[0]?.endDate !== undefined) ? `\u2014 Last Record ${new Date(census.dateRanges[0]?.endDate).toDateString()}` : ``}</>
                )}
              </Typography>
            </Stack>
          </Stack>
        ) : (
          <Typography className="sidebar-item">Select a Census</Typography>
        )}
      </>
    );
  };
  type ToggleObject = {
    toggle?: boolean;
    setToggle?: Dispatch<SetStateAction<boolean>>;
  };

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
      size={"md"}
      renderValue={renderCensusValue}
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
        onMouseDown={(event) => event.preventDefault()} // Prevents closing the dropdown
        onClick={(event) => event.stopPropagation()} // Prevents any response
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%'
          }}
        >
          <Typography level="body-sm" color="primary">Add New Census</Typography>
          <IconButton
            size="sm"
            color="primary"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenNewCensus();
            }}
          >
            <AddIcon />
          </IconButton>
        </Box>
      </ListItem>
      <Divider orientation={"horizontal"} sx={{ my: 1 }} />
      {censusListContext?.sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0)).map((item) => (
        <Option key={item?.plotCensusNumber} value={item?.plotCensusNumber?.toString()}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%"
            }} className="sidebar-item"
          >
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }} >
              <Typography level="body-lg">Census: {item?.plotCensusNumber}</Typography>
              {item?.dateRanges?.map((dateRange, index) => (
                <React.Fragment key={index}>
                  <Stack direction={"row"}>
                    <Typography level="body-sm" color={"neutral"} sx={{ paddingLeft: '1em' }}>
                      {`${dateRange.startDate ? `First Msmt: ${new Date(dateRange.startDate).toDateString()}` : 'No Measurements'}`}
                    </Typography>
                    {dateRange.endDate && (
                      <Typography level="body-sm" color={"neutral"} sx={{ paddingLeft: '1em', paddingRight: '1em' }}>
                        &lt;===&gt;
                      </Typography>
                    )}
                    <Typography level="body-sm" color={"neutral"}>
                      {`${dateRange.endDate ? `Last Msmt: ${new Date(dateRange.endDate).toDateString()}` : ''}`}
                    </Typography>
                  </Stack>
                </React.Fragment>
              ))}
            </Box>
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
      size={"md"}
      renderValue={renderPlotValue}
      onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
        const selectedPlot = plotListContext?.find(plot => plot?.plotName === newValue) || undefined;
        await handlePlotSelection(selectedPlot);
      }}
    >
      <Option value={""}>None</Option>
      {plotListContext?.map((item) => (
        <Option value={item?.plotName} key={item?.plotName}>
          <Box sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%"
          }} className="sidebar-item">
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <Typography level="body-md">{item?.plotName}</Typography>
              <Typography level="body-sm" color={"primary"} sx={{ paddingLeft: "1em" }}>
                Quadrats: {item?.numQuadrats}
              </Typography>
            </Box>
          </Box>
        </Option>
      ))}
    </Select>
  );
  const renderSiteOptions = () => {
    const allowedSites = siteListContext?.filter(site =>
      session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)).sort((a, b) => {
        const nameA = a.siteName?.toLowerCase() ?? '';
        const nameB = b.siteName?.toLowerCase() ?? '';
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });
    ;

    const otherSites = siteListContext?.filter(site =>
      !session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)).sort((a, b) => {
        const nameA = a.siteName?.toLowerCase() ?? '';
        const nameB = b.siteName?.toLowerCase() ?? '';
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });


    return (
      <Select
        className='site-select sidebar-item'
        placeholder="Select a Site"
        name="None"
        required
        autoFocus
        sx={{ marginRight: '1em' }}
        size={"md"}
        renderValue={renderSiteValue}
        value={site ? siteListContext?.find(i => i.siteName === site.siteName)?.siteName : ""}
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
          <Option key="none" value="">None</Option>
        </List>
        <ListDivider role="none" />
        <List sx={{ '--ListItemDecorator-size': '28px' }}>
          <ListItem id="allowed-sites-group" sticky className="sidebar-item">
            <Typography level="body-xs" textTransform="uppercase">
              Allowed Sites ({allowedSites?.length})
            </Typography>
          </ListItem>
          {allowedSites?.map((site) => (
            <Option key={site.siteID} value={site.siteName}>
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
          {otherSites?.map((site) => (
            <Option key={site.siteID} value={site.siteName} disabled>
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
      <Stack direction={"row"} sx={{ display: 'flex', width: 'fit-content' }}>
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
            styles={(theme) => ({
              ':root': {
                '--Sidebar-width': `${sidebarWidth}px`,
                [theme.breakpoints.up('lg')]: {
                  '--Sidebar-width': `${sidebarWidth}px`,
                },
              },
            })}
          />
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }} className="sidebar-item">
              <Stack direction={"column"} sx={{ marginRight: '1em' }}>
                <Typography level="h1">
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ marginRight: 1.5 }}>
                      <RainbowIcon />
                    </Box>
                    ForestGEO
                  </Box>
                  {session?.user.userStatus !== 'fieldcrew' && (
                    <Typography level="h1" color='danger' sx={{ marginLeft: 0.5 }}>(Admin)</Typography>
                  )}
                </Typography>
              </Stack>
              <Divider orientation='horizontal' sx={{ my: 0.75 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }}>
                <Avatar sx={{ marginRight: 1 }}>
                  <TravelExploreIcon />
                </Avatar>
                <Box sx={{ flexGrow: 1 }}>
                  {renderSiteOptions()}
                </Box>
              </Box>
              {(site !== undefined) && (
                <>
                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }}>
                    <Avatar size={"sm"} sx={{ marginRight: 1 }}>
                      <PlotLogo />
                    </Avatar>
                    <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center', marginRight: '1em' }}>
                      {renderPlotOptions()}
                    </Box>
                  </Box>
                  {plot !== undefined && (
                    <>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }}>
                        <Avatar size={"sm"} sx={{ marginRight: 1 }}>
                          <CensusLogo />
                        </Avatar>
                        <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center', marginRight: '1em' }}>
                          {renderCensusOptions()}
                        </Box>
                      </Box>
                      <Divider orientation='horizontal' sx={{ marginTop: 2 }} />
                    </>
                  )}
                </>
              )}
            </Box>
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              ml: -1
            }}> {/* Added ml: -1 to adjust the position of the navigation menu */}
              <Box
                sx={{
                  minHeight: 0,
                  overflow: 'hidden auto',
                  flexGrow: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  [`& .${listItemButtonClasses.root}`]: {
                    // gap: 1.5,
                  },
                }}
              >
                <List
                  size="lg"
                  sx={{
                    // gap: 1,
                    '--List-nestedInsetStart': '30px',
                    '--ListItem-radius': (theme) => theme.vars.radius.sm,
                  }}
                >
                  {siteConfigNav.map((item, index: number) => {
                    const Icon = item.icon;
                    const { toggle, setToggle } = toggleArray[index];
                    const delay = (index) * 200;

                    const getTooltipMessage = (href: string, isDataIncomplete: boolean) => {
                      if (isDataIncomplete) {
                        switch (href) {
                          case '/summary':
                            return 'You must resolve all supporting data warnings before adding measurements!';
                          case '/subquadrats':
                            return 'Subquadrats cannot be viewed until quadrats are valid.';
                          case '/quadratpersonnel':
                            return 'QuadratPersonnel cannot be viewed until both quadrats and personnel are valid.';
                          default:
                            return 'Data needed to complete census!';
                        }
                      } else {
                        return 'Requirements Met';
                      }
                    };

                    const getDisabledState = (href: string) => {
                      switch (href) {
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
                        <TransitionComponent key={item.href} in={site !== undefined && plot !== undefined} style={{ transitionDelay: `${delay}ms` }} direction="down">
                          <ListItem
                            // className={`sidebar-item ${hoveredIndex !== null && hoveredIndex !== index ? 'animate-fade-blur-in' : ''}`}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                          >
                            {site !== undefined && plot !== undefined && census !== undefined ? (
                              <Tooltip title={isDataIncomplete ? 'Missing Core Data!' : 'Requirements Met'} arrow disableHoverListener={!isDataIncomplete}>
                                <Box sx={{ display: 'flex', flex: 1 }}>
                                  <ListItemButton selected={pathname === item.href} sx={{ flex: 1, width: '100%' }} disabled={isLinkDisabled} color={pathname === item.href ? 'primary' : undefined} onClick={() => {
                                    if (!isLinkDisabled) {
                                      router.push(item.href);
                                    }
                                  }}>
                                    <Badge color="danger" variant={isDataIncomplete ? 'solid' : 'soft'} badgeContent={isDataIncomplete ? '!' : undefined} invisible={!isDataIncomplete}>
                                      <Icon />
                                    </Badge>
                                    <ListItemContent>
                                      <Typography level={"title-sm"}>{item.label}</Typography>
                                    </ListItemContent>
                                  </ListItemButton>
                                </Box>
                              </Tooltip>
                            ) : (
                              <Box sx={{ display: 'flex', flex: 1 }}>
                                <ListItemButton selected={pathname === item.href} sx={{ flex: 1, width: '100%' }} disabled={plot === undefined || census === undefined || isLinkDisabled} color={pathname === item.href ? 'primary' : undefined} onClick={() => {
                                  if (!isLinkDisabled) {
                                    router.push(item.href);
                                  }
                                }}>
                                  <Icon />
                                  <ListItemContent>
                                    <Typography level={"title-sm"}>{item.label}</Typography>
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
                        <TransitionComponent key={item.href} in={site !== undefined && plot !== undefined}
                          style={{ transitionDelay: `${delay}ms` }} direction="down">
                          <ListItem
                            nested
                            // className={`sidebar-item ${hoveredIndex !== null && hoveredIndex !== index ? 'animate-fade-blur-in' : 'animate-fade-blur-out'}`}
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                          >
                            <SimpleToggler renderToggle={MenuRenderToggle({
                              plotSelectionRequired: plot === undefined,
                              censusSelectionRequired: census === undefined,
                              pathname, isParentDataIncomplete
                            }, item, toggle, setToggle)}
                              isOpen={!!toggle}>
                              <List size={"md"}>
                                {item.expanded.map((link, subIndex) => {
                                  if (link.href === '/subquadrats' && !currentPlot?.usesSubquadrats) return null;
                                  const SubIcon = link.icon;
                                  const delay = (subIndex + 1) * 200;
                                  const isDataIncomplete = shouldApplyTooltip(item, link.href);
                                  const isLinkDisabled = getDisabledState(link.href);
                                  const tooltipMessage = getTooltipMessage(link.href, isDataIncomplete || (link.href === '/summary' && !isAllValiditiesTrue));

                                  return (
                                    <TransitionComponent key={link.href} in={!!toggle} style={{ transitionDelay: `${delay}ms` }} direction="down">
                                      {/* <ListItem
                                        className={`sidebar-item ${hoveredIndex !== null && hoveredIndex !== index ? 'animate-fade-blur-in' : ''}`}
                                        onMouseEnter={() => setHoveredIndex(index)}
                                        onMouseLeave={() => setHoveredIndex(null)}
                                        sx={{ marginTop: 0.75 }}
                                      > */}
                                      <ListItem>
                                        {site !== undefined && plot !== undefined && census !== undefined ? (
                                          <Tooltip title={tooltipMessage} arrow disableHoverListener={!isDataIncomplete}>
                                            <Box sx={{ display: 'flex', flex: 1 }}>
                                              <ListItemButton sx={{ flex: 1, width: '100%' }} selected={pathname == (item.href + link.href)} color={pathname === item.href ? 'primary' : undefined}
                                                disabled={isLinkDisabled} onClick={() => {
                                                  if (!isLinkDisabled) {
                                                    router.push(item.href + link.href);
                                                  }
                                                }}>
                                                <Badge color={link.href === '/summary' ? "warning" : "danger"}
                                                  variant={link.href === '/summary' ? (!isAllValiditiesTrue ? 'solid' : 'soft') : (isDataIncomplete ? 'solid' : 'soft')}
                                                  badgeContent={link.href === '/summary' ? (!isAllValiditiesTrue ? '!' : undefined) : (isDataIncomplete ? '!' : undefined)}
                                                  invisible={link.href === '/summary' ? isAllValiditiesTrue : !isDataIncomplete}>
                                                  <SubIcon />
                                                </Badge>
                                                <ListItemContent>
                                                  <Typography level={"title-sm"}>{link.label}</Typography>
                                                </ListItemContent>
                                              </ListItemButton>
                                            </Box>
                                          </Tooltip>
                                        ) : (
                                          <Box sx={{ display: 'flex', flex: 1 }}>
                                            <ListItemButton sx={{ flex: 1, width: '100%' }} selected={pathname == (item.href + link.href)} color={pathname === item.href ? 'primary' : undefined}
                                              disabled={plot === undefined || census === undefined || isLinkDisabled} onClick={() => {
                                                if (!isLinkDisabled) {
                                                  router.push(item.href + link.href);
                                                }
                                              }}>
                                              <SubIcon />
                                              <ListItemContent>
                                                <Typography level={"title-sm"}>{link.label}</Typography>
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
          <RolloverModal
            open={isRolloverModalOpen}
            onClose={() => setIsRolloverModalOpen(false)}
            onConfirm={handleConfirmRollover}
          />
          <RolloverStemsModal
            open={isRolloverStemsModalOpen}
            onClose={() => setIsRolloverStemsModalOpen(false)}
            onConfirm={handleConfirmStemsRollover}
          />
          <Divider orientation={"horizontal"} sx={{ mb: 2 }} />
          {site && plot && census && (
            <Button onClick={() => triggerRefresh()}>Reload Prevalidation</Button>
          )}
          <Divider orientation={"horizontal"} sx={{ mb: 2, mt: 2 }} />
          <LoginLogout />
        </Box>
      </Stack >
    </>
  );
}
