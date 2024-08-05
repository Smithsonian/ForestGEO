// "use client";
// import * as React from 'react';
// import {Dispatch, SetStateAction, useEffect, useState} from 'react';
// import GlobalStyles from '@mui/joy/GlobalStyles';
// import Box from '@mui/joy/Box';
// import Divider from '@mui/joy/Divider';
// import List from '@mui/joy/List';
// import ListItem from '@mui/joy/ListItem';
// import ListItemButton, {listItemButtonClasses} from '@mui/joy/ListItemButton';
// import ListItemContent from '@mui/joy/ListItemContent';
// import Typography from '@mui/joy/Typography';
// import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
// import {LoginLogout} from "@/components/loginlogout";
// import {siteConfigNav, validityMapping} from "@/config/macros/siteconfigs";
// import {SiteConfigProps} from "@/config/macros/siteconfigs";
// import {Site} from "@/config/sqlrdsdefinitions/tables/sitesrds";
// import {Plot} from "@/config/sqlrdsdefinitions/tables/plotrds";
// import {
//   useOrgCensusContext,
//   useOrgCensusDispatch,
//   usePlotContext,
//   usePlotDispatch,
//   useSiteContext,
//   useSiteDispatch
// } from "@/app/contexts/userselectionprovider";
// import {usePathname, useRouter} from "next/navigation";
// import {
//   Button,
//   DialogActions,
//   DialogContent,
//   DialogTitle,
//   Link,
//   Modal,
//   ModalDialog,
//   SelectOption,
//   Stack,
//   Badge,
//   Tooltip,
// } from "@mui/joy";
// import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
// import Select from "@mui/joy/Select";
// import Option from '@mui/joy/Option';
// import {
//   useOrgCensusListContext,
//   useOrgCensusListDispatch,
//   usePlotListContext,
//   useSiteListContext
// } from "@/app/contexts/listselectionprovider";
// import {useSession} from "next-auth/react";
// import {SlideToggle, TransitionComponent} from "@/components/client/clientmacros";
// import ListDivider from "@mui/joy/ListDivider";
// import TravelExploreIcon from '@mui/icons-material/TravelExplore';
// import Avatar from "@mui/joy/Avatar";
// import {CensusLogo, PlotLogo} from "@/components/icons";
// import {RainbowIcon} from '@/styles/rainbowicon';
// import {useDataValidityContext} from '@/app/contexts/datavalidityprovider';
// import {OrgCensus, OrgCensusRDS, OrgCensusToCensusResultMapper} from '@/config/sqlrdsdefinitions/orgcensusrds';

// export interface SimpleTogglerProps {
//   isOpen: boolean;
//   children: React.ReactNode;
//   renderToggle: any;
// }

// export function SimpleToggler({isOpen, renderToggle, children,}: Readonly<SimpleTogglerProps>) {
//   return (
//     <React.Fragment>
//       {renderToggle}
//       <Box
//         sx={{
//           display: 'grid',
//           gridTemplateRows: isOpen ? '1fr' : '0fr',
//           transition: '0.2s ease',
//           '& > *': {
//             overflow: 'hidden',
//           },
//         }}
//       >
//         {children}
//       </Box>
//     </React.Fragment>
//   );
// }

// interface MRTProps {
//   plotSelectionRequired: boolean;
//   censusSelectionRequired: boolean;
//   pathname: string;
//   isParentDataIncomplete: boolean;
// }

// function MenuRenderToggle(props: MRTProps, siteConfigProps: SiteConfigProps, menuOpen: boolean | undefined, setMenuOpen: Dispatch<SetStateAction<boolean>> | undefined) {
//   const Icon = siteConfigProps.icon;
//   const {plotSelectionRequired, censusSelectionRequired, pathname, isParentDataIncomplete} = props;
//   const currentSite = useSiteContext();
//   const currentPlot = usePlotContext();
//   const currentCensus = useOrgCensusContext();
//   return (
//     <ListItemButton
//       disabled={plotSelectionRequired || censusSelectionRequired}
//       color={pathname === siteConfigProps.href ? 'primary' : undefined}
//       onClick={() => {
//         if (setMenuOpen) {
//           setMenuOpen(!menuOpen);
//         }
//       }}>
//       <Tooltip title={isParentDataIncomplete ? "Missing Core Data!" : "Requirements Met"} arrow>
//         <Badge
//           color="danger"
//           variant={isParentDataIncomplete ? 'solid' : 'soft'}
//           badgeContent={isParentDataIncomplete ? '!' : undefined}
//           invisible={!isParentDataIncomplete || !currentSite || !currentPlot || !currentCensus}
//         >
//           <Icon/>
//         </Badge>
//       </Tooltip>
//       <ListItemContent>
//         <Typography level={"title-sm"}>{siteConfigProps.label}</Typography>
//       </ListItemContent>
//       <KeyboardArrowDownIcon
//         sx={{transform: menuOpen ? 'rotate(180deg)' : 'none'}}
//       />
//     </ListItemButton>
//   );
// }

