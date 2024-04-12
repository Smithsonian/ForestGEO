"use client";
import * as React from 'react';
import {Dispatch, SetStateAction, useEffect, useState} from 'react';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton, {listItemButtonClasses} from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {LoginLogout} from "@/components/loginlogout";
import {Plot, Site, siteConfigNav, SiteConfigProps} from "@/config/macros";
import {
  useCensusContext,
  useCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useSiteContext,
  useSiteDispatch
} from "@/app/contexts/userselectionprovider";
import {usePathname, useRouter} from "next/navigation";
import {
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Modal,
  ModalDialog,
  SelectOption,
  Stack,
} from "@mui/joy";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';
import {
  useCensusListContext,
  usePlotListContext,
  useSiteListContext
} from "@/app/contexts/listselectionprovider";
import {useCensusLoadContext} from "@/app/contexts/coredataprovider";
import {CensusRDS} from "@/config/sqlmacros";
import {getData} from "@/config/db";
import {useSession} from "next-auth/react";
import {useLoading} from "@/app/contexts/loadingprovider";
import Check from "@mui/icons-material/Check";
import ListItemDecorator from "@mui/joy/ListItemDecorator";
import {SlideToggle, TransitionComponent} from "@/components/client/clientmacros";
import ListDivider from "@mui/joy/ListDivider";
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from "@mui/joy/Avatar";
import {CensusLogo, Logo, PlotLogo} from "@/components/icons";
import {RainbowTypography} from '@/styles/rainbowtext'
import {RainbowIcon} from '@/styles/rainbowicon';

export interface SimpleTogglerProps {
  isOpen: boolean;
  children: React.ReactNode;
  renderToggle: any;
}

export function SimpleToggler({isOpen, renderToggle, children,}: Readonly<SimpleTogglerProps>) {
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
}

function MenuRenderToggle(props: MRTProps, siteConfigProps: SiteConfigProps, menuOpen: boolean | undefined, setMenuOpen: Dispatch<SetStateAction<boolean>> | undefined) {
  const Icon = siteConfigProps.icon;
  const {plotSelectionRequired, censusSelectionRequired, pathname} = props;
  return (
    <ListItemButton
      disabled={plotSelectionRequired || censusSelectionRequired}
      // selected={props.pathname === siteConfigProps.href || siteConfigProps.expanded.find(value => value.href === props.pathname) !== undefined}
      color={pathname === siteConfigProps.href ? 'primary' : undefined}
      onClick={() => {
        if (setMenuOpen) {
          setMenuOpen(!menuOpen);
        }
      }}>
      <Icon/>
      <ListItemContent>
        <Typography level={"title-sm"}>{siteConfigProps.label}</Typography>
      </ListItemContent>
      <KeyboardArrowDownIcon
        sx={{transform: menuOpen ? 'rotate(180deg)' : 'none'}}
      />
    </ListItemButton>
  );
}

interface SidebarProps {
  siteListLoaded: boolean
  coreDataLoaded: boolean;
}

