"use client";
import * as React from 'react';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Box from '@mui/joy/Box';
import Divider from '@mui/joy/Divider';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton, {listItemButtonClasses} from '@mui/joy/ListItemButton';
import ListItemContent from '@mui/joy/ListItemContent';
import Typography from '@mui/joy/Typography';
import Sheet from '@mui/joy/Sheet';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FolderIcon from '@mui/icons-material/Folder';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AssignmentRoundedIcon from '@mui/icons-material/AssignmentRounded';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {LoginLogout} from "@/components/loginlogout";
import {useSession} from "next-auth/react";
import {allCensus, allQuadrats, drawerWidth, plots, siteConfig} from "@/config/macros";
import {
  useCensusContext,
  useCensusDispatch,
  usePlotContext,
  usePlotDispatch,
  useQuadratContext,
  useQuadratDispatch
} from "@/app/plotcontext";
import {usePathname, useRouter} from "next/navigation";
import Drawer from '@mui/material/Drawer';
import {Stack} from "@mui/joy";

function Toggler({
                   defaultExpanded = false,
                   renderToggle,
                   children,
                 }: {
  defaultExpanded?: boolean;
  children: React.ReactNode;
  renderToggle: (params: {
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  }) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultExpanded);
  return (
    <React.Fragment>
      {renderToggle({open, setOpen})}
      <Box
        sx={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
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
  const {status} = useSession();
  const router = useRouter();
  const pathname = usePathname();
  return (
    <>
      {/*<Drawer*/}
      {/*  sx={{*/}
      {/*    '& .MuiDrawer-root': {*/}
      {/*      position: 'absolute'*/}
      {/*    },*/}
      {/*    '& .MuiPaper-root': {*/}
      {/*      position: 'absolute'*/}
      {/*    },*/}
      {/*    width: drawerWidth,*/}
      {/*    flexShrink: 0,*/}
      {/*    '& .MuiDrawer-paper': {*/}
      {/*      width: drawerWidth,*/}
      {/*      boxSizing: 'border-box',*/}
      {/*    },*/}
      {/*  }}*/}
      {/*  variant="persistent"*/}
      {/*  anchor="left"*/}
      {/*  open={!!currentPlot && currentPlot.key != 'none'}*/}
      {/*>*/}
      {/*</Drawer>*/}
      <Stack direction={"row"} spacing={2}>
        <Box
          className="Sidebar"
          sx={{
            position: {
              md: 'sticky',
            },
            height: '100dvh',
            width: 'var(--Sidebar-width)',
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
              {siteConfig.navItems.map((item, index) => (
                <ListItem>
                  <ListItemButton selected={pathname === item.href}
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
              
              {status == "authenticated" && <ListItem nested>
                <Toggler
                  renderToggle={({open, setOpen}) => (
                    <ListItemButton onClick={() => setOpen(!open)}>
                      <AssignmentRoundedIcon/>
                      <ListItemContent>
                        {currentPlot?.key == "None" || currentPlot?.key == "" || currentPlot == null ?
                          <Typography level="title-sm">Plots</Typography> :
                          <Typography level={"title-sm"}>Now Viewing: {currentPlot!.key}</Typography>}
                      </ListItemContent>
                      <KeyboardArrowDownIcon
                        sx={{transform: open ? 'rotate(180deg)' : 'none'}}
                      />
                    </ListItemButton>
                  )}
                >
                  <List sx={{gap: 0.5}}>
                    <ListItem sx={{mt: 0.5}}>
                      <ListItemButton
                        selected={currentPlot?.key == "None" || currentPlot?.key == "" || currentPlot == null}
                        onClick={() => plotDispatch ? plotDispatch({plotKey: ""}) : null}>
                        None
                      </ListItemButton>
                    </ListItem>
                    {plots.map((keyItem, keyIndex) => (
                      <ListItem key={keyIndex}>
                        <ListItemButton selected={(currentPlot != null) && (currentPlot!.key == keyItem.key)}
                                        onClick={() => plotDispatch ? plotDispatch({plotKey: keyItem.key}) : null}>
                          {keyItem.key}
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </Toggler>
              </ListItem>}
            </List>
          </Box>
          <Divider/>
          <LoginLogout/>
        </Box>
        {status == "authenticated" && currentPlot != null && currentPlot.key != 'none' && <Box
          className="SubSidebar"
          sx={{
            position: {
              md: 'sticky',
            },
            height: '100dvh',
            width: (currentPlot.key !== 'none') ? 'var(--SubSidebar-width)' : 0,
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
                '--SubSidebar-width': '300px',
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
            <Typography level="title-lg">Additional Settings</Typography>
            <List
              size="sm"
              sx={{
                gap: 1,
                '--List-nestedInsetStart': '30px',
                '--ListItem-radius': (theme) => theme.vars.radius.sm,
              }}
            >
              <ListItem nested>
                <Toggler
                  renderToggle={({open, setOpen}) => (
                    <ListItemButton onClick={() => setOpen(!open)}>
                      <AssignmentRoundedIcon/>
                      <ListItemContent>
                        {currentCensus == -1 || currentCensus == null ?
                          <Typography level="title-sm">Select Census</Typography> :
                          <Typography level={"title-sm"}>Selected Census: {currentCensus}</Typography>}
                      </ListItemContent>
                      <KeyboardArrowDownIcon
                        sx={{transform: open ? 'rotate(180deg)' : 'none'}}
                      />
                    </ListItemButton>
                  )}
                >
                  <List sx={{gap: 0.5}}>
                    <ListItem sx={{mt: 0.5}}>
                      <ListItemButton
                        selected={currentCensus == -1 || currentCensus == null}
                        onClick={() => censusDispatch ? censusDispatch({census: -1}) : null}>
                        None
                      </ListItemButton>
                    </ListItem>
                    {allCensus.map((keyItem, keyIndex) => (
                      <ListItem key={keyIndex}>
                        <ListItemButton selected={(currentCensus != null) && (currentCensus == keyItem)}
                                        onClick={() => censusDispatch ? censusDispatch({census: keyItem}) : null}>
                          {keyItem}
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </Toggler>
              </ListItem>
              
              {!!currentCensus && currentCensus > 0 && <ListItem nested>
                <Toggler
                  renderToggle={({open, setOpen}) => (
                    <ListItemButton onClick={() => setOpen(!open)}>
                      <AssignmentRoundedIcon/>
                      <ListItemContent>
                        {currentQuadrat == -1 || currentQuadrat == null ?
                          <Typography level="title-sm">Select Quadrat</Typography> :
                          <Typography level={"title-sm"}>Selected Quadrat: {currentQuadrat}</Typography>}
                      </ListItemContent>
                      <KeyboardArrowDownIcon
                        sx={{transform: open ? 'rotate(180deg)' : 'none'}}
                      />
                    </ListItemButton>
                  )}
                >
                  <List sx={{gap: 0.5}}>
                    <ListItem sx={{mt: 0.5}}>
                      <ListItemButton
                        selected={currentCensus == -1 || currentCensus == null}
                        onClick={() => quadratDispatch ? quadratDispatch({quadrat: -1}) : null}>
                        None
                      </ListItemButton>
                    </ListItem>
                    {allQuadrats.map((keyItem, keyIndex) => (
                      <ListItem key={keyIndex}>
                        <ListItemButton selected={(currentCensus != null) && (currentCensus == keyItem)}
                                        onClick={() => quadratDispatch ? quadratDispatch({quadrat: keyItem}) : null}>
                          {keyItem}
                        </ListItemButton>
                      </ListItem>
                    ))}
                  </List>
                </Toggler>
              </ListItem>}
            </List>
          </Box>
          <Divider/>
          <LoginLogout/>
        </Box>}
      </Stack>
      
    </>
  );
}