// interface SidebarProps {
//   siteListLoaded: boolean
//   coreDataLoaded: boolean;
//   setCensusListLoaded: Dispatch<SetStateAction<boolean>>;
//   setManualReset: Dispatch<SetStateAction<boolean>>;
// }

// export default function SidebarDeprecated(props: SidebarProps) {
//   const {data: session} = useSession();
//   const currentSite = useSiteContext();
//   const siteDispatch = useSiteDispatch();
//   const currentPlot = usePlotContext();
//   const plotDispatch = usePlotDispatch();
//   const currentCensus = useOrgCensusContext();
//   const censusDispatch = useOrgCensusDispatch();
//   const censusListContext = useOrgCensusListContext();
//   const censusListDispatch = useOrgCensusListDispatch();
//   const siteListContext = useSiteListContext();
//   const plotListContext = usePlotListContext();
//   const {validity} = useDataValidityContext();
//   const isAllValiditiesTrue = Object.values(validity).every(Boolean);

//   const [plot, setPlot] = useState<Plot>(currentPlot);
//   const [census, setCensus] = useState<OrgCensus>(currentCensus);
//   const [site, setSite] = useState<Site>(currentSite);
//   const router = useRouter();
//   const pathname = usePathname();
//   const containerRef = React.useRef<HTMLElement>(null);

//   const [measurementsToggle, setMeasurementsToggle] = useState(false);
//   const [propertiesToggle, setPropertiesToggle] = useState(false);
//   const [formsToggle, setFormsToggle] = useState(false);

//   const [storedPlot, setStoredPlot] = useState<Plot>();
//   const [storedCensus, setStoredCensus] = useState<OrgCensus>();
//   const [storedSite, setStoredSite] = useState<Site>();

//   const [isInitialSiteSelectionRequired, setIsInitialSiteSelectionRequired] = useState(true);
//   const [isPlotSelectionRequired, setIsPlotSelectionRequired] = useState(true);
//   const [isCensusSelectionRequired, setIsCensusSelectionRequired] = useState(true);

//   const {coreDataLoaded, setManualReset, siteListLoaded, setCensusListLoaded} = props;

//   const [openSiteSelectionModal, setOpenSiteSelectionModal] = useState(false);
//   const [openPlotSelectionModal, setOpenPlotSelectionModal] = useState(false);
//   const [openCensusSelectionModal, setOpenCensusSelectionModal] = useState(false);
//   const [openCloseCensusModal, setOpenCloseCensusModal] = useState(false);
//   const [openReopenCensusModal, setOpenReopenCensusModal] = useState(false);

//   const [reopenStartDate, setReopenStartDate] = useState<Date | null>(null);
//   const [closeEndDate, setCloseEndDate] = useState<Date | null>(null);

//   const handleReopenCensus = async () => {
//     if (currentCensus && reopenStartDate) {
//       const mapper = new OrgCensusToCensusResultMapper();
//       const validCensusListContext = (censusListContext || []).filter((census): census is OrgCensusRDS => census !== undefined);
//       await mapper.reopenCensus(currentSite?.schemaName || '', currentCensus.plotCensusNumber, reopenStartDate, validCensusListContext);
//       setCensusListLoaded(false);
//       setOpenReopenCensusModal(false);
//     }
//   };

//   const handleCloseCensus = async () => {
//     if (currentCensus && closeEndDate) {
//       const mapper = new OrgCensusToCensusResultMapper();
//       const validCensusListContext = (censusListContext || []).filter((census): census is OrgCensusRDS => census !== undefined);
//       await mapper.closeCensus(currentSite?.schemaName || '', currentCensus.plotCensusNumber, closeEndDate, validCensusListContext);
//       setCensusListLoaded(false);
//       setOpenCloseCensusModal(false);
//     }
//   };

//   useEffect(() => {
//     setPlot(currentPlot);
//     setCensus(currentCensus);
//     console.log('census: ', census);
//     setSite(currentSite);
//   }, [currentPlot, currentCensus, currentSite]);

//   // useEffect(() => {
//   //   if (siteListLoaded && session) {
//   //     const checkAndInitializeKey = async (key: string, defaultValue: any) => {
//   //       try {
//   //         const data = await getData(key);
//   //         if (data === undefined) {
//   //           await setData(key, defaultValue);
//   //         }
//   //       } catch (error) {
//   //         console.error(`Error initializing key ${key} in IDB:`, error);
//   //         await setData(key, defaultValue); // Ensure the key is present
//   //       }
//   //     };

//   //     const initializeKeys = async () => {
//   //       await Promise.all([
//   //         checkAndInitializeKey('site', null),
//   //         checkAndInitializeKey('plot', null),
//   //         checkAndInitializeKey('census', null)
//   //       ]);
//   //     };

