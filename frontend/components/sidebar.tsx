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
import {Plot, siteConfigNav, SiteConfigProps} from "@/config/macros";
import {
  useCensusContext,
  useCensusDispatch,
  usePlotContext,
  usePlotDispatch,
} from "@/app/contexts/userselectionprovider";
import {usePathname, useRouter} from "next/navigation";
import {
  Breadcrumbs,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Modal,
  ModalDialog,
  Stack,
} from "@mui/joy";
import CommitIcon from "@mui/icons-material/Commit";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';
import {useCensusListContext, usePlotListContext} from "@/app/contexts/listselectionprovider";
import {useCensusLoadContext} from "@/app/contexts/coredataprovider";
import {CensusRDS} from "@/config/sqlmacros";
import {getData} from "@/config/db";
import {useSession} from "next-auth/react";
import {useLoading} from "@/app/contexts/loadingprovider";


function SimpleToggler({isOpen, renderToggle, children,}: Readonly<{
  isOpen: boolean;
  children: React.ReactNode;
  renderToggle: any;
}>) {
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
  currentPlot: Plot | null;
  currentCensus: CensusRDS | null;
  pathname: string;
}

function MenuRenderToggle(props: MRTProps, siteConfigProps: SiteConfigProps, menuOpen: boolean | undefined, setMenuOpen: ((value: (((prevState: boolean) => boolean) | boolean)) => void) | undefined) {
  const Icon = siteConfigProps.icon;
  return (
    <ListItemButton
      disabled={props.currentPlot === null || props.currentCensus === null}
      // selected={props.pathname === siteConfigProps.href || siteConfigProps.expanded.find(value => value.href === props.pathname) !== undefined}
      color={props.pathname === siteConfigProps.href ? 'primary' : undefined}
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
        sx={{transform: !menuOpen ? 'rotate(180deg)' : 'none'}}
      />
    </ListItemButton>
  );
}

interface SidebarProps {
  coreDataLoaded: boolean;
}

