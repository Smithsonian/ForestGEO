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
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {LoginLogout} from "@/components/loginlogout";
import {useSession} from "next-auth/react";
import {plots, siteConfigNav, SiteConfigProps} from "@/config/macros";
import {usePlotContext, usePlotDispatch} from "@/app/contexts/plotcontext";
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
  Step,
  StepIndicator,
  Stepper,
  Tooltip
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
  
  const [plot, setPlot] = useState<string | null>(null);
  const [openSelectionModal, setOpenSelectionModal] = useState(false);
  const [activeStep, setActiveStep] = React.useState(0);
  const steps = ["Plot"];
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);
  
  const [properties, setProperties] = useState(false);
  
  function MenuRenderToggle(props: SiteConfigProps, menuOpen: boolean, setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>) {
    const Icon = props.icon;
    return (
      <>
        <ListItemButton
          selected={pathname === props.href || props.expanded.find(value => value.href === pathname) !== undefined}
          color={pathname === props.href ? 'primary' : undefined}
          onClick={() => {
            router.push(props.href);
            setMenuOpen(!menuOpen);
          }}>
          <Icon/>
          <ListItemContent>
            <Typography level={"title-sm"}>{props.label}</Typography>
          </ListItemContent>
          <KeyboardArrowDownIcon
            sx={{transform: menuOpen ? 'rotate(180deg)' : 'none'}}
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
              {siteConfigNav.map((item) => {
                const Icon = item.icon;
                if (item.expanded.length === 0) {
                  return (
                    <>
                      <Tooltip title={item.tip} variant={"soft"}>
                        <ListItem>
                          <ListItemButton selected={pathname === item.href}
                                          color={pathname === item.href ? 'primary' : undefined}
                                          onClick={() => router.push(item.href)}>
                            <Icon/>
                            <ListItemContent>
                              <Typography level={"title-sm"}>{item.label}</Typography>
                            </ListItemContent>
                          </ListItemButton>
                        </ListItem>
                      </Tooltip>
                    </>
                  );
                } else {
                  return (
                    <>
                      <Tooltip title={item.tip} variant={"soft"}>
                        <ListItem nested>
                          <SimpleToggler
                            renderToggle={MenuRenderToggle(item, properties, setProperties)}
                            isOpen={properties}
                          >
                            <List sx={{gap: 0.5}} size={"sm"}>
                              {item.expanded.map((link, linkIndex) => {
                                const SubIcon = link.icon;
                                return (
                                  <>
                                    <ListItem sx={{marginTop: 0.5}} key={linkIndex}>
                                      <ListItemButton selected={pathname == (item.href + link.href)}
                                                      onClick={() => router.push((item.href + link.href))}>
                                        <SubIcon/>
                                        <ListItemContent>
                                          <Typography level={"title-sm"}>{link.label}</Typography>
                                        </ListItemContent>
                                      </ListItemButton>
                                    </ListItem>
                                  </>
                                );
                              })}
                            </List>
                          </SimpleToggler>
                        </ListItem>
                      </Tooltip>
                    </>
                  );
                }
              })}
              <Divider orientation={"horizontal"}/>
              <Breadcrumbs separator={<CommitIcon fontSize={"small"}/>}>
                <Link component={"button"} onClick={() => {
                  setActiveStep(0);
                  setOpenSelectionModal(true);
                }}>
                  <Typography color={!currentPlot ? "danger" : undefined}
                              level="body-sm">Plot: {currentPlot ? currentPlot!.key : "None"}</Typography>
                </Link>
              </Breadcrumbs>
              <Divider orientation={"horizontal"}/>
              <Modal open={openSelectionModal} onClose={() => {
                setActiveStep(0);
                setPlot(null);
                setOpenSelectionModal(false);
              }}>
                <ModalDialog variant="outlined" role="alertdialog">
                  <DialogTitle>
                    <WarningRoundedIcon/>
                    Selection
                  </DialogTitle>
                  <Divider/>
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
                              {activeStep <= index ? index + 1 : <Check/>}
                            </StepIndicator>
                          }
                          sx={{
                            '&::after': {
                              ...(activeStep > index &&
                                index !== 2 && {bgcolor: 'primary.solidBg'}),
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
                    </Box>
                  </DialogContent>
                  <DialogActions>
                    <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
                      <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                        setActiveStep(0);
                        setPlot(null);
                        setOpenSelectionModal(false);
                      }}>
                        Cancel
                      </Button>
                      <Button size={"sm"} variant={"soft"} color="success" onClick={() => {
                        if (plotDispatch) {
                          plotDispatch({plotKey: plot});
                        }
                        setActiveStep(0);
                        setPlot(null);
                        setOpenSelectionModal(false);
                      }}>
                        Finish
                      </Button>
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