//   //     initializeKeys().then(() => {
//   //       getData('site').then((savedSite: Site) => setStoredSite(savedSite)).catch(console.error);
//   //       getData('plot').then((savedPlot: Plot) => setStoredPlot(savedPlot)).catch(console.error);
//   //       getData('census').then((savedCensus: OrgCensus) => setStoredCensus(savedCensus)).catch(console.error);
//   //     }).catch(console.error);
//   //   }
//   // }, [siteListLoaded, session]);

//   useEffect(() => {
//     if (storedSite && session) {
//       const allowedSiteIDs = new Set(session.user.sites.map(site => site.siteID));
//       if (allowedSiteIDs.has(storedSite.siteID)) {
//         handleResumeSession().catch(console.error);
//       } else {
//         handleSiteSelection(undefined).catch(console.error);
//       }
//     }
//   }, [storedSite, storedPlot, storedCensus, siteListLoaded]);

//   useEffect(() => {
//     if (currentSite && coreDataLoaded) {
//       setIsInitialSiteSelectionRequired(false);
//     }
//     if (currentPlot) setIsPlotSelectionRequired(false);
//     if (currentCensus) setIsCensusSelectionRequired(false);
//   }, [currentSite, currentPlot, currentCensus, coreDataLoaded]);

//   const handleSiteSelection = async (selectedSite: Site | undefined) => {
//     setSite(selectedSite);
//     if (siteDispatch) {
//       await siteDispatch({site: selectedSite});
//     }
//     if (selectedSite === undefined) {
//       await handlePlotSelection(undefined);
//     }
//   };

//   const handlePlotSelection = async (selectedPlot: Plot) => {
//     setPlot(selectedPlot);
//     if (plotDispatch) {
//       await plotDispatch({plot: selectedPlot});
//     }
//     if (selectedPlot === undefined) {
//       await handleCensusSelection(undefined);
//     }
//   };

//   const handleCensusSelection = async (selectedCensus: OrgCensus) => {
//     setCensus(selectedCensus);
//     if (censusDispatch) {
//       await censusDispatch({census: selectedCensus});
//     }
//   };

//   const handleResumeSession = async () => {
//     storedSite ? await handleSiteSelection(storedSite) : undefined;
//     storedPlot ? await handlePlotSelection(storedPlot) : undefined;
//     storedCensus ? await handleCensusSelection(storedCensus) : undefined;
//   };

//   const renderCensusValue = (option: SelectOption<string> | null) => {
//     if (!option) {
//       return <Typography>Select a Census</Typography>;
//     }

//     const selectedValue = option.value;
//     const selectedCensus = censusListContext?.find(c => c?.plotCensusNumber?.toString() === selectedValue);
//     return selectedCensus ? <Typography>{`Census: ${selectedCensus?.plotCensusNumber}`}</Typography> :
//       <Typography>No Census</Typography>;
//   };

//   const renderPlotValue = (option: SelectOption<string> | null) => {
//     if (!option) {
//       return <Typography>Select a Plot</Typography>;
//     }

//     const selectedValue = option.value;
//     const selectedPlot = plotListContext?.find(c => c?.plotName === selectedValue);

//     return selectedPlot ? <Typography>{`Plot: ${selectedPlot?.plotName}`}</Typography> :
//       <Typography>No Plot</Typography>;
//   };

//   type ToggleObject = {
//     toggle?: boolean;
//     setToggle?: Dispatch<SetStateAction<boolean>>;
//   };

//   type ToggleArray = ToggleObject[];
//   const toggleArray: ToggleArray = [
//     {toggle: undefined, setToggle: undefined},
//     {toggle: measurementsToggle, setToggle: setMeasurementsToggle},
//     {toggle: propertiesToggle, setToggle: setPropertiesToggle},
//     {toggle: formsToggle, setToggle: setFormsToggle}
//   ];

//   const renderSiteOptions = () => {
//     const allowedSites = siteListContext?.filter(site =>
//       session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)
//     );

//     const otherSites = siteListContext?.filter(site =>
//       !session?.user?.sites.some(allowedSite => allowedSite.siteID === site.siteID)
//     );

