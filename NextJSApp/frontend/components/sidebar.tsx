"use client";
import * as React from 'react';
import {useState} from 'react';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton, {listItemButtonClasses} from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {LoginLogout} from "@/components/loginlogout";
import {useSession} from "next-auth/react";
import {allCensus, allQuadrats, plots, siteConfig} from "@/config/macros";
import {
  useCensusContext,
  useCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useQuadratContext,
  useQuadratDispatch
} from "@/app/plotcontext";
import {usePathname, useRouter} from "next/navigation";
import {
  Breadcrumbs,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Modal, ModalDialog,
  Stack, Step, StepIndicator, Stepper
} from "@mui/joy";
import {Slide} from "@mui/material";
import CommitIcon from "@mui/icons-material/Commit";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import {Check} from "@mui/icons-material";
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';

function SimpleToggler({
                         isOpen,
                         renderToggle,
                         children,
                       }: {
  isOpen: boolean;
  children: React.ReactNode;
  renderToggle: any;
}) {
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

export default function Sidebar() {
  const currentPlot = usePlotContext();
  const plotDispatch = usePlotDispatch();
  const currentCensus = useCensusContext();
  const censusDispatch = useCensusDispatch();
  const currentQuadrat = useQuadratContext();
  const quadratDispatch = useQuadratDispatch();
  
  const [plot, setPlot] = useState<string | null>(null);
  const [census, setCensus] = useState<number | null>(null);
  const [quadrat, setQuadrat] = useState<number | null>(null);
  const [openSelectionModal, setOpenSelectionModal] = useState(false);
  const [activeStep, setActiveStep] = React.useState(0);
  const steps = ["Plot", "Census", "Quadrat"];
  const subMenuLinks = ["/attributes", "/census", "/personnel", "/quadrats", "/species"];
  
  const {status} = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);
  
  const [dash, setDash] = useState(false);
  function DashboardRenderToggle() {
    return (
      <>
        <ListItemButton selected={pathname === '/dashboard' || subMenuLinks.includes(pathname)}
                        color={pathname === '/dashboard' ? 'primary' : undefined}
                        onClick={() => {
                          if (status == "authenticated") {
                            router.push('/dashboard');
                            setDash(!dash);
                          } else {
                            router.push('#');
                          }
                        }}>
          <DashboardIcon/>
          <ListItemContent>
            <Typography level={"title-sm"}>Dashboard</Typography>
          </ListItemContent>
          <KeyboardArrowDownIcon
            sx={{transform: dash ? 'rotate(180deg)' : 'none'}}
          />
        </ListItemButton>
      </>
    );
  }
  
  /**
   * UNAUTHENTICATED SESSION HANDLING:
   */
  useSession({
    required: true,
    onUnauthenticated() {
      return (
        <>
          <Stack direction={"row"} overflow={'hidden'}>
            <Box
              className="Sidebar"
              sx={{
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
              ref={containerRef}
            >
              <GlobalStyles
                styles={(theme) => ({
                  ':root': {
                    '--Sidebar-width': '300px',
                    [theme.breakpoints.up('lg')]: {
                      '--Sidebar-width': '320px',
                    },
                  },
                })}
              />
              <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
                <Typography level="h1">ForestGEO</Typography>
              </Box>
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
              </Box>
              <Divider/>
              <LoginLogout/>
            </Box>
          </Stack>
        </>
      );
    }
  });
  /**
   * AUTHENTICATED SESSION HANDLING
   */
  return (
    <>
      <Stack direction={"row"} sx={{}}>
        {/*BASE SIDEBAR*/}
        <Box
          className="Sidebar"
          sx={{
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
          <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
            <Typography level="h1">ForestGEO</Typography>
          </Box>
          <Divider orientation={"horizontal"} />
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
              <ListItem nested>
                <SimpleToggler
                  renderToggle={DashboardRenderToggle()}
                  isOpen={dash}
                >
                  <List sx={{gap: 0.5}} size={"sm"}>
                    {subMenuLinks.map((link, linkIndex) => (
                      <ListItem sx={{marginTop: 0.5}} key={linkIndex}>
                        <ListItemButton selected={pathname == link}
                                        onClick={() => router.push(link)}>
                          <Typography level={"title-sm"}>{link.charAt(1).toUpperCase() + link.slice(2)}</Typography>
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </SimpleToggler>
              </ListItem>
              <ListItem>
                <ListItemButton selected={pathname === '/files'}
                                color={pathname === '/files' ? 'primary' : undefined}
                                onClick={() => status == "authenticated" ? router.push('/files') : router.push("#")}>
                  <FolderIcon/>
                  <ListItemContent>
                    <Typography level={"title-sm"}>Files</Typography>
                  </ListItemContent>
                </ListItemButton>
              </ListItem>
              <ListItem>
                <ListItemButton selected={pathname === '/data'}
                                color={pathname === '/data' ? 'primary' : undefined}
                                onClick={() => status == "authenticated" ? router.push('/data') : router.push("#")}>
                  <DataObjectIcon/>
                  <ListItemContent>
                    <Typography level={"title-sm"}>Data</Typography>
                  </ListItemContent>
                </ListItemButton>
              </ListItem>
              <Divider orientation={"horizontal"} />
              <Breadcrumbs separator={<CommitIcon fontSize={"small"} />}>
                <Link component={"button"} onClick={() => {
                  setActiveStep(0);
                  setOpenSelectionModal(true);
                }}>
                  <Typography level="body-sm">Plot: {currentPlot ? currentPlot!.key : "None"}</Typography>
                </Link>
                <Link component={"button"} onClick={() => {
                  setActiveStep(1);
                  setOpenSelectionModal(true);
                }}>
                  <Typography level="body-sm">Census: {currentCensus ? currentCensus : "None"}</Typography>
                </Link>
                <Link component={"button"} onClick={() => {
                  setActiveStep(2);
                  setOpenSelectionModal(true);
                }}>
                  <Typography level="body-sm">Quadrat: {currentQuadrat ? currentQuadrat : "None"}</Typography>
                </Link>
              </Breadcrumbs>
              <Divider orientation={"horizontal"} />
              <Modal open={openSelectionModal} onClose={() => {
                setActiveStep(0);
                setPlot(null);
                setCensus(null);
                setQuadrat(null);
                setOpenSelectionModal(false);
              }}>
                <ModalDialog variant="outlined" role="alertdialog">
                  <DialogTitle>
                    <WarningRoundedIcon />
                    Selection
                  </DialogTitle>
                  <Divider />
                  <DialogContent sx={{width: 750}}>
                    <Stepper size={"lg"} sx={{display: 'flex', flexGrow: 1}}>
                      {steps.map((step, index) => (
                        <Step
                          key={step}
                          orientation={"vertical"}
                          indicator={
                            <StepIndicator
                              variant={activeStep <= index ? 'soft' : 'solid'}
                              color={activeStep < index ? 'neutral' : 'primary'}
                            >
                              {activeStep <= index ? index + 1 : <Check />}
                            </StepIndicator>
                          }
                          sx={{
                            '&::after': {
                              ...(activeStep > index &&
                                index !== 2 && { bgcolor: 'primary.solidBg' }),
                            },
                          }}
                        >
                          <Typography level={"title-lg"}>{step}</Typography>
                        </Step>
                      ))}
                    </Stepper>
                    <Box sx={{display: 'inline-block', alignItems: 'center'}} ref={containerRef}>
                      <Slide appear in={activeStep == 0} direction={"right"} container={containerRef.current}>
                        {/*<Stack direction={"column"} spacing={2} marginRight={20} marginLeft={10} marginTop={5}>*/}
                        <Stack direction={"column"} spacing={2}>
                          <Typography level={"title-sm"}>Select Plot:</Typography>
                          <Select
                            placeholder="Select a Plot"
                            name="None"
                            required
                            autoFocus
                            size={"sm"}
                            onChange={(_event: React.SyntheticEvent | null, newValue: string | null,) => setPlot(newValue)}
                          >
                            <Option value={null}>None</Option>
                            {plots.map((keyItem) => (
                              <Option value={keyItem.key}>{keyItem.key}</Option>
                            ))}
                          </Select>
                        </Stack>
                      </Slide>
                      <Slide appear in={activeStep == 1} direction={"right"} container={containerRef.current}>
                        {/*<Stack direction={"column"} spacing={2} marginRight={15} marginTop={5}>*/}
                        <Stack direction={"column"} spacing={2}>
                          <Typography level={"title-sm"}>Select Census:</Typography>
                          <Select
                            placeholder="Select a Census"
                            name="None"
                            required
                            autoFocus
                            size={"sm"}
                            onChange={(_event: React.SyntheticEvent | null, newValue: number | null,) => setCensus(newValue)}
                          >
                            <Option value={null}>None</Option>
                            {allCensus.map((item) => (
                              <Option value={item}>{item}</Option>
                            ))}
                          </Select>
                        </Stack>
                      </Slide>
                      <Slide appear in={activeStep == 2} direction={"right"} container={containerRef.current}>
                        {/*<Stack direction={"column"} spacing={2} marginLeft={5} marginTop={5}>*/}
                        <Stack direction={"column"} spacing={2}>
                          <Typography level={"title-sm"}>Select Quadrat:</Typography>
                          <Select
                            placeholder="Select a Quadrat"
                            name="None"
                            required
                            autoFocus
                            size={"sm"}
                            onChange={(_event: React.SyntheticEvent | null, newValue: number | null,) => setQuadrat(newValue)}
                          >
                            <Option value={null}>None</Option>
                            {allQuadrats.map((item) => (
                              <Option value={item}>{item}</Option>
                            ))}
                          </Select>
                        </Stack>
                      </Slide>
                    </Box>
                  </DialogContent>
                  <DialogActions>
                    <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                      {activeStep > 0 ? <Button size={"sm"} variant={"soft"} onClick={() => setActiveStep(activeStep - 1)}>
                        Previous
                      </Button> : <Button size={"sm"} variant={"soft"} disabled>
                        Previous
                      </Button>}
                      <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                        setActiveStep(0);
                        setPlot(null);
                        setCensus(null);
                        setQuadrat(null);
                        setOpenSelectionModal(false);
                      }}>
                        Cancel
                      </Button>
                      {activeStep < 2 ? <Button size={"sm"} color={"primary"} variant={"soft"} onClick={() => setActiveStep(activeStep + 1)}>
                        Submit {steps[activeStep]}
                      </Button> : <Button size={"sm"} variant={"soft"} color="success" onClick={() => {
                        if (plotDispatch) {
                          plotDispatch({plotKey: plot});
                        }
                        if (censusDispatch) {
                          censusDispatch({census: census});
                        }
                        if (quadratDispatch) {
                          quadratDispatch({quadrat: quadrat});
                        }
                        setActiveStep(0);
                        setPlot(null);
                        setCensus(null);
                        setQuadrat(null);
                        setOpenSelectionModal(false);
                      }}>
                        Finish
                      </Button>}
                    </Stack>
                  </DialogActions>
                </ModalDialog>
              </Modal>
            </List>
          </Box>
          <Divider/>
          <LoginLogout/>
        </Box>
      </Stack>
    </>
  );
}
