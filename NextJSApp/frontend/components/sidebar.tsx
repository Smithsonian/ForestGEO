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
import {Stack} from "@mui/joy";
import {Slide} from "@mui/material";

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
  
  const [p, setP] = useState(false);
  const [c, setC] = useState(false);
  const [q, setQ] = useState(false);
  
  function plotRenderToggle() {
    return (
      <>
        <ListItemButton onClick={() => setP(!p)}>
          <AssignmentRoundedIcon/>
          <ListItemContent>
            {currentPlot == null ?
              <Typography level="title-sm">Plots</Typography> :
              <Typography level={"title-sm"}>Now Viewing: {currentPlot!.key}</Typography>}
          </ListItemContent>
          <KeyboardArrowDownIcon
            sx={{transform: p ? 'rotate(180deg)' : 'none'}}
          />
        </ListItemButton>
      </>
    );
  }
  
  function censusRenderToggle() {
    return (
      <>
        <ListItemButton onClick={() => setC(!c)}>
          <AssignmentRoundedIcon/>
          <ListItemContent>
            {currentCensus == null ?
              <Typography level="title-sm">Select Census</Typography> :
              <Typography level={"title-sm"}>Selected Census: {currentCensus}</Typography>}
          </ListItemContent>
          <KeyboardArrowDownIcon
            sx={{transform: c ? 'rotate(180deg)' : 'none'}}
          />
        </ListItemButton>
      </>
    );
  }
  
  function quadratRenderToggle() {
    return (
      <>
        <ListItemButton onClick={() => setQ(!q)}>
          <AssignmentRoundedIcon/>
          <ListItemContent>
            {currentQuadrat == null ?
              <Typography level="title-sm">Select Quadrat</Typography> :
              <Typography level={"title-sm"}>Selected Quadrat: {currentQuadrat}</Typography>}
          </ListItemContent>
          <KeyboardArrowDownIcon
            sx={{transform: q ? 'rotate(180deg)' : 'none'}}
          />
        </ListItemButton>
      </>
    );
  }
  
  const {status} = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);
  
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
                <Typography level="title-lg">ForestGEO</Typography>
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
                <List
                  size="sm"
                  sx={{
                    gap: 1,
                    '--List-nestedInsetStart': '30px',
                    '--ListItem-radius': (theme) => theme.vars.radius.sm,
                  }}
                >
                  {siteConfig.navItems.map((item) => (
                    <ListItem>
                      <ListItemButton selected={pathname === item.href}
                                      disabled={!currentPlot}
                                      color={pathname === item.href ? 'primary' : undefined}
                                      onClick={() => status == "authenticated" ? router.push(item.href) : router.push("#")}>
                        {item.label === 'Dashboard' && <DashboardIcon/>}
                        {item.label === 'Files' && <FolderIcon/>}
                        {item.label === 'Data' && <DataObjectIcon/>}
                        <ListItemContent>
                          <Typography level={"title-sm"}>{item.label}</Typography>
                        </ListItemContent>
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
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
            <Typography level="title-lg">ForestGEO</Typography>
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
            <List
              size="sm"
              sx={{
                gap: 1,
                '--List-nestedInsetStart': '30px',
                '--ListItem-radius': (theme) => theme.vars.radius.sm,
              }}
            >
              {siteConfig.navItems.map((item) => (
                <ListItem>
                  <ListItemButton selected={pathname === item.href}
                                  disabled={!currentPlot}
                                  color={pathname === item.href ? 'primary' : undefined}
                                  onClick={() => status == "authenticated" ? router.push(item.href) : router.push("#")}>
                    {item.label === 'Dashboard' && <DashboardIcon/>}
                    {item.label === 'Files' && <FolderIcon/>}
                    {item.label === 'Data' && <DataObjectIcon/>}
                    <ListItemContent>
                      <Typography level={"title-sm"}>{item.label}</Typography>
                    </ListItemContent>
                  </ListItemButton>
                </ListItem>
              ))}
              
              <ListItem nested>
                <SimpleToggler
                  renderToggle={plotRenderToggle()}
                  isOpen={p}
                >
                  <List sx={{gap: 0.5}}>
                    <ListItem sx={{mt: 0.5}}>
                      <ListItemButton
                        selected={currentPlot == null}
                        onClick={() => {
                          censusDispatch ? censusDispatch({census: null}) : null;
                          quadratDispatch ? quadratDispatch({quadrat: null}) : null;
                          setP(false);
                          setC(false);
                          setQ(false);
                          return plotDispatch ? plotDispatch({plotKey: null}) : null;
                        }}>
                        None
                      </ListItemButton>
                    </ListItem>
                    {plots.map((keyItem, keyIndex) => (
                      <ListItem key={keyIndex}>
                        <ListItemButton selected={currentPlot?.key == keyItem.key}
                                        onClick={() => {
                                          setP(!p);
                                          return plotDispatch ? plotDispatch({plotKey: keyItem.key}) : null
                                        }}>
                          {keyItem.key}
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </SimpleToggler>
              </ListItem>
            </List>
          </Box>
          <Divider/>
          <LoginLogout/>
        </Box>
        {/*SUB SIDE BAR HANDLING*/}
        <Slide in={!!currentPlot && pathname == '/dashboard'} direction={"right"}
               container={containerRef.current}>
          <Box
            className="SubSidebar"
            sx={{
              ...(!!currentPlot && pathname == '/dashboard' && {
                position: {
                  md: 'sticky',
                },
                height: '100dvh',
                width: 'calc(var(--SubSidebar-width) )',
                top: 0,
                gap: 5,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid',
                borderColor: 'divider',
              }),
              ...(!(!!currentPlot && pathname == '/dashboard') && {
                position: {
                  md: 'sticky',
                },
                height: '100dvh',
                width: 0,
                top: 0,
                gap: 5,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid',
                borderColor: 'divider',
              }),
            }}
          >
            <GlobalStyles
              styles={(theme) => ({
                ':root': {
                  '--SubSidebar-width': '300',
                  [theme.breakpoints.up('lg')]: {
                    '--SubSidebar-width': '320px',
                  },
                },
              })}
            />
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
              <Box sx={{display: 'flex', gap: 1, alignItems: 'center', marginTop: '25px'}}>
                <Typography level="title-lg">Additional Settings</Typography>
              </Box>
              <List
                size="sm"
                sx={{
                  '--List-nestedInsetStart': '30px',
                  '--ListItem-radius': (theme) => theme.vars.radius.sm,
                }}
              >
                <ListItem nested>
                  <SimpleToggler
                    renderToggle={censusRenderToggle()}
                    isOpen={c}
                  >
                    <List sx={{gap: 0.5}}>
                      <ListItem sx={{mt: 0.5}}>
                        <ListItemButton
                          selected={currentCensus == null}
                          onClick={() => {
                            setC(!c);
                            return censusDispatch ? censusDispatch({census: null}) : null
                          }}>
                          None
                        </ListItemButton>
                      </ListItem>
                      {allCensus.map((keyItem, keyIndex) => (
                        <ListItem key={keyIndex}>
                          <ListItemButton selected={currentCensus == keyItem}
                                          onClick={() => {
                                            setC(!c);
                                            return censusDispatch ? censusDispatch({census: keyItem}) : null
                                          }}>
                            {keyItem}
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </SimpleToggler>
                </ListItem>
                
                {currentCensus && <ListItem nested>
                  <SimpleToggler
                    renderToggle={quadratRenderToggle()}
                    isOpen={q}
                  >
                    <List sx={{gap: 0.5}}>
                      <ListItem sx={{mt: 0.5}}>
                        <ListItemButton
                          selected={currentQuadrat == null}
                          onClick={() => {
                            setQ(!q);
                            return quadratDispatch ? quadratDispatch({quadrat: null}) : null
                          }}>
                          None
                        </ListItemButton>
                      </ListItem>
                      {allQuadrats.map((keyItem, keyIndex) => (
                        <ListItem key={keyIndex}>
                          <ListItemButton selected={currentQuadrat == keyItem}
                                          onClick={() => {
                                            setQ(!q);
                                            return quadratDispatch ? quadratDispatch({quadrat: keyItem}) : null
                                          }}>
                            {keyItem}
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </SimpleToggler>
                </ListItem>}
              </List>
            </Box>
          </Box>
        </Slide>
      </Stack>
    </>
  );
}