//     return (
//       <Select
//         className='site-selection-menu'
//         placeholder="Select a Site"
//         name="None"
//         required
//         autoFocus
//         size={"md"}
//         value={site ? siteListContext?.find(i => i.siteName === site.siteName)?.siteName : ""}
//         onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
//           const selectedSite = siteListContext?.find(site => site?.siteName === newValue) || undefined;
//           setSite(selectedSite);
//         }}
//       >
//         <List className="site-deselect-option-3" aria-labelledby="deselect-site">
//           <ListItem sticky>
//             <Typography level="body-xs" textTransform="uppercase">
//               Deselect Site (will trigger app reset!):
//             </Typography>
//           </ListItem>
//           <Option key="none" value="">None</Option>
//         </List>
//         <ListDivider role="none"/>
//         <List className="site-allowed-site-list-4" aria-labelledby="allowed-sites-group"
//               sx={{'--ListItemDecorator-size': '28px'}}>
//           <ListItem id="allowed-sites-group" sticky>
//             <Typography level="body-xs" textTransform="uppercase">
//               Allowed Sites ({allowedSites?.length})
//             </Typography>
//           </ListItem>
//           {allowedSites?.map((site) => (
//             <Option key={site.siteID} value={site.siteName}>
//               {site.siteName}
//             </Option>
//           ))}
//         </List>
//         <ListDivider role="none"/>
//         <List className="site-not-allowed-site-list-5" aria-labelledby="other-sites-group"
//               sx={{'--ListItemDecorator-size': '28px'}}>
//           <ListItem id="other-sites-group" sticky>
//             <Typography level="body-xs" textTransform="uppercase">
//               Other Sites ({otherSites?.length})
//             </Typography>
//           </ListItem>
//           {otherSites?.map((site) => (
//             <Option key={site.siteID} value={site.siteName} disabled>
//               {site.siteName}
//             </Option>
//           ))}
//         </List>
//       </Select>
//     );
//   };

//   return (
//     <>
//       <Stack direction={"row"} sx={{display: 'flex', width: 'fit-content'}}>
//         <Box
//           className="Sidebar"
//           sx={{
//             position: 'sticky',
//             top: 0,
//             left: 0,
//             height: '100vh',
//             width: 'calc(var(--Sidebar-width))',
//             p: 2,
//             flexShrink: 0,
//             display: 'flex',
//             flexDirection: 'column',
//             gap: 2,
//             borderRight: '1px solid',
//             borderColor: 'divider',
//             overflowY: 'auto'
//           }}
//         >
//           <GlobalStyles
//             styles={(theme) => ({
//               ':root': {
//                 '--Sidebar-width': '340px',
//                 [theme.breakpoints.up('lg')]: {
//                   '--Sidebar-width': '340px',
//                 },
//               },
//             })}
//           />
//           <Box sx={{flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1}}>
//             <Box sx={{display: 'flex', alignItems: 'left', flexDirection: 'column'}}>
//               <Stack direction={"column"}>
//                 <Typography level="h1">
//                   <Box sx={{display: 'flex', alignItems: 'center'}}>
//                     <Box sx={{marginRight: 1.5}}>
//                       <RainbowIcon/>
//                     </Box>
//                     ForestGEO
//                   </Box>
//                   {session?.user.isAdmin && (
//                     <Typography level="h1" color='danger' sx={{marginLeft: 0.5}}>(Admin)</Typography>
//                   )}
//                 </Typography>
//               </Stack>
//               <Divider orientation='horizontal' sx={{my: 0.75}}/>
//               <Link className="site-selection-1" component={"button"} onClick={() => {
//                 if (siteListLoaded) {
//                   setOpenSiteSelectionModal(true);
//                 } else {
//                   alert('Site list loading failed. Please contact an administrator.');
//                 }
//               }} sx={{
//                 display: 'flex', alignItems: 'center', paddingBottom: '0.25em', width: '100%', textAlign: 'left'
//               }}>
//                 <Avatar>
//                   <TravelExploreIcon/>
//                 </Avatar>
//                 <Typography
//                   color={!currentSite?.siteName ? "danger" : "success"}
//                   level="h2"
//                   sx={{
//                     marginLeft: 1, display: 'flex', flexGrow: 1
//                   }}>
//                   {currentSite !== undefined ? `Site: ${currentSite.siteName}` : "Select Site"}
//                 </Typography>
//               </Link>
//             </Box>
//             <SlideToggle isOpen={!isInitialSiteSelectionRequired}>
//               <Link className="plot-selection-6" component={"button"} onClick={() => {
//                 setOpenPlotSelectionModal(true);
//               }} sx={{
//                 display: 'flex', alignItems: 'center', paddingBottom: '0.75em', width: '100%', textAlign: 'left'
//               }}>
//                 <Avatar size={"sm"}>
//                   <PlotLogo/>
//                 </Avatar>
//                 <Typography color={!plot?.plotName ? "danger" : "success"}
//                             level="h3"
//                             sx={{marginLeft: 1, display: 'flex', flexGrow: 1}}>
//                   {plot !== undefined ? `Plot: ${plot.plotName}` : "Select Plot"}
//                 </Typography>
//               </Link>
//               <SlideToggle
//                 isOpen={!isPlotSelectionRequired}>
//                 <Box className="census-selection-12" sx={{display: 'flex', flexDirection: 'column'}}>
//                   <Link component={"button"} onClick={() => {
//                     setOpenCensusSelectionModal(true);
//                   }}
//                         sx={{display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left'}}>
//                     <Avatar size={"sm"}>
//                       <CensusLogo/>
//                     </Avatar>
//                     <Typography color={(!census) ? "danger" : "success"}
//                                 level="h4"
//                                 sx={{marginLeft: 1}}>
//                       {census !== undefined ? `Census: ${census.plotCensusNumber}` : 'Select Census'}
//                     </Typography>
//                   </Link>
//                   <Box
//                     sx={{marginLeft: '2.5em'}}>
//                     <Typography color={(!census) ? "danger" : "primary"}
//                                 level="body-md"
//                                 sx={{textAlign: 'left', paddingLeft: '1em'}}>
//                       {(census !== undefined) && (
//                         <>{(census.dateRanges[0]?.startDate) ? `Starting: ${new Date(census?.dateRanges[0]?.startDate).toDateString()}` : ''}</>
//                       )}
//                     </Typography>
//                     <Typography color={(!census) ? "danger" : "primary"}
//                                 level="body-md"
//                                 sx={{textAlign: 'left', paddingLeft: '1em'}}>
//                       {(census !== undefined) && (
//                         <>{(census.dateRanges[0]?.endDate) ? `Ending ${new Date(census.dateRanges[0]?.endDate).toDateString()}` : `Ongoing`}</>
//                       )}
//                     </Typography>
//                   </Box>
//                 </Box>
//                 <Divider orientation='horizontal' sx={{marginTop: 2}}/>
//                 <Box
//                   sx={{
//                     minHeight: 0,
//                     overflow: 'hidden auto',
//                     flexGrow: 1,
//                     display: 'flex',
//                     flexDirection: 'column',
//                     [`& .${listItemButtonClasses.root}`]: {
//                       gap: 1.5,
//                     },
//                   }}
//                 >
//                   <List
//                     size="lg"
//                     sx={{
//                       gap: 1,
//                       '--List-nestedInsetStart': '30px',
//                       '--ListItem-radius': (theme) => theme.vars.radius.sm,
//                     }}
//                   >
//                     {siteConfigNav.map((item, index: number) => {
//                       const Icon = item.icon;
//                       const {toggle, setToggle} = toggleArray[index];
//                       const delay = (index) * 200;