export default function Sidebar(props: SidebarProps) {
  const {data: session} = useSession();
  const {setLoading} = useLoading();
  let currentPlot = usePlotContext();
  let plotDispatch = usePlotDispatch();
  let plotListContext = usePlotListContext();
  let currentCensus = useCensusContext();
  let censusDispatch = useCensusDispatch();
  let censusListContext = useCensusListContext();
  let censusLoadContext = useCensusLoadContext();

  const [plot, setPlot] = useState<Plot>(currentPlot);
  const [census, setCensus] = useState<CensusRDS>(currentCensus);
  const [openPlotSelectionModal, setOpenPlotSelectionModal] = useState(false);
  const [openCensusSelectionModal, setOpenCensusSelectionModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);

  const [propertiesToggle, setPropertiesToggle] = useState(false);
  const [formsToggle, setFormsToggle] = useState(false);

  const [showResumeDialog, setShowResumeDialog] = useState<boolean>(false);
  const [storedPlot, setStoredPlot] = useState<Plot | null>(null);
  const [storedCensus, setStoredCensus] = useState<CensusRDS | null>(null);

  const {coreDataLoaded} = props;

  useEffect(() => {
    const checkSavedSession = async () => {
      const savedPlot: Plot | null = await getData('plot');
      const savedCensus: CensusRDS | null = await getData('census');
      if (savedPlot && savedCensus) {
        setStoredPlot(savedPlot);
        setStoredCensus(savedCensus);
        setShowResumeDialog(true);
      }
    };
    if (coreDataLoaded) {
      checkSavedSession().catch(console.error);
    }
  }, [coreDataLoaded]);

  const onPlotChange = async (newValue: Plot | null) => {
    setLoading(true, 'Updating plot...');
    setPlot(newValue);
    if (plotDispatch && newValue) {
      await plotDispatch({plot: newValue});
    }
    setLoading(false);
  };

  const onCensusChange = async (newValue: CensusRDS | null) => {
    setLoading(true, 'Updating Census...');
    setCensus(newValue);
    if (censusDispatch && newValue) {
      await censusDispatch({census: newValue});
    }
    setLoading(false);
  };

  const handleResumeSession = async () => {
    setLoading(true, 'Resuming Session...');
    await onPlotChange(storedPlot);
    await onCensusChange(storedCensus);
    setLoading(false);
    setShowResumeDialog(false);
  };

  type ToggleObject = {
    toggle?: boolean;
    setToggle?: Dispatch<SetStateAction<boolean>>;
  };

  // Define the array type
  type ToggleArray = ToggleObject[];
  const toggleArray: ToggleArray = [
    {toggle: undefined, setToggle: undefined},
    {toggle: undefined, setToggle: undefined},
    {toggle: propertiesToggle, setToggle: setPropertiesToggle},
    {toggle: formsToggle, setToggle: setFormsToggle}
  ];

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
              '--Sidebar-width': '375px',
              [theme.breakpoints.up('lg')]: {
                '--Sidebar-width': '375px',
              },
            },
          })}
        />
        <Box sx={{display: 'flex', alignItems: 'left', flexDirection: 'column'}}>
          {session?.user.isAdmin && (
            <Typography level="h1">ADMIN VIEW:</Typography>
          )}
          <Typography level="h1">ForestGEO: </Typography>
          <Typography sx={{fontSize: '1.75rem', fontWeight: 'bold', color: 'aquamarine'}}>C. & S.
            Americas</Typography>
        </Box>
        <Divider orientation={"horizontal"}/>
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
              if (item.expanded.length === 0) {
                return (
                  <ListItem key={item.href}>
                    <ListItemButton selected={pathname === item.href}
                                    disabled={!currentPlot}
                                    color={pathname === item.href ? 'primary' : undefined}
                                    onClick={() => router.push(item.href)}>
                      <Icon/>
                      <ListItemContent>
                        <Typography level={"title-sm"}>{item.label}</Typography>
                      </ListItemContent>
                    </ListItemButton>
                  </ListItem>
                );
              } else {
                return (
                  <ListItem key={item.href} nested>
                    <SimpleToggler
                      renderToggle={MenuRenderToggle({
                        currentPlot,
                        currentCensus,
                        pathname
                      }, item, toggle, setToggle)}
                      isOpen={!!toggle}
                    >
                      <List sx={{gap: 0.5}} size={"sm"}>
                        {item.expanded.map((link) => {
                          const SubIcon = link.icon;
                          return (
                            <ListItem sx={{marginTop: 0.5}} key={link.href}>
                              <ListItemButton
                                selected={pathname == (item.href + link.href)}
                                disabled={!currentPlot}
                                onClick={() => router.push((item.href + link.href))}>
                                <SubIcon/>
                                <ListItemContent>
                                  <Typography
                                    level={"title-sm"}>{link.label}</Typography>
                                </ListItemContent>
                              </ListItemButton>
                            </ListItem>
                          );
                        })}
                      </List>
                    </SimpleToggler>
                  </ListItem>
                );
              }
            })}
            <Divider orientation={"horizontal"}/>

            <Link component={"button"} onClick={() => {
              setOpenPlotSelectionModal(true);
            }} sx={{
              flexDirection: 'column',
              alignSelf: 'flex-start',
              alignItems: 'left',
              textAlign: 'left',
              width: '100%' // Ensure the link takes full width
            }}>
              <Typography color={!currentPlot?.key ? "danger" : "success"}
                          level="body-lg"
                          sx={{ display: 'flex', textAlign: 'left', alignSelf: 'flex-start' }}>
                {currentPlot ? `Plot: ${currentPlot.key}` : "No Plot"}
              </Typography>
            </Link>
            <CommitIcon sx={{transform: 'rotate(90deg)'}}/>
            <Link component={"button"} onClick={() => {
              setOpenCensusSelectionModal(true);
            }} sx={{
              flexDirection: 'column',
              alignSelf: 'flex-start',
              textAlign: 'left',
              width: '100%' // Ensure the link takes full width
            }}>
              <Typography color={(!currentCensus) ? "danger" : "success"}
                          level="body-lg"
                          sx={{ display: 'flex', textAlign: 'left', alignSelf: 'flex-start' }}>
                {currentCensus ? `Census: ${currentCensus.plotCensusNumber}` : 'No Census'}
              </Typography>
              <Typography color={(!currentCensus) ? "danger" : "primary"}
                          level="body-md"
                          sx={{ display: 'flex', textAlign: 'left', alignSelf: 'flex-start', paddingLeft: '1em' }}>
                {currentCensus ? `Starting: ${new Date(currentCensus?.startDate!).toDateString()}` : ''}
              </Typography>
              <Typography color={(!currentCensus) ? "danger" : "primary"}
                          level="body-md"
                          sx={{ display: 'flex', textAlign: 'left', alignSelf: 'flex-start', paddingLeft: '1em' }}>
                {currentCensus ? `Ending: ${new Date(currentCensus?.endDate!).toDateString()}` : ''}
              </Typography>
            </Link>
            <Divider orientation={"horizontal"}/>
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
                        size={"sm"}
                        value={currentPlot ? currentPlot.key : ""}
                        onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
                          // Find the corresponding Plot object using newValue
                          const selectedPlot = plotListContext?.find(plot => plot?.key === newValue) || null;
                          await onPlotChange(selectedPlot);
                        }}
                      >
                        <Option value={""}>None</Option>
                        {plotListContext?.map((item) => (
                          <Option value={item} key={item?.key}>{item?.key},
                            Quadrats: {item?.num},
                            ID: {item?.id}</Option>
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
                    }}>
                      Cancel
                    </Button>
                    <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
                      if (plotDispatch) {
                        await plotDispatch({plot: plot});
                      }
                      setOpenPlotSelectionModal(false);
                    }}>
                      Submit Plot
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
                        size={"sm"}
                        value={currentCensus ? censusListContext?.find(c => c.plotCensusNumber === currentCensus.plotCensusNumber)?.plotCensusNumber.toString() || "" : ""}
                        onChange={async (_event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
                          if (selectedPlotCensusNumberStr) {
                            // Convert the selected string to a number
                            const selectedPlotCensusNumber = parseInt(selectedPlotCensusNumberStr, 10);

                            // Filter and sort logic
                            const filteredCensus = censusLoadContext?.filter(census => census?.plotCensusNumber === selectedPlotCensusNumber)
                              .sort((a, b) => (b?.startDate?.getTime() ?? 0) - (a?.startDate?.getTime() ?? 0));

                            // Update the context with the most recent census
                            const mostRecentCensusRDS = filteredCensus?.[0] ?? null;
                            await onCensusChange(mostRecentCensusRDS);
                          } else {
                            // Handle null or empty value
                            await onCensusChange(null);
                          }
                        }}
                      >
                        <Option value={""}>None</Option>
                        {censusListContext?.slice().sort((a, b) => b.plotCensusNumber - a.plotCensusNumber).map((item) => (
                          <Option key={item.plotCensusNumber}
                                  value={item}>Census {item.plotCensusNumber},
                            starting
                            at {new Date(item.startDate).toDateString() ?? 'Date not found'},
                            ending
                            at {new Date(item.endDate).toDateString() ?? 'Date not found'}</Option>
                        ))}
                      </Select>
                    </Stack>
                  </Box>
                </DialogContent>
                <DialogActions>
                  <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
                    <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                      setCensus(currentCensus);
                      setOpenCensusSelectionModal(false);
                    }}>
                      Cancel
                    </Button>
                    <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
                      if (censusDispatch) {
                        await censusDispatch({census: census});
                      }
                      setOpenCensusSelectionModal(false);
                    }}>
                      Submit Census
                    </Button>
                  </Stack>
                </DialogActions>
              </ModalDialog>
            </Modal>
          </List>
        </Box>
        <Divider/>
        <LoginLogout/>
        <Modal open={showResumeDialog} onClose={() => setShowResumeDialog(false)}>
          <ModalDialog>
            <DialogTitle>Resume Previous Session?</DialogTitle>
            <Divider/>
            <DialogContent>
              <Typography>You have a saved session. Would you like to resume?</Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleResumeSession}>Resume</Button>
              <Button onClick={() => setShowResumeDialog(false)}>Start New Session</Button>
            </DialogActions>
          </ModalDialog>
        </Modal>
      </Box>
    </Stack>
  );
}
