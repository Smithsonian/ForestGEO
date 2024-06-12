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
import {
  useOrgCensusContext,
  useOrgCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch
} from "@/app/contexts/userselectionprovider";
import { usePathname, useRouter } from "next/navigation";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Modal,
  ModalDialog,
  SelectOption,
  Stack,
  Badge,
  Tooltip,
} from "@mui/joy";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';
import {
  useOrgCensusListContext,
  usePlotListContext,
  useSiteListContext
} from "@/app/contexts/listselectionprovider";
import { useSession } from "next-auth/react";
import { TransitionComponent } from "@/components/client/clientmacros";
import ListDivider from "@mui/joy/ListDivider";
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from "@mui/joy/Avatar";
import { CensusLogo, PlotLogo } from "@/components/icons";
import { RainbowIcon } from '@/styles/rainbowicon';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';
import { OrgCensus, OrgCensusRDS, OrgCensusToCensusResultMapper } from '@/config/sqlrdsdefinitions/orgcensusrds';
import moment from 'moment';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { useLockAnimation } from '@/app/contexts/lockanimationcontext';

// const initialSteps: Step[] = [
//   {
//     target: '.site-select',
//     content: 'Select a site from here.',
//     disableBeacon: true,
//     spotlightClicks: true,  // Allow clicks on the spotlighted element
//     placement: 'right', 
//   },
// ];

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
      }}>
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

  const { siteListLoaded, setCensusListLoaded } = props;

  const [openCloseCensusModal, setOpenCloseCensusModal] = useState(false);
  const [openReopenCensusModal, setOpenReopenCensusModal] = useState(false);
  const [openNewCensusModal, setOpenNewCensusModal] = useState(false);

  const [reopenStartDate, setReopenStartDate] = useState<Date | null>(null);
  const [closeEndDate, setCloseEndDate] = useState<Date | null>(null);
  const [newStartDate, setNewStartDate] = useState<Date | null>(null);

  const { isPulsing, triggerPulse } = useLockAnimation();
  const reopenButtonRef = useRef(null);
  const addButtonRef = useRef(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(340); // Default width

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

        setSidebarWidth(maxWidth + 10);
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


  /** this has been postponed and marked as a future completion task. the joyride is not critical to the usage of the application.
   const [run, setRun] = useState(false);
   const [steps, setSteps] = useState<Step[]>(initialSteps);
   const [stepIndex, setStepIndex] = useState(0);
   const [joyridePrompted, setJoyridePrompted] = useState(false);
   const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
   const [dashboardLoaded, setDashboardLoaded] = useState(false);

   useEffect(() => {
   if (pathname === '/dashboard') {
   setDashboardLoaded(true);
   }
   }, [pathname]);

   useEffect(() => {
   if (session && siteListLoaded && dashboardLoaded && !joyridePrompted) {
   const startJoyride = confirm("Would you like to start the tutorial?");
   if (startJoyride) {
   setRun(true);
   }
   setJoyridePrompted(true);
   }
   }, [session, siteListLoaded, dashboardLoaded, joyridePrompted]);

   const handleJoyrideCallback = (data: CallBackProps) => {
   const { status, action, index } = data;
   const finishedStatuses: Status[] = [STATUS.FINISHED, STATUS.SKIPPED];

   if (finishedStatuses.includes(status)) {
   setRun(false);
   } else if (action === 'next' && index === 0) {
   // Move to the next step if site is selected
   if (site) {
   setSteps(prevSteps => [
   ...prevSteps,
   {
   target: '.plot-selection',
   content: 'Select a plot from here.',
   disableBeacon: true,
   spotlightClicks: true,
   placement: 'right',
   },
   ]);
   setStepIndex(1);
   } else {
   alert("Please select a site to proceed.");
   }
   } else if (action === 'next' && index === 1) {
   // Move to the next step if plot is selected
   if (plot) {
   setSteps(prevSteps => [
   ...prevSteps,
   {
   target: '.census-select',
   content: 'Select a census from here.',
   disableBeacon: true,
   spotlightClicks: true,
   placement: 'right',
   },
   ]);
   setStepIndex(2);
   } else {
   alert("Please select a plot to proceed.");
   }
   } else if (action === 'next' && index === 2) {
   // End the tour if census is selected
   if (census) {
   setRun(false);
   } else {
   alert("Please select a census to proceed.");
   }
   }
   }; */

  const getOpenClosedCensusStartEndDate = (censusType: string, census: OrgCensus): Date | undefined => {
    if (!census) return undefined;
    const mapper = new OrgCensusToCensusResultMapper();
    if (censusType === 'open') {
      const openCensusID = mapper.findOpenCensusID(census);
      if (!openCensusID) return undefined;
      const openCensusDateRange = census?.dateRanges.find(dateRange => dateRange.censusID === openCensusID);
      return openCensusDateRange?.startDate;
    } else {
      const closedCensusID = mapper.findClosedCensusID(census);
      if (!closedCensusID) return undefined;
      const closedDateRange = census?.dateRanges.find(dateRange => dateRange.censusID === closedCensusID);
      return closedDateRange?.endDate;
    }
  };

  const handleReopenCensus = async () => {
    if (census && reopenStartDate) {
      const mapper = new OrgCensusToCensusResultMapper();
      const validCensusListContext = (censusListContext || []).filter((census): census is OrgCensusRDS => census !== undefined);
      await mapper.reopenCensus(site?.schemaName || '', census.plotCensusNumber, reopenStartDate, validCensusListContext);
      setCensusListLoaded(false);
      setOpenReopenCensusModal(false);
      setReopenStartDate(null);
    } else throw new Error("current census or reopen start date was not set");
  };


  const handleCloseCensus = async () => {
    if (census && closeEndDate) {
      const mapper = new OrgCensusToCensusResultMapper();
      const validCensusListContext = (censusListContext || []).filter((census): census is OrgCensusRDS => census !== undefined);
      await mapper.closeCensus(site?.schemaName || '', census.plotCensusNumber, closeEndDate, validCensusListContext);
      setCensusListLoaded(false);
      setOpenCloseCensusModal(false);
      setCloseEndDate(null);
    }
  };

  const handleOpenNewCensus = async () => {
    if ((site === undefined || site.schemaName === undefined) || newStartDate === null || (plot === undefined || plot.plotID === undefined)) throw new Error("new census start date was not set OR plot is undefined");
    const validCensusListContext = (censusListContext || []).filter((census): census is OrgCensusRDS => census !== undefined);
    const highestPlotCensusNumber = validCensusListContext.length > 0
      ? validCensusListContext.reduce((max, census) =>
        census.plotCensusNumber > max ? census.plotCensusNumber : max, validCensusListContext[0].plotCensusNumber)
      : 0;
    const mapper = new OrgCensusToCensusResultMapper();
    await mapper.startNewCensus(site.schemaName, plot.plotID, highestPlotCensusNumber + 1, newStartDate, census ? census.description : undefined);
    setCensusListLoaded(false);
    setOpenNewCensusModal(false);
    setNewStartDate(null);
  };

  useEffect(() => {
    setPlot(currentPlot);
    setCensus(currentCensus);
    setSite(currentSite);
  }, [currentPlot, currentCensus, currentSite]);

  useEffect(() => {
    if (census && reopenStartDate === null && getOpenClosedCensusStartEndDate('closed', census)) setReopenStartDate(getOpenClosedCensusStartEndDate('closed', census) ?? null);
    if (census && newStartDate === null && getOpenClosedCensusStartEndDate('open', census)) setNewStartDate(getOpenClosedCensusStartEndDate('open', census) ?? null);
    if (census && closeEndDate === null && getOpenClosedCensusStartEndDate('open', census)) setCloseEndDate(getOpenClosedCensusStartEndDate('open', census) ?? null);
  }, [census, reopenStartDate, closeEndDate, newStartDate]);

  // useEffect(() => {
  //   if (siteListLoaded && session) {
  //     const checkAndInitializeKey = async (key: string, defaultValue: any) => {
  //       try {
  //         const data = await getData(key);
  //         if (data === undefined) {
  //           await setData(key, defaultValue);
  //         }
  //       } catch (error) {
  //         console.error(`Error initializing key ${key} in IDB:`, error);
  //         await setData(key, defaultValue); // Ensure the key is present
  //       }
  //     };

  //     const initializeKeys = async () => {
  //       await Promise.all([
  //         checkAndInitializeKey('site', null),
  //         checkAndInitializeKey('plot', null),
  //         checkAndInitializeKey('census', null)
  //       ]);
  //     };

  //     initializeKeys().then(() => {
  //       getData('site').then((savedSite: Site) => setStoredSite(savedSite)).catch(console.error);
  //       getData('plot').then((savedPlot: Plot) => setStoredPlot(savedPlot)).catch(console.error);
  //       getData('census').then((savedCensus: OrgCensus) => setStoredCensus(savedCensus)).catch(console.error);
  //     }).catch(console.error);
  //   }
  // }, [siteListLoaded, session]);  

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
                  <>{(census.dateRanges[0]?.startDate) ? `\u2014 Starting: ${new Date(census?.dateRanges[0]?.startDate).toDateString()}` : ''}</>
                )}
              </Typography>
              <Typography color={(!census) ? "danger" : "primary"} level="body-sm" className="sidebar-item">
                {(census !== undefined) && (
                  <>{(census.dateRanges[0]?.endDate) ? `\u2014 Ending ${new Date(census.dateRanges[0]?.endDate).toDateString()}` : `\u2014 Ongoing`}</>
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
      <List>
        <Option value={""}>None</Option>
        <Divider orientation={"horizontal"} />
        {censusListContext?.sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0)).map((item) => (
          <Option key={item?.plotCensusNumber} value={item?.plotCensusNumber?.toString()}>
            <Box sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              width: "100%"
            }} className="sidebar-item">
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }} >
                <Typography level="body-lg">Census: {item?.plotCensusNumber}</Typography>
                {item?.dateRanges?.map((dateRange, index) => (
                  <React.Fragment key={index}>
                    <Stack direction={"row"}>
                      <Typography level="body-sm" color={"neutral"} sx={{ paddingLeft: '1em' }}>
                        {`${dateRange.startDate ? new Date(dateRange.startDate).toDateString() : 'undefined'}`}
                      </Typography>
                      <Typography level="body-sm" color={"neutral"} sx={{ paddingLeft: '1em', paddingRight: '1em' }}>
                        &lt;===&gt;
                      </Typography>
                      <Typography level="body-sm" color={"neutral"}>
                        {`${dateRange.endDate ? new Date(dateRange.endDate).toDateString() : 'Ongoing'}`}
                      </Typography>
                    </Stack>
                  </React.Fragment>
                ))}
              </Box>
            </Box>
          </Option>
        ))}
      </List>
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

  return (
    <>
      {/* <Joyride
        steps={steps}
        run={run}
        stepIndex={stepIndex}
        continuous
        showProgress
        showSkipButton
        callback={handleJoyrideCallback}
        styles={{
          options: {
            zIndex: 10000,
          },
        }}
      /> */}
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
              <Stack direction={"column"}>
                <Typography level="h1">
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ marginRight: 1.5 }}>
                      <RainbowIcon />
                    </Box>
                    ForestGEO
                  </Box>
                  {session?.user.isAdmin && (
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
                    <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center' }}>
                      {renderPlotOptions()}
                    </Box>
                  </Box>
                  {plot !== undefined && (
                    <>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', mb: 2 }}>
                        <Avatar size={"sm"} sx={{ marginRight: 1 }}>
                          <CensusLogo />
                        </Avatar>
                        <Box sx={{ flexGrow: 1, marginLeft: '0.5em', alignItems: 'center' }}>
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
                    gap: 1.5,
                  },
                }}
              >
                <List
                  size="lg"
                  sx={{
                    gap: 1,
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
                      const isDataIncomplete = isLinkDisabled;

                      return (
                        <TransitionComponent key={item.href} in={site !== undefined && plot !== undefined}
                          style={{ transitionDelay: `${delay}ms` }} direction="down">
                          <ListItem className="sidebar-item">
                            {(site !== undefined && plot !== undefined && census !== undefined) ? (
                              <Tooltip title={getTooltipMessage(item.href, isDataIncomplete)} arrow>
                                <Box sx={{ display: 'flex', flex: 1 }}>
                                  <ListItemButton selected={pathname === item.href} sx={{ flex: 1 }}
                                    disabled={(plot === undefined || census === undefined || isLinkDisabled)}
                                    color={pathname === item.href ? 'primary' : undefined}
                                    onClick={() => {
                                      if (!isLinkDisabled) {
                                        router.push(item.href);
                                      }
                                    }}>
                                    <Badge
                                      color="danger"
                                      variant={isLinkDisabled ? 'solid' : 'soft'}
                                      badgeContent={isLinkDisabled ? '!' : undefined}
                                      invisible={!isLinkDisabled}
                                    >
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
                                <ListItemButton selected={pathname === item.href} sx={{ flex: 1 }}
                                  disabled={(plot === undefined || census === undefined || isLinkDisabled)}
                                  color={pathname === item.href ? 'primary' : undefined}
                                  onClick={() => {
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
                        // Skip validity check for subquadrats
                        if (subItem.href === '/subquadrats') {
                          return false;
                        }

                        const dataKey = validityMapping[subItem.href];
                        return dataKey !== undefined && !validity[dataKey];
                      });
                      return (
                        <TransitionComponent key={item.href} in={site !== undefined && plot !== undefined}
                          style={{ transitionDelay: `${delay}ms` }} direction="down">
                          <ListItem nested className="sidebar-item">
                            <SimpleToggler
                              renderToggle={MenuRenderToggle({
                                plotSelectionRequired: plot === undefined,
                                censusSelectionRequired: census === undefined,
                                pathname, isParentDataIncomplete
                              }, item, toggle, setToggle)}
                              isOpen={!!toggle}
                            >
                              <List sx={{ gap: 0.75 }} size={"sm"}>
                                {item.expanded.map((link, subIndex) => {
                                  // Skip rendering for subquadrats
                                  if (link.href === '/subquadrats') {
                                    return null;
                                  }
                                  const SubIcon = link.icon;
                                  const delay = (subIndex + 1) * 200;
                                  const dataValidityKey = validityMapping[link.href];
                                  const isDataIncomplete = dataValidityKey ? !validity[dataValidityKey] : false;
                                  const isLinkDisabled = getDisabledState(link.href);
                                  const tooltipMessage = getTooltipMessage(link.href, isDataIncomplete || (link.href === '/summary' && !isAllValiditiesTrue));

                                  return (
                                    <TransitionComponent key={link.href} in={!!toggle}
                                      style={{ transitionDelay: `${delay}ms` }} direction="down">
                                      <ListItem sx={{ marginTop: 0.75 }} className="sidebar-item">
                                        {(site !== undefined && plot !== undefined && census !== undefined) ? (
                                          <Tooltip title={tooltipMessage} arrow>
                                            <Box sx={{ display: 'flex', flex: 1 }}>
                                              <ListItemButton sx={{ flex: 1 }}
                                                selected={pathname == (item.href + link.href)}
                                                disabled={plot === undefined || census === undefined || isLinkDisabled}
                                                onClick={() => {
                                                  if (!isLinkDisabled) {
                                                    router.push((item.href + link.href));
                                                    if (setToggle) {
                                                      setToggle(false); // Close the menu
                                                    }
                                                  }
                                                }}>
                                                <Badge
                                                  color={link.href === '/summary' ? "warning" : "danger"}
                                                  variant={link.href === '/summary' ? (!isAllValiditiesTrue ? 'solid' : 'soft') : (isDataIncomplete ? 'solid' : 'soft')}
                                                  badgeContent={link.href === '/summary' ? (!isAllValiditiesTrue ? '!' : undefined) : (isDataIncomplete ? '!' : undefined)}
                                                  invisible={link.href === '/summary' ? isAllValiditiesTrue : !isDataIncomplete}
                                                >
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
                                            <ListItemButton sx={{ flex: 1 }}
                                              selected={pathname == (item.href + link.href)}
                                              disabled={plot === undefined || census === undefined || isLinkDisabled}
                                              onClick={() => {
                                                if (!isLinkDisabled) {
                                                  router.push((item.href + link.href));
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

          <Divider orientation={"horizontal"} sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }} className="sidebar-item">
            {site && plot && (
              <>
                {!census && censusListContext?.length === 0 ? (
                  <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flexDirection: 'column',
                    width: '100%'
                  }}>
                    <Button
                      ref={addButtonRef}
                      size="sm"
                      variant="solid"
                      color="primary"
                      sx={{ width: '100%' }}
                      onClick={() => setOpenNewCensusModal(true)}
                      className={isPulsing ? 'animate-pulse' : ''}
                    >
                      Start New Census
                    </Button>
                  </Box>
                ) : (
                  <>
                    {census && census.dateRanges[0].endDate ? (
                      <Box sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        flexDirection: 'column',
                        width: '100%'
                      }}>
                        <Button
                          ref={reopenButtonRef}
                          disabled={census === undefined}
                          size="sm"
                          variant="solid"
                          color="success"
                          onClick={() => setOpenReopenCensusModal(true)}
                          sx={{ width: '100%', marginBottom: 0.5 }}
                          className={isPulsing ? 'animate-pulse' : ''}
                        >
                          Reopen Census
                        </Button>
                        <Button
                          ref={addButtonRef}
                          size="sm"
                          variant="solid"
                          color="primary"
                          sx={{ width: '100%' }}
                          onClick={() => setOpenNewCensusModal(true)}
                          className={isPulsing ? 'animate-pulse' : ''}
                        >
                          Start New Census
                        </Button>
                      </Box>
                    ) : (
                      <Box sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        flexDirection: 'column',
                        width: '100%'
                      }}>
                        <Button disabled={census === undefined} size="sm" variant="solid" color="danger"
                          onClick={() => setOpenCloseCensusModal(true)} sx={{ width: '100%' }}>
                          Close Census
                        </Button>
                      </Box>
                    )}
                  </>
                )}
              </>
            )}
          </Box>
          <Divider orientation={"horizontal"} sx={{ mb: 2, mt: 2 }} />
          <LoginLogout />
          <Modal open={openReopenCensusModal} onClose={() => {
          }}>
            <ModalDialog variant="outlined" role="alertdialog">
              <DialogTitle>
                <WarningRoundedIcon />
                Reopen Census
              </DialogTitle>
              <Divider />
              <DialogContent>
                <Stack direction={"column"} spacing={2}>
                  <Typography level="title-sm">The most recent census ended
                    on: {moment(getOpenClosedCensusStartEndDate('closed', census) ?? new Date()).utc().toDate().toDateString()}</Typography>
                  <Typography level={"title-sm"}>Select a start date for the new census:</Typography>
                  <Typography level="body-sm" color='warning'>NOTE: selected date will be converted to UTC for
                    standardized handling</Typography>
                  <DatePicker
                    label="Reopen Start Date (UTC)"
                    value={moment(reopenStartDate).utc()}
                    onChange={(newValue) => {
                      if (newValue) {
                        setReopenStartDate(moment(newValue.toDate()).utc().toDate());
                      } else {
                        setReopenStartDate(null);
                      }
                    }}
                  />
                </Stack>
              </DialogContent>
              <DialogActions>
                <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                  <Button size={"sm"} color={"danger"} variant="soft" onClick={() => setOpenReopenCensusModal(false)}>
                    Cancel
                  </Button>
                  <Button size={"sm"} variant={"soft"} color="success" onClick={handleReopenCensus}>
                    Submit
                  </Button>
                </Stack>
              </DialogActions>
            </ModalDialog>
          </Modal>
          <Modal open={openNewCensusModal} onClose={() => {
          }}>
            <ModalDialog variant="outlined" role="alertdialog">
              <DialogTitle>
                <WarningRoundedIcon />
                Start New Census
              </DialogTitle>
              <Divider />
              <DialogContent>
                <Stack direction={"column"} spacing={2}>
                  {censusListContext && censusListContext?.length > 0 && (
                    <Typography level="title-sm">The most recent census ended
                      on: {moment(getOpenClosedCensusStartEndDate('closed', census) ?? new Date()).utc().toDate().toDateString()}</Typography>
                  )}
                  <Typography level={"title-sm"}>Select a start date for the new census:</Typography>
                  <Typography level="body-sm" color='warning'>NOTE: selected date will be converted to UTC for
                    standardized handling</Typography>
                  <DatePicker
                    label="New Census Date (UTC)"
                    value={moment(newStartDate).utc()}
                    onChange={(newValue) => {
                      if (newValue) {
                        setNewStartDate(moment(newValue.toDate()).utc().toDate());
                      } else {
                        setNewStartDate(null);
                      }
                    }}
                  />
                </Stack>
              </DialogContent>
              <DialogActions>
                <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                  <Button size={"sm"} color={"danger"} variant="soft" onClick={() => setOpenNewCensusModal(false)}>
                    Cancel
                  </Button>
                  <Button size={"sm"} variant={"soft"} color="success" onClick={handleOpenNewCensus}>
                    Submit
                  </Button>
                </Stack>
              </DialogActions>
            </ModalDialog>
          </Modal>
          <Modal open={openCloseCensusModal} onClose={() => {
          }}>
            <ModalDialog variant="outlined" role="alertdialog">
              <DialogTitle>
                <WarningRoundedIcon />
                Close Census
              </DialogTitle>
              <Divider />
              <DialogContent>
                <Stack direction={"column"} spacing={2}>
                  <Typography level={"title-sm"}>Start
                    Date: {moment(getOpenClosedCensusStartEndDate('open', census) ?? new Date()).utc().toDate().toDateString()}</Typography>
                  <Typography level={"title-sm"}>Select an end date for the current census:</Typography>
                  <Typography level="body-sm" color='warning'>NOTE: selected date will be converted to UTC for
                    standardized handling</Typography>
                  <DatePicker
                    label="Closing Date (UTC)"
                    value={moment(closeEndDate).utc()}
                    onChange={(newValue) => {
                      if (newValue) {
                        setCloseEndDate(moment(newValue.toDate()).utc().toDate());
                      } else {
                        setCloseEndDate(null);
                      }
                    }}
                  />
                </Stack>
              </DialogContent>
              <DialogActions>
                <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                  <Button size={"sm"} color={"danger"} variant="soft" onClick={() => setOpenCloseCensusModal(false)}>
                    Cancel
                  </Button>
                  <Button size={"sm"} variant={"soft"} color="success" onClick={handleCloseCensus}>
                    Submit
                  </Button>
                </Stack>
              </DialogActions>
            </ModalDialog>
          </Modal>
        </Box>
      </Stack>
    </>
  );
}