//                       const getTooltipMessage = (href: string, isDataIncomplete: boolean) => {
//                         if (isDataIncomplete) {
//                           switch (href) {
//                             case '/summary':
//                               return 'You must resolve all supporting data warnings before adding measurements!';
//                             case '/subquadrats':
//                               return 'Subquadrats cannot be viewed until quadrats are valid.';
//                             case '/quadratpersonnel':
//                               return 'Quadrat personnel cannot be viewed until both quadrats and personnel are valid.';
//                             default:
//                               return 'Data needed to complete census!';
//                           }
//                         } else {
//                           return 'Requirements Met';
//                         }
//                       };

//                       const getDisabledState = (href: string) => {
//                         switch (href) {
//                           case '/summary':
//                             return !isAllValiditiesTrue;
//                           case '/subquadrats':
//                             return !validity['quadrats'];
//                           case '/quadratpersonnel':
//                             return !(validity['quadrats'] && validity['personnel']);
//                           default:
//                             return false;
//                         }
//                       };

//                       if (item.expanded.length === 0) {
//                         const isLinkDisabled = getDisabledState(item.href);
//                         const isDataIncomplete = isLinkDisabled;

//                         return (
//                           <TransitionComponent key={item.href} in={!isPlotSelectionRequired}
//                                                style={{transitionDelay: `${delay}ms`}} direction="down">
//                             <ListItem>
//                               <Tooltip title={getTooltipMessage(item.href, isDataIncomplete)} arrow>
//                                 <Box sx={{display: 'flex', flex: 1}}>
//                                   <ListItemButton selected={pathname === item.href} sx={{flex: 1}}
//                                                   disabled={isPlotSelectionRequired || isCensusSelectionRequired || isLinkDisabled}
//                                                   color={pathname === item.href ? 'primary' : undefined}
//                                                   onClick={() => {
//                                                     if (!isLinkDisabled) {
//                                                       router.push(item.href);
//                                                     }
//                                                   }}>
//                                     <Badge
//                                       color="danger"
//                                       variant={isLinkDisabled ? 'solid' : 'soft'}
//                                       badgeContent={isLinkDisabled ? '!' : undefined}
//                                       invisible={!isLinkDisabled}
//                                     >
//                                       <Icon/>
//                                     </Badge>
//                                     <ListItemContent>
//                                       <Typography level={"title-sm"}>{item.label}</Typography>
//                                     </ListItemContent>
//                                   </ListItemButton>
//                                 </Box>
//                               </Tooltip>
//                             </ListItem>
//                           </TransitionComponent>
//                         );
//                       } else {
//                         const isParentDataIncomplete = item.expanded.some(subItem => {
//                           const dataKey = validityMapping[subItem.href];
//                           return dataKey !== undefined && !validity[dataKey];
//                         });
//                         return (
//                           <TransitionComponent key={item.href} in={!isPlotSelectionRequired}
//                                                style={{transitionDelay: `${delay}ms`}} direction="down">
//                             <ListItem nested>
//                               <SimpleToggler
//                                 renderToggle={MenuRenderToggle({
//                                   plotSelectionRequired: isPlotSelectionRequired,
//                                   censusSelectionRequired: isCensusSelectionRequired,
//                                   pathname, isParentDataIncomplete
//                                 }, item, toggle, setToggle)}
//                                 isOpen={!!toggle}
//                               >
//                                 <List sx={{gap: 0.75}} size={"sm"}>
//                                   {item.expanded.map((link, subIndex) => {
//                                     const SubIcon = link.icon;
//                                     const delay = (subIndex + 1) * 200;
//                                     const dataValidityKey = validityMapping[link.href];
//                                     const isDataIncomplete = dataValidityKey ? !validity[dataValidityKey] : false;
//                                     const isLinkDisabled = getDisabledState(link.href);
//                                     const tooltipMessage = getTooltipMessage(link.href, isDataIncomplete || (link.href === '/summary' && !isAllValiditiesTrue));