export default function Sidebar(props: SidebarProps) {
  const {data: session} = useSession();
  let currentSite = useSiteContext();
  let siteDispatch = useSiteDispatch();
  let currentPlot = usePlotContext();
  let plotDispatch = usePlotDispatch();
  let plotListContext = usePlotListContext();
  let currentCensus = useCensusContext();
  let censusDispatch = useCensusDispatch();
  let censusListContext = useCensusListContext();
  let censusLoadContext = useCensusLoadContext();
  let siteListContext = useSiteListContext();

  const [plot, setPlot] = useState<Plot>(currentPlot);
  const [census, setCensus] = useState<CensusRDS>(currentCensus);
  const [site, setSite] = useState<Site>(currentSite);
  const [openPlotSelectionModal, setOpenPlotSelectionModal] = useState(false);
  const [openCensusSelectionModal, setOpenCensusSelectionModal] = useState(false);
  const [openSiteSelectionModal, setOpenSiteSelectionModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);

  const [measurementsToggle, setMeasurementsToggle] = useState(false);
  const [propertiesToggle, setPropertiesToggle] = useState(false);
  const [formsToggle, setFormsToggle] = useState(false);

  const [showResumeDialog, setShowResumeDialog] = useState<boolean>(false);
  const [storedPlot, setStoredPlot] = useState<Plot>(null);
  const [storedCensus, setStoredCensus] = useState<CensusRDS>(null);
  const [storedSite, setStoredSite] = useState<Site>(null);

  const [isInitialSiteSelectionRequired, setIsInitialSiteSelectionRequired] = useState(true);
  // Additional states for plot and census selection requirements
  const [isPlotSelectionRequired, setIsPlotSelectionRequired] = useState(true);
  const [isCensusSelectionRequired, setIsCensusSelectionRequired] = useState(true);


  const {coreDataLoaded, siteListLoaded} = props;

  const getSortedCensusData = () => {
    const ongoingCensus = censusListContext?.filter(c => c.endDate === null);
    const historicalCensuses = censusListContext?.filter(c => c.endDate !== null)
      .sort((a, b) => {
        // Convert startDate to Date objects if they are not already
        const dateA = new Date(a.startDate);
        const dateB = new Date(b.startDate);

        return (dateB.getTime() ?? 0) - (dateA.getTime() ?? 0);
      });

    return {ongoingCensus, historicalCensuses};
  };

  const {ongoingCensus, historicalCensuses} = getSortedCensusData();

  useEffect(() => {
    if (siteListLoaded && session) {
      getData('site').then((savedSite: Site) => setStoredSite(savedSite)).catch(console.error);
      getData('plot').then((savedPlot: Plot) => setStoredPlot(savedPlot)).catch(console.error);
      getData('census').then((savedCensus: CensusRDS) => setStoredCensus(savedCensus)).catch(console.error);
    }
  }, [siteListLoaded, session]);

  useEffect(() => {
    if (storedSite && session) {
      // Retrieve the user's allowed sites
      const allowedSiteIDs = new Set(session.user.sites.map(site => site.siteID));
      if (allowedSiteIDs.has(storedSite.siteID)) {
        handleResumeSession().catch(console.error);
      } else {
        handleSiteSelection(null).catch(console.error);
      }
      // setShowResumeDialog(true);
    }
  }, [storedSite, storedPlot, storedCensus, siteListLoaded]);

  useEffect(() => {
    // Check if site is selected and core data is loaded, then allow other interactions
    if (currentSite && coreDataLoaded) {
      setIsInitialSiteSelectionRequired(false);
    }
    if (currentPlot) setIsPlotSelectionRequired(false);
    if (currentCensus) setIsCensusSelectionRequired(false);
  }, [currentSite, currentPlot, currentCensus, coreDataLoaded]);

  // This function is an additional layer to manage UI state changes on site selection
  const handleSiteSelection = async (selectedSite: Site | null) => {
    // Update the site context (original onSiteChange functionality)
    setSite(selectedSite);
    if (siteDispatch) {
      await siteDispatch({site: selectedSite});
    }
    if (selectedSite === null) { // site's been reset, plot needs to be voided
      await handlePlotSelection(null);
    }
  };

  // Handle plot selection
  const handlePlotSelection = async (selectedPlot: Plot | null) => {
    setPlot(selectedPlot);
    if (plotDispatch) {
      await plotDispatch({plot: selectedPlot});
    }
    if (selectedPlot === null) {
      await handleCensusSelection(null); // if plot's reset, then census needs to be voided too
    }
  };

  // Handle census selection
  const handleCensusSelection = async (selectedCensus: CensusRDS | null) => {
    setCensus(selectedCensus);
    if (censusDispatch) {
      await censusDispatch({census: selectedCensus});
    }
  };

  // Saved session loading is modified to focus on Plot and Census only
  const handleResumeSession = async () => {
    storedSite ? await handleSiteSelection(storedSite) : undefined;
    storedPlot ? await handlePlotSelection(storedPlot) : undefined;
    storedCensus ? await handleCensusSelection(storedCensus) : undefined;
    // setShowResumeDialog(false);
  };

  const renderCensusValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Census</Typography>; // or some placeholder JSX
    }

    // Find the corresponding CensusRDS object
    const selectedValue = option.value; // assuming option has a 'value' property
    const selectedCensus = censusListContext?.find(c => c.plotCensusNumber.toString() === selectedValue);
    // Return JSX
    return selectedCensus ? <Typography>{`Census: ${selectedCensus?.plotCensusNumber}`}</Typography> :
      <Typography>No Census</Typography>;
  };

  const renderPlotValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Plot</Typography>; // or some placeholder JSX
    }

    // Find the corresponding CensusRDS object
    const selectedValue = option.value; // assuming option has a 'value' property
    const selectedPlot = plotListContext?.find(c => c?.key === selectedValue);

    // Return JSX
    return selectedPlot ? <Typography>{`Plot: ${selectedPlot?.key}`}</Typography> : <Typography>No Plot</Typography>;
  };

  type ToggleObject = {
    toggle?: boolean;
    setToggle?: Dispatch<SetStateAction<boolean>>;
  };

  // Define the array type
  type ToggleArray = ToggleObject[];
  const toggleArray: ToggleArray = [
    {toggle: undefined, setToggle: undefined},
    {toggle: measurementsToggle, setToggle: setMeasurementsToggle},
    {toggle: propertiesToggle, setToggle: setPropertiesToggle},
    {toggle: formsToggle, setToggle: setFormsToggle}
  ];

  const renderSiteOptions = () => {
    const allowedSites = siteListContext?.filter(site =>
      session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)
    );

    const otherSites = siteListContext?.filter(site =>
      !session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)
    );

    return (
      <Select
        placeholder="Select a Site"
        name="None"
        required
        autoFocus
        size={"md"}
        value={site ? siteListContext?.find(i => i.siteName === site.siteName)?.siteName : ""}
        onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
          const selectedSite = siteListContext?.find(site => site?.siteName === newValue) || null;
          setSite(selectedSite);
        }}
      >
        {/* Allowed Sites Group */}
        <List aria-labelledby="allowed-sites-group" sx={{'--ListItemDecorator-size': '28px'}}>
          <ListItem id="allowed-sites-group" sticky>
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

        <ListDivider role="none"/>

        {/* Other Sites Group */}
        <List aria-labelledby="other-sites-group" sx={{'--ListItemDecorator-size': '28px'}}>
          <ListItem id="other-sites-group" sticky>
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
    <Stack direction={"row"} sx={{display: 'flex', width: 'fit-content'}}>
      {/*BASE SIDEBAR*/}
      <Box
        className="Sidebar"
        sx={{
          // ...disabledStyle,
          position: {
            md: 'sticky',
          },
          height: '100dvh',
          width: 'calc(var(--Sidebar-width) )',
          top: 0,
          p: 2,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          borderRight: '1px solid',
          borderColor: 'divider',
        }}
      >
        <GlobalStyles
          styles={(theme) => ({
            ':root': {
              '--Sidebar-width': '380px',
              [theme.breakpoints.up('lg')]: {
                '--Sidebar-width': '380px',
              },
            },
          })}
        />
        <Box sx={{flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1}}>
          <Box sx={{display: 'flex', alignItems: 'left', flexDirection: 'column'}}>
            {/* <Stack direction={"row"}>
              {session?.user.isAdmin && (
                <Typography level="h1">AV</Typography>
              )}
              <Typography level="h1">ForestGEO</Typography>
            </Stack> */}
            <Typography level="h1">
              <Box sx={{display: 'flex', alignItems: 'center'}}>
                <Box sx={{marginRight: 1.5}}>
                  <RainbowIcon/>
                </Box>
                ForestGEO
                {session?.user.isAdmin &&
                  <Typography level="h1" color='danger' sx={{marginLeft: 0.5}}>(Admin)</Typography>}
              </Box>
            </Typography>
            <Divider orientation='horizontal' sx={{my: 0.75}}/>
            <Link component={"button"} onClick={() => {
              if (siteListLoaded) {
                setOpenSiteSelectionModal(true);
              } else {
                alert('Site list loading failed. Please contact an administrator.');
              }
            }} sx={{
              display: 'flex', alignItems: 'center', paddingBottom: '0.25em', width: '100%', textAlign: 'left'
            }}>
              <Avatar>
                <TravelExploreIcon/>
              </Avatar>
              <Typography
                color={!currentSite?.siteName ? "danger" : "success"}
                level="h2"
                sx={{
                  marginLeft: 1, display: 'flex', flexGrow: 1
                }}>
                {currentSite ? `Site: ${currentSite.siteName}` : "Select Site"}
              </Typography>
            </Link>
          </Box>
          <SlideToggle isOpen={!isInitialSiteSelectionRequired}>
            {/* This block will slide down when a site is selected */}
            <Link component={"button"} onClick={() => {
              setOpenPlotSelectionModal(true);
            }} sx={{
              display: 'flex', alignItems: 'center', paddingBottom: '0.75em', width: '100%', textAlign: 'left'
            }}>
              <Avatar size={"sm"}>
                <PlotLogo/>
              </Avatar>
              <Typography color={!currentPlot?.key ? "danger" : "success"}
                          level="h3"
                          sx={{marginLeft: 1, display: 'flex', flexGrow: 1}}>
                {currentPlot ? `Plot: ${currentPlot.key}` : "Select Plot"}
              </Typography>
            </Link>
            <SlideToggle
              isOpen={!isPlotSelectionRequired}>
              {/* This block will slide down when a plot is selected */}
              <Box sx={{display: 'flex', flexDirection: 'column'}}>
                <Link component={"button"} onClick={() => {
                  setOpenCensusSelectionModal(true);
                }}
                      sx={{display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left'}}>
                  <Avatar size={"sm"}>
                    <CensusLogo/>
                  </Avatar>
                  <Typography color={(!currentCensus) ? "danger" : "success"}
                              level="h4"
                              sx={{marginLeft: 1}}>
                    {currentCensus ? `Census: ${currentCensus.plotCensusNumber}` : 'Select Census'}
                  </Typography>
                </Link>
                <Box
                  sx={{marginLeft: '2.5em'}}> {/* Adjust marginLeft to match Avatar's width plus its marginLeft, mt for slight vertical adjustment */}
                  <Typography color={(!currentCensus) ? "danger" : "primary"}
                              level="body-md"
                              sx={{textAlign: 'left', paddingLeft: '1em'}}>
                    {(currentCensus !== null) && (
                      <>{(currentCensus.startDate) ? `Starting: ${new Date(currentCensus?.startDate!).toDateString()}` : ''}</>
                    )}
                  </Typography>
                  <Typography color={(!currentCensus) ? "danger" : "primary"}
                              level="body-md"
                              sx={{textAlign: 'left', paddingLeft: '1em'}}>

                    {(currentCensus !== null) && (
                      <>{(currentCensus.endDate) ? `Ending ${new Date(currentCensus.endDate).toDateString()}` : `Ongoing`}</>
                    )}
                  </Typography>
                </Box>
              </Box>
              <Divider orientation='horizontal' sx={{marginTop: 2}}/>
              {/* Remaining Parts of Navigation Menu -- want this to be accessible from plot selection since not all links need census selection */}
              <SlideToggle isOpen={!isCensusSelectionRequired}>
                <Box sx={{display: 'flex', flexDirection: 'column', marginTop: 1}}>
                  <Typography level="body-lg" color='neutral'>Azure Storage Container:</Typography>
                  <Typography level="body-md"
                              color='primary'>{currentPlot?.key.trim() ?? 'none'}-{currentCensus?.plotCensusNumber?.toString() ?? 'none'}</Typography>
                  <Divider orientation='horizontal' sx={{marginTop: 2}}/>
                </Box>
              </SlideToggle>
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
                    const {toggle, setToggle} = toggleArray[index];

                    // Calculate delay based on index (e.g., 100ms per item)
                    const delay = (index) * 200;

                    if (item.expanded.length === 0) {
                      return (
                        <TransitionComponent key={item.href} in={!isPlotSelectionRequired}
                                             style={{transitionDelay: `${delay}ms`}} direction="up">
                          <ListItem>
                            <ListItemButton selected={pathname === item.href}
                                            disabled={isPlotSelectionRequired || isCensusSelectionRequired}
                                            color={pathname === item.href ? 'primary' : undefined}
                                            onClick={() => router.push(item.href)}>
                              <Icon/>
                              <ListItemContent>
                                <Typography level={"title-sm"}>{item.label}</Typography>
                              </ListItemContent>
                            </ListItemButton>
                          </ListItem>
                        </TransitionComponent>
                      );
                    } else {
                      return (
                        <TransitionComponent key={item.href} in={!isPlotSelectionRequired}
                                             style={{transitionDelay: `${delay}ms`}} direction="up">
                          <ListItem nested>
                            <SimpleToggler
                              renderToggle={MenuRenderToggle({
                                plotSelectionRequired: isPlotSelectionRequired,
                                censusSelectionRequired: isCensusSelectionRequired,
                                pathname
                              }, item, toggle, setToggle)}
                              isOpen={!!toggle}
                            >
                              <List sx={{gap: 0.5}} size={"sm"}>
                                {item.expanded.map((link, subIndex) => {
                                  const SubIcon = link.icon;
                                  // Calculate delay based on index (e.g., 100ms per item)
                                  const delay = (subIndex + 1) * 200;
                                  return (
                                    <TransitionComponent key={link.href} in={!!toggle}
                                                         style={{transitionDelay: `${delay}ms`}} direction="up">
                                      <ListItem sx={{marginTop: 0.5}}>
                                        <ListItemButton
                                          selected={pathname == (item.href + link.href)}
                                          disabled={isPlotSelectionRequired || isCensusSelectionRequired}
                                          onClick={() => router.push((item.href + link.href))}>
                                          <SubIcon/>
                                          <ListItemContent>
                                            <Typography
                                              level={"title-sm"}>{link.label}</Typography>
                                          </ListItemContent>
                                        </ListItemButton>
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
            </SlideToggle>
          </SlideToggle>
        </Box>
        <Box sx={{display: 'flex', alignItems: 'left', flexDirection: 'column'}}>
          <Divider orientation={"horizontal"} sx={{mb: 2}}/>
          <LoginLogout/>
        </Box>
        <Modal open={showResumeDialog} onClose={() => setShowResumeDialog(false)}>
          <ModalDialog>
            <DialogTitle>Resume Previous Session?</DialogTitle>
            <Divider/>
            <DialogContent>
              <Typography>Would you like to continue with the last Site you chose?</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleResumeSession}>Resume</Button>
              <Button onClick={() => setShowResumeDialog(false)}>Start New Session</Button>
            </DialogActions>
          </ModalDialog>
        </Modal>
        <Modal open={openSiteSelectionModal} onClose={() => {
          setSite(currentSite);
          setOpenSiteSelectionModal(false);
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon/>
              Site Selection
            </DialogTitle>
            <Divider/>
            <DialogContent sx={{width: 750}}>
              <Box sx={{display: 'inline-block', alignItems: 'center'}} ref={containerRef}>
                <Stack direction={"column"} spacing={2}>
                  <Typography level={"title-sm"}>Select Site:</Typography>
                  {renderSiteOptions()}
                </Stack>
              </Box>
            </DialogContent>
            <DialogActions>
              <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
                <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                  setSite(currentSite);
                  setOpenSiteSelectionModal(false);
                  if (site) setIsInitialSiteSelectionRequired(false);
                  else setIsInitialSiteSelectionRequired(true);
                }}>
                  Cancel
                </Button>
                <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
                  await handleSiteSelection(site);
                  setOpenSiteSelectionModal(false);
                  if (site) setIsInitialSiteSelectionRequired(false);
                  else setIsInitialSiteSelectionRequired(true);
                }}>
                  Submit
                </Button>
              </Stack>
            </DialogActions>
          </ModalDialog>
        </Modal>
        <Modal open={openPlotSelectionModal} onClose={() => {
          setPlot(currentPlot);
          setOpenPlotSelectionModal(false);
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon/>
              Plot Selection
            </DialogTitle>
            <Divider/>
            <DialogContent sx={{width: 750}}>
              <Box sx={{display: 'inline-block', alignItems: 'center'}} ref={containerRef}>
                <Stack direction={"column"} spacing={2}>
                  <Typography level={"title-sm"}>Select Plot:</Typography>
                  <Select
                    placeholder="Select a Plot"
                    name="None"
                    required
                    autoFocus
                    size={"md"}
                    renderValue={renderPlotValue}
                    onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
                      // Find the corresponding Plot object using newValue
                      const selectedPlot = plotListContext?.find(plot => plot?.key === newValue) || null;
                      setPlot(selectedPlot);
                    }}
                  >
                    <Option value={""}>None</Option>
                    {plotListContext?.map((item) => (
                      <Option value={item?.key} key={item?.key}>
                        <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
                          <Typography level="body-lg">{item?.key}</Typography>
                          <Typography level="body-md" color={"primary"} sx={{paddingLeft: '1em'}}>
                            Quadrats: {item?.num}
                          </Typography>
                          <Typography level="body-md" color={"primary"} sx={{paddingLeft: '1em'}}>
                            ID: {item?.id}
                          </Typography>
                        </Box>
                      </Option>
                    ))}
                  </Select>
                </Stack>
              </Box>
            </DialogContent>
            <DialogActions>
              <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
                <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                  setPlot(currentPlot);
                  setOpenPlotSelectionModal(false);
                  if (plot) setIsPlotSelectionRequired(false);
                  else setIsPlotSelectionRequired(true);
                }}>
                  Cancel
                </Button>
                <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
                  await handlePlotSelection(plot);
                  setOpenPlotSelectionModal(false);
                  if (plot) setIsPlotSelectionRequired(false);
                  else setIsPlotSelectionRequired(true);
                }}>
                  Submit
                </Button>
              </Stack>
            </DialogActions>
          </ModalDialog>
        </Modal>
        <Modal open={openCensusSelectionModal} onClose={() => {
          setCensus(currentCensus);
          setOpenCensusSelectionModal(false);
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon/>
              Census Selection
            </DialogTitle>
            <Divider/>
            <DialogContent sx={{width: 750}}>
              <Box sx={{display: 'inline-block', alignItems: 'center'}} ref={containerRef}>
                <Stack direction={"column"} spacing={2}>
                  <Typography level={"title-sm"}>Select Census:</Typography>
                  <Select
                    placeholder="Select a Census"
                    name="None"
                    required
                    autoFocus
                    size={"md"}
                    renderValue={renderCensusValue}
                    onChange={async (_event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
                      if (selectedPlotCensusNumberStr === '' || selectedPlotCensusNumberStr === null) await handleCensusSelection(null);
                      else {
                        // Convert the selected string to a number
                        const selectedPlotCensusNumber = parseInt(selectedPlotCensusNumberStr, 10);
                        // Filter and sort logic
                        const filteredCensus = censusLoadContext?.filter(census => census?.plotCensusNumber === selectedPlotCensusNumber)
                          .sort((a, b) => (b?.startDate?.getTime() ?? 0) - (a?.startDate?.getTime() ?? 0));
                        // Update the context with the most recent census
                        const mostRecentCensusRDS = filteredCensus?.[0] ?? null;
                        setCensus(mostRecentCensusRDS);
                      }
                    }}
                  >
                    <List>
                      <Option value={""}>None</Option>
                      <Divider orientation={"horizontal"}/>
                      {ongoingCensus && ongoingCensus.length > 0 && (
                        ongoingCensus.map((item) => (
                          <Option key={item.plotCensusNumber} value={item.plotCensusNumber.toString()}>
                            <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
                              <Typography level="body-lg">Census: {item.plotCensusNumber}</Typography>
                              <Typography level="body-md" color={"primary"} sx={{paddingLeft: '1em'}}>
                                {`Started: ${new Date(item.startDate).toDateString()}`}
                              </Typography>
                            </Box>
                          </Option>
                        ))
                      )}
                      <Divider orientation={"horizontal"}/>
                      {historicalCensuses && historicalCensuses.length > 0 && (
                        historicalCensuses.map((item) => (
                          <Option key={item.plotCensusNumber} value={item.plotCensusNumber.toString()}>
                            <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
                              <Typography level="body-lg">Census {item.plotCensusNumber}</Typography>
                              <Typography level="body-md" color={"primary"} sx={{paddingLeft: '1em'}}>
                                {`Started: ${new Date(item.startDate).toDateString()}`}
                              </Typography>
                              <Typography level="body-md" color={"primary"} sx={{paddingLeft: '1em'}}>
                                {item.endDate && `Ended: ${new Date(item.endDate).toDateString()}`}
                              </Typography>
                            </Box>
                            <ListItemDecorator sx={{opacity: 0}}>
                              <Check/>
                            </ListItemDecorator>
                          </Option>
                        ))
                      )}
                      <Divider orientation={"horizontal"}/>
                    </List>
                  </Select>
                </Stack>
              </Box>
            </DialogContent>
            <DialogActions>
              <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
                <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                  setCensus(currentCensus);
                  if (census) setIsCensusSelectionRequired(false);
                  else setIsCensusSelectionRequired(true);
                }}>
                  Cancel
                </Button>
                <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
                  await handleCensusSelection(census);
                  setOpenCensusSelectionModal(false);
                  if (census) setIsCensusSelectionRequired(false);
                  else setIsCensusSelectionRequired(true);
                }}>
                  Submit
                </Button>
              </Stack>
            </DialogActions>
          </ModalDialog>
        </Modal>
      </Box>
    </Stack>
  );
}
