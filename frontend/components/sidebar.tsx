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
  useUSPLoadingContext
} from "@/app/contexts/userselectionprovider";
import {usePathname, useRouter} from "next/navigation";
import {
  Breadcrumbs,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormLabel,
  Link,
  Modal,
  ModalDialog,
  Stack,
} from "@mui/joy";
import CommitIcon from "@mui/icons-material/Commit";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';
import {usePlotListContext} from "@/app/contexts/listselectionprovider";
import {TextField} from "@mui/material";
import Add from '@mui/icons-material/Add';
import {useCensusLoadContext, useCensusLoadDispatch} from "@/app/contexts/coredataprovider";
import {CensusRDS} from "@/config/sqlmacros";
import {getData} from "@/config/db";
import CircularProgress from "@mui/joy/CircularProgress";


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

function MenuRenderToggle(props: MRTProps, siteConfigProps: SiteConfigProps, menuOpen: boolean, setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>) {
  const Icon = siteConfigProps.icon;
  return (
    <ListItemButton
      disabled={props.currentPlot === null || props.currentCensus === null}
      // selected={props.pathname === siteConfigProps.href || siteConfigProps.expanded.find(value => value.href === props.pathname) !== undefined}
      color={props.pathname === siteConfigProps.href ? 'primary' : undefined}
      onClick={() => {
        setMenuOpen(!menuOpen);
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

export default function Sidebar() {
  let initialCensus: CensusRDS = {
    id: 0,
    censusID: 0,
    plotID: null,
    plotCensusNumber: null,
    startDate: null,
    endDate: null,
    description: null,
  }
  let currentPlot = usePlotContext();
  let plotDispatch = usePlotDispatch()!;
  let plotListContext = usePlotListContext();
  let currentCensus = useCensusContext();
  let censusDispatch = useCensusDispatch()!;
  let censusLoadContext = useCensusLoadContext()!;
  let censusLoadDispatch = useCensusLoadDispatch();

  const [loading, setLoading] = useState<boolean>();

  useEffect(() => {
    const fetchCensusPlot = async () => {
      setLoading(true);
      console.log('fetchCensusPlot in sidebar called');
      const storedCensus = await getData('census');
      console.log(`sidebar fetchCensusPlot: stored census: ${storedCensus?.censusID}`);
      if (storedCensus) censusDispatch({census: storedCensus});
      const storedPlot = await getData('plot');
      console.log(`sidebar fetchCensusPlot: stored plot: ${storedPlot?.key}`);
      if (storedPlot) plotDispatch({plot: storedPlot});
      setLoading(false);
    }

    fetchCensusPlot().catch(console.error);
  }, []);

  const [plot, setPlot] = useState<Plot | null>(currentPlot);
  const [census, setCensus] = useState<CensusRDS | null>(currentCensus);
  const [openPlotSelectionModal, setOpenPlotSelectionModal] = useState(false);
  const [openCensusSelectionModal, setOpenCensusSelectionModal] = useState(false);
  const [openAddCensusSelectionModal, setOpenAddCensusSelectionModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);

  const [propertiesToggle, setPropertiesToggle] = useState(false);
  const [formsToggle, setFormsToggle] = useState(false);
  const [newCensusData, setNewCensusData] = useState<CensusRDS>(initialCensus);
  const {plotLoading, censusLoading, quadratLoading} = useUSPLoadingContext();

  type ToggleObject = {
    toggle?: boolean;
    setToggle?: Dispatch<SetStateAction<boolean>>;
  };

  // Define the array type
  type ToggleArray = ToggleObject[];
  const toggleArray: ToggleArray = [
    {toggle: undefined, setToggle: undefined},
    {toggle: undefined, setToggle: undefined},
    {toggle: undefined, setToggle: undefined},
    {toggle: propertiesToggle, setToggle: setPropertiesToggle},
    {toggle: formsToggle, setToggle: setFormsToggle}
  ]

  const handleFieldChange = (field: string) => (_event: any, newValue: any) => {
    setNewCensusData({...newCensusData, [field]: newValue});
  };

  const handleInputChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setNewCensusData({...newCensusData, [field]: event.target.value});
  };
  const handleAddCensus = async () => {
    if (!newCensusData.plotID || !newCensusData.plotCensusNumber || !newCensusData.startDate || !newCensusData.endDate) {
      alert('Please fill in all required fields.');
      return;
    }

    const plotID = newCensusData.plotID;
    const plotCensusNumber = newCensusData.plotCensusNumber;
    if (isNaN(plotID) || isNaN(plotCensusNumber)) {
      alert('Plot ID and Plot Census Number must be valid numbers.');
      return;
    }
    const highestCensusID = Math.max(
      ...censusLoadContext.map((censusRDS) => censusRDS.censusID),
      0
    );

    const newCensus: CensusRDS = {
      id: 0,
      censusID: highestCensusID + 1,
      plotID: plotID,
      plotCensusNumber: plotCensusNumber,
      startDate: new Date(newCensusData.startDate),
      endDate: new Date(newCensusData.endDate),
      description: newCensusData.description
    };

    try {
      const updatedCensusList: CensusRDS[] = [...censusLoadContext, newCensus];
      if (censusLoadDispatch) censusLoadDispatch({censusLoad: updatedCensusList});
      setOpenAddCensusSelectionModal(false);
    } catch (error) {
      console.error('Error adding new census:', error);
      alert('Failed to add new census.');
    }
  };
  /**
   * AUTHENTICATED SESSION HANDLING
   */

  if (plotLoading || censusLoading || quadratLoading || loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center">
        <CircularProgress/>
      </Box>
    );
  }

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
        <Box sx={{display: 'flex', gap: 1, alignItems: 'left'}}>
          <Typography level="h1">ForestGEO: <Typography className={"text-teal-400"}>Panama</Typography></Typography>
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
                      renderToggle={MenuRenderToggle({currentPlot, currentCensus, pathname}, item, toggle!, setToggle!)}
                      isOpen={toggle!}
                    >
                      <List sx={{gap: 0.5}} size={"sm"}>
                        {item.expanded.map((link) => {
                          const SubIcon = link.icon;
                          return (
                            <ListItem sx={{marginTop: 0.5}} key={link.href}>
                              <ListItemButton selected={pathname == (item.href + link.href)}
                                              disabled={!currentPlot}
                                              onClick={() => router.push((item.href + link.href))}>
                                <SubIcon/>
                                <ListItemContent>
                                  <Typography level={"title-sm"}>{link.label}</Typography>
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
            <Breadcrumbs separator={<CommitIcon fontSize={"small"}/>}>
              <Link component={"button"} onClick={() => {
                setOpenPlotSelectionModal(true);
              }}>
                <Typography color={!currentPlot?.key ? "danger" : "success"}
                            level="body-lg">
                  {currentPlot ? `Plot: ${currentPlot.key}` : "No Plot"}
                  {currentPlot ? ` -> ID: ${currentPlot.id}` : ''}
                </Typography>
              </Link>
              <Link disabled={!currentPlot} component={"button"} onClick={() => {
                setOpenCensusSelectionModal(true);
              }}>
                <Typography color={(!currentPlot || !currentCensus) ? "danger" : "success"}
                            level="body-lg">
                  {currentCensus ? `Census: ${currentCensus.censusID}` : 'No Census'}
                </Typography>
              </Link>
            </Breadcrumbs>
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
                        onChange={(_event: React.SyntheticEvent | null, newValue: Plot | null,) => setPlot(newValue)}
                      >
                        <Option value={""}>None</Option>
                        {plotListContext?.map((item) => (
                          <Option value={item} key={item.key}>{item.key}, Quadrats: {item.num},
                            ID: {item.id}</Option>
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
                    <Button size={"sm"} variant={"soft"} color="success" onClick={() => {
                      if (plotDispatch) {
                        plotDispatch({plot: plot});
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
                      <Button startDecorator={<Add/>} onClick={() => setOpenAddCensusSelectionModal(true)}>New
                        Census</Button>
                      <Typography level={"title-sm"}>Select Census:</Typography>
                      <Select
                        placeholder="Select a Census"
                        name="None"
                        required
                        autoFocus
                        size={"sm"}
                        onChange={(_event: React.SyntheticEvent | null, newValue: CensusRDS | null,) => setCensus(newValue)}
                      >
                        <Option value={""}>None</Option>
                        {censusLoadContext.slice().sort((a, b) => b.censusID - a.censusID).map((item) => (
                          <Option key={item.censusID} value={item}>Census {item.censusID},
                            starting at {new Date(item.startDate!).toDateString() ?? 'Date not found'}, ending
                            at {new Date(item.endDate!).toDateString() ?? 'Date not found'}</Option>
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
                    <Button size={"sm"} variant={"soft"} color="success" onClick={() => {
                      if (censusDispatch) {
                        censusDispatch({census: census});
                      }
                      setOpenCensusSelectionModal(false);
                    }}>
                      Submit Census
                    </Button>
                  </Stack>
                </DialogActions>
              </ModalDialog>
            </Modal>
            <Modal open={openAddCensusSelectionModal} onClose={() => {
              setOpenAddCensusSelectionModal(false);
            }}>
              <ModalDialog variant={"outlined"} role={"alertdialog"}>
                <DialogTitle>Add New Census</DialogTitle>
                <DialogContent>
                  <FormLabel id="plot-select-label">Plot</FormLabel>
                  <Select
                    placeholder="Select a Plot"
                    name="None"
                    required
                    autoFocus
                    size="sm"
                    onChange={(event, newValue) => handleFieldChange('plotID')(event, newValue)}
                  >
                    {plotListContext?.map((item) => (
                      <Option value={item} key={item.key}>{item.key}, Quadrats: {item.num}, ID: {item.id}</Option>
                    ))}
                  </Select>
                  <TextField
                    label="Plot Census Number"
                    type="number"
                    fullWidth
                    margin="dense"
                    value={newCensusData.plotCensusNumber}
                    onChange={handleInputChange('plotCensusNumber')}
                  />
                  <TextField
                    label="Start Date"
                    type="date"
                    fullWidth
                    margin="dense"
                    InputLabelProps={{shrink: true}}
                    value={newCensusData.startDate}
                    onChange={handleInputChange('startDate')}
                  />
                  <TextField
                    label="End Date"
                    type="date"
                    fullWidth
                    margin="dense"
                    InputLabelProps={{shrink: true}}
                    value={newCensusData.endDate}
                    onChange={handleInputChange('endDate')}
                  />
                  <TextField
                    label="Description (Optional)"
                    fullWidth
                    margin="dense"
                    multiline
                    maxRows={4}
                    value={newCensusData.description}
                    onChange={handleInputChange('description')}
                  />
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setOpenAddCensusSelectionModal(false)}>Cancel</Button>
                  <Button onClick={handleAddCensus}>Add</Button>
                </DialogActions>
              </ModalDialog>
            </Modal>
          </List>
          <Divider orientation={"horizontal"}/>
        </Box>
        <Divider/>
        <LoginLogout/>
      </Box>
    </Stack>
  );
}