//                                     return (
//                                       <TransitionComponent key={link.href} in={!!toggle}
//                                                            style={{transitionDelay: `${delay}ms`}} direction="down">
//                                         <ListItem sx={{marginTop: 0.75}}>
//                                           <Tooltip title={tooltipMessage} arrow>
//                                             <Box sx={{display: 'flex', flex: 1}}>
//                                               <ListItemButton sx={{flex: 1}}
//                                                               selected={pathname == (item.href + link.href)}
//                                                               disabled={isPlotSelectionRequired || isCensusSelectionRequired || isLinkDisabled}
//                                                               onClick={() => {
//                                                                 if (!isLinkDisabled) {
//                                                                   router.push((item.href + link.href));
//                                                                 }
//                                                               }}>
//                                                 <Badge
//                                                   color={link.href === '/summary' ? "warning" : "danger"}
//                                                   variant={link.href === '/summary' ? (!isAllValiditiesTrue ? 'solid' : 'soft') : (isDataIncomplete ? 'solid' : 'soft')}
//                                                   badgeContent={link.href === '/summary' ? (!isAllValiditiesTrue ? '!' : undefined) : (isDataIncomplete ? '!' : undefined)}
//                                                   invisible={link.href === '/summary' ? isAllValiditiesTrue : !isDataIncomplete}
//                                                 >
//                                                   <SubIcon/>
//                                                 </Badge>
//                                                 <ListItemContent>
//                                                   <Typography level={"title-sm"}>{link.label}</Typography>
//                                                 </ListItemContent>
//                                               </ListItemButton>
//                                             </Box>
//                                           </Tooltip>
//                                         </ListItem>
//                                       </TransitionComponent>
//                                     );
//                                   })}
//                                 </List>
//                               </SimpleToggler>
//                             </ListItem>
//                           </TransitionComponent>
//                         );
//                       }
//                     })}
//                   </List>
//                 </Box>
//               </SlideToggle>
//             </SlideToggle>
//           </Box>
//           <Divider orientation={"horizontal"} sx={{mb: 2}}/>
//           <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
//             {census && census.dateRanges[0].endDate ? (
//               <Box sx={{
//                 display: 'flex',
//                 justifyContent: 'center',
//                 alignItems: 'center',
//                 flexDirection: 'column',
//                 width: '100%'
//               }}>
//                 <Button disabled={census === undefined} size="sm" variant="solid" color="success"
//                         onClick={() => setOpenReopenCensusModal(true)} sx={{width: '100%', marginBottom: 0.5}}>
//                   Reopen Census
//                 </Button>
//                 <Button size="sm" variant="solid" color="primary" sx={{width: '100%'}}>
//                   Start New Census
//                 </Button>
//               </Box>
//             ) : (
//               <Box sx={{
//                 display: 'flex',
//                 justifyContent: 'center',
//                 alignItems: 'center',
//                 flexDirection: 'column',
//                 width: '100%'
//               }}>
//                 <Button disabled={census === undefined} size="sm" variant="solid" color="danger"
//                         onClick={() => setOpenCloseCensusModal(true)} sx={{width: '100%'}}>
//                   Close Census
//                 </Button>
//               </Box>
//             )}
//           </Box>
//           <Divider orientation={"horizontal"} sx={{mb: 2, mt: 2}}/>
//           <LoginLogout/>
//           <Modal open={openSiteSelectionModal} onClose={() => {
//             setSite(currentSite);
//             setOpenSiteSelectionModal(false);
//           }}>
//             <ModalDialog variant="outlined" role="alertdialog" className="site-selection-modal-2">
//               <DialogTitle>
//                 <WarningRoundedIcon/>
//                 Site Selection
//               </DialogTitle>
//               <Divider/>
//               <DialogContent sx={{width: 750}}>
//                 <Box sx={{display: 'inline-block', alignItems: 'center'}} ref={containerRef}>
//                   <Stack direction={"column"} spacing={2}>
//                     <Typography level={"title-sm"}>Select Site:</Typography>
//                     {renderSiteOptions()}
//                   </Stack>
//                 </Box>
//               </DialogContent>
//               <DialogActions>
//                 <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
//                   <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
//                     setSite(currentSite);
//                     setOpenSiteSelectionModal(false);
//                     if (site) setIsInitialSiteSelectionRequired(false);
//                     else setIsInitialSiteSelectionRequired(true);
//                   }}>
//                     Cancel
//                   </Button>
//                   <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
//                     await handleSiteSelection(site);
//                     setOpenSiteSelectionModal(false);
//                     if (site) setIsInitialSiteSelectionRequired(false);
//                     else setIsInitialSiteSelectionRequired(true);
//                   }}>
//                     Submit
//                   </Button>
//                 </Stack>
//               </DialogActions>
//             </ModalDialog>
//           </Modal>
//           <Modal open={openPlotSelectionModal} onClose={() => {
//             setPlot(currentPlot);
//             setOpenPlotSelectionModal(false);
//           }}>
//             <ModalDialog variant="outlined" role="alertdialog" className="plot-selection-modal-7">
//               <DialogTitle>
//                 <WarningRoundedIcon/>
//                 Plot Selection
//               </DialogTitle>
//               <Divider/>
//               <DialogContent sx={{width: 750}}>
//                 <Box sx={{display: 'inline-block', alignItems: 'center'}} ref={containerRef}>
//                   <Stack direction={"column"} spacing={2}>
//                     <Typography level={"title-sm"}>Select Plot:</Typography>
//                     <Select
//                       placeholder="Select a Plot"
//                       className="plot-selection-select-8"
//                       name="None"
//                       required
//                       autoFocus
//                       size={"md"}
//                       renderValue={renderPlotValue}
//                       onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
//                         const selectedPlot = plotListContext?.find(plot => plot?.plotName === newValue) || undefined;
//                         setPlot(selectedPlot);
//                       }}
//                     >
//                       <Option value={""}>None</Option>
//                       {plotListContext?.map((item) => (
//                         <Option value={item?.plotName} key={item?.plotName}>
//                           <Box sx={{
//                             display: "flex",
//                             justifyContent: "space-between",
//                             alignItems: "center",
//                             width: "100%"
//                           }}>
//                             <Box sx={{display: "flex", flexDirection: "column", alignItems: "flex-start"}}>
//                               <Typography level="body-lg">{item?.plotName}</Typography>
//                               <Typography level="body-md" color={"primary"} sx={{paddingLeft: "1em"}}>
//                                 Quadrats: {item?.numQuadrats}
//                               </Typography>
//                               <Typography level="body-md" color={"primary"} sx={{paddingLeft: "1em"}}>
//                                 ID: {item?.plotID}
//                               </Typography>
//                             </Box>
//                           </Box>
//                         </Option>
//                       ))}
//                     </Select>
//                   </Stack>
//                 </Box>
//               </DialogContent>
//               <DialogActions>
//                 <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
//                   <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
//                     setPlot(currentPlot);
//                     setOpenPlotSelectionModal(false);
//                     if (plot) setIsPlotSelectionRequired(false);
//                     else setIsPlotSelectionRequired(true);
//                   }}>
//                     Cancel
//                   </Button>
//                   <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
//                     await handlePlotSelection(plot);
//                     setOpenPlotSelectionModal(false);
//                     if (plot) setIsPlotSelectionRequired(false);
//                     else setIsPlotSelectionRequired(true);
//                   }}>
//                     Submit
//                   </Button>
//                 </Stack>
//               </DialogActions>
//             </ModalDialog>
//           </Modal>
//           <Modal open={openCensusSelectionModal} onClose={() => {
//             setCensus(currentCensus);
//             setOpenCensusSelectionModal(false);
//           }}>
//             <ModalDialog variant="outlined" role="alertdialog" className="census-selection-modal-13">
//               <DialogTitle>
//                 <WarningRoundedIcon/>
//                 Census Selection
//               </DialogTitle>
//               <Divider/>
//               <DialogContent sx={{width: 750}}>
//                 <Stack direction={"column"} spacing={2}>
//                   <Stack direction="column">
//                     <Typography level={"title-lg"}>Select Census:</Typography>
//                     <Typography level="body-xs" color='primary'>Key: Start date &lt;===&gt; End date</Typography>
//                   </Stack>
//                   <Select
//                     placeholder="Select a Census"
//                     className="census-select-14"
//                     name="None"
//                     required
//                     autoFocus
//                     size={"md"}
//                     renderValue={renderCensusValue}
//                     onChange={async (_event: React.SyntheticEvent | null, selectedPlotCensusNumberStr: string | null) => {
//                       if (selectedPlotCensusNumberStr === '' || selectedPlotCensusNumberStr === null) await handleCensusSelection(undefined);
//                       else {
//                         const selectedPlotCensusNumber = parseInt(selectedPlotCensusNumberStr, 10);
//                         const selectedCensus = censusListContext?.find(census => census?.plotCensusNumber === selectedPlotCensusNumber) || undefined;
//                         setCensus(selectedCensus);
//                       }
//                     }}
//                   >
//                     <List>
//                       <Option value={""}>None</Option>
//                       <Divider orientation={"horizontal"}/>
//                       {censusListContext?.sort((a, b) => (b?.plotCensusNumber ?? 0) - (a?.plotCensusNumber ?? 0)).map((item) => (
//                         <Option key={item?.plotCensusNumber} value={item?.plotCensusNumber?.toString()}>
//                           <Box sx={{
//                             display: "flex",
//                             justifyContent: "space-between",
//                             alignItems: "center",
//                             width: "100%"
//                           }}>
//                             <Box sx={{display: "flex", flexDirection: "column", alignItems: "flex-start"}}>
//                               <Typography level="body-lg">Census: {item?.plotCensusNumber}</Typography>
//                               {item?.dateRanges?.map((dateRange, index) => (
//                                 <React.Fragment key={index}>
//                                   <Stack direction={"row"}>
//                                     <Typography level="body-sm" color={"neutral"} sx={{paddingLeft: '1em'}}>
//                                       {`${dateRange.startDate ? new Date(dateRange.startDate).toDateString() : 'undefined'}`}
//                                     </Typography>
//                                     <Typography level="body-sm" color={"neutral"}
//                                                 sx={{paddingLeft: '1em', paddingRight: '1em'}}>
//                                       &lt;===&gt;
//                                     </Typography>
//                                     <Typography level="body-sm" color={"neutral"}>
//                                       {`${dateRange.endDate ? new Date(dateRange.endDate).toDateString() : 'Ongoing'}`}
//                                     </Typography>
//                                   </Stack>
//                                 </React.Fragment>
//                               ))}
//                             </Box>
//                           </Box>
//                         </Option>
//                       ))}
//                     </List>
//                   </Select>
//                 </Stack>
//               </DialogContent>
//               <DialogActions>
//                 <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
//                   <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
//                     setCensus(currentCensus);
//                     if (census) setIsCensusSelectionRequired(false);
//                     else setIsCensusSelectionRequired(true);
//                     setOpenCensusSelectionModal(false);
//                   }}>
//                     Cancel
//                   </Button>
//                   <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
//                     await handleCensusSelection(census);
//                     setOpenCensusSelectionModal(false);
//                     if (census) setIsCensusSelectionRequired(false);
//                     else setIsCensusSelectionRequired(true);
//                   }}>
//                     Submit
//                   </Button>
//                 </Stack>
//               </DialogActions>
//             </ModalDialog>
//           </Modal>
//           <Modal open={openReopenCensusModal} onClose={() => setOpenReopenCensusModal(false)}>
//             <ModalDialog variant="outlined" role="alertdialog">
//               <DialogTitle>
//                 <WarningRoundedIcon/>
//                 Reopen Census
//               </DialogTitle>
//               <Divider/>
//               <DialogContent>
//                 <Stack direction={"column"} spacing={2}>
//                   <Typography level={"title-sm"}>Select a start date for the new census:</Typography>
//                   <input type="date" onChange={(e) => setReopenStartDate(new Date(e.target.value))}/>
//                 </Stack>
//               </DialogContent>
//               <DialogActions>
//                 <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
//                   <Button size={"sm"} color={"danger"} variant="soft" onClick={() => setOpenReopenCensusModal(false)}>
//                     Cancel
//                   </Button>
//                   <Button size={"sm"} variant={"soft"} color="success" onClick={handleReopenCensus}>
//                     Submit
//                   </Button>
//                 </Stack>
//               </DialogActions>
//             </ModalDialog>
//           </Modal>
//           <Modal open={openCloseCensusModal} onClose={() => setOpenCloseCensusModal(false)}>
//             <ModalDialog variant="outlined" role="alertdialog">
//               <DialogTitle>
//                 <WarningRoundedIcon/>
//                 Close Census
//               </DialogTitle>
//               <Divider/>
//               <DialogContent>
//                 <Stack direction={"column"} spacing={2}>
//                   <Typography level={"title-sm"}>Select an end date for the current census:</Typography>
//                   <input type="date" onChange={(e) => setCloseEndDate(new Date(e.target.value))}/>
//                 </Stack>
//               </DialogContent>
//               <DialogActions>
//                 <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"}/>}>
//                   <Button size={"sm"} color={"danger"} variant="soft" onClick={() => setOpenCloseCensusModal(false)}>
//                     Cancel
//                   </Button>
//                   <Button size={"sm"} variant={"soft"} color="success" onClick={handleCloseCensus}>
//                     Submit
//                   </Button>
//                 </Stack>
//               </DialogActions>
//             </ModalDialog>
//           </Modal>
//         </Box>
//       </Stack>
//     </>
//   );
// }
