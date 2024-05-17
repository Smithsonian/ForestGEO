"use client";
import * as React from 'react';
import { Dispatch, SetStateAction, useEffect, useState } from 'react';
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
import { Plot, PlotRDS } from "@/config/sqlrdsdefinitions/tables/plotrds";
import {
  useCensusContext,
  useCensusDispatch,
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
  Link,
  Modal,
  ModalDialog,
  SelectOption,
  Stack,
  Input,
  FormControl,
  FormLabel,
  ListSubheader,
  Grid,
  Textarea,
  IconButton,
  FormHelperText,
  Badge,
  Tooltip,
} from "@mui/joy";
import WarningRoundedIcon from "@mui/icons-material/WarningRounded";
import Select from "@mui/joy/Select";
import Option from '@mui/joy/Option';
import { useCensusListContext, usePlotListContext, useSiteListContext } from "@/app/contexts/listselectionprovider";
import { useCensusLoadContext, usePlotsLoadContext } from "@/app/contexts/coredataprovider";
import { Census, CensusRDS, CensusRaw } from '@/config/sqlrdsdefinitions/tables/censusrds';
import { getData } from "@/config/db";
import { useSession } from "next-auth/react";
import { SlideToggle, TransitionComponent } from "@/components/client/clientmacros";
import ListDivider from "@mui/joy/ListDivider";
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import Avatar from "@mui/joy/Avatar";
import { CensusLogo, DeleteIcon, EditIcon, PlotLogo } from "@/components/icons";
import { RainbowIcon } from '@/styles/rainbowicon';
import { DatePicker } from '@mui/x-date-pickers';
import dayjs from 'dayjs';
import StopIcon from '@mui/icons-material/Stop';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useDataValidityContext } from '@/app/contexts/datavalidityprovider';

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

function MenuRenderToggle(props: MRTProps, siteConfigProps: SiteConfigProps, menuOpen: boolean | undefined, setMenuOpen: Dispatch<SetStateAction<boolean>> | undefined) {
  const Icon = siteConfigProps.icon;
  const { plotSelectionRequired, censusSelectionRequired, pathname, isParentDataIncomplete } = props;
  let currentSite = useSiteContext();
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
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
  setManualReset: Dispatch<SetStateAction<boolean>>;
}

export default function Sidebar(props: SidebarProps) {
  const { data: session } = useSession();
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
  let plotsLoadContext = usePlotsLoadContext();
  const {validity} = useDataValidityContext();

  const [plot, setPlot] = useState<Plot>(currentPlot);
  const initialPlot: PlotRDS = {
    id: 0,
    plotID: 0,
    plotName: '',
    locationName: '',
    countryName: '',
    dimensionX: 0,
    dimensionY: 0,
    area: 0,
    globalX: 0,
    globalY: 0,
    globalZ: 0,
    unit: '',
    plotShape: '',
    plotDescription: ''
  };
  const initialCensus: CensusRDS = {
    id: 0,
    censusID: 0,
    startDate: null,
    endDate: null,
    description: '',
    plotCensusNumber: 0,
    plotID: currentPlot?.id ?? 0,
  };
  const [newPlotRDS, setNewPlotRDS] = useState<PlotRDS>(initialPlot);
  const [newCensusRDS, setNewCensusRDS] = useState<CensusRDS>(initialCensus);
  const [census, setCensus] = useState<CensusRDS>(currentCensus);
  const [site, setSite] = useState<Site>(currentSite);
  const [openPlotSelectionModal, setOpenPlotSelectionModal] = useState(false);
  const [openCensusSelectionModal, setOpenCensusSelectionModal] = useState(false);
  const [openSiteSelectionModal, setOpenSiteSelectionModal] = useState(false);
  const [showPlotModForm, setShowPlotModForm] = useState(false);
  const [showCensusModForm, setShowCensusModForm] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const containerRef = React.useRef<HTMLElement>(null);

  const [measurementsToggle, setMeasurementsToggle] = useState(false);
  const [propertiesToggle, setPropertiesToggle] = useState(false);
  const [formsToggle, setFormsToggle] = useState(false);

  const [storedPlot, setStoredPlot] = useState<Plot>(null);
  const [storedCensus, setStoredCensus] = useState<CensusRDS>(null);
  const [storedSite, setStoredSite] = useState<Site>(null);

  const [isInitialSiteSelectionRequired, setIsInitialSiteSelectionRequired] = useState(true);
  // Additional states for plot and census selection requirements
  const [isPlotSelectionRequired, setIsPlotSelectionRequired] = useState(true);
  const [isCensusSelectionRequired, setIsCensusSelectionRequired] = useState(true);

  const { coreDataLoaded, setManualReset, siteListLoaded} = props;

  const [plotModalMode, setPlotModalMode] = useState<'add' | 'edit'>('add');
  const [censusModalMode, setCensusModalMode] = useState<'add' | 'edit'>('add');
  const [plotMarkedForDeletion, setPlotMarkedForDeletion] = useState<PlotRDS>(initialPlot);
  const [openPlotDeletionConfirmDialog, setOpenPlotDeletionConfirmDialog] = useState(false);
  const [openCensusCloseModal, setOpenCensusCloseModal] = useState(false);
  const [censusMarkedForUpdate, setCensusMarkedForUpdate] = useState<CensusRDS>(null);
  const [censusMFUType, setCensusMFUType] = useState<'open' | 'close'>('open');
  
  const getSortedCensusData = () => {
    // Ensure censusListContext is defined before processing
    if (!censusListContext || !Array.isArray(censusListContext)) {
      console.error('Invalid census data. Please check the data source.');
      return []; // Return an empty array or appropriate fallback
    }

    // Separate the ongoing census (those with `endDate` equal to `null`)
    const sortedCensusList = censusListContext.filter(c => c.endDate === null);
    // Filter out completed (historical) censuses
    const historicalCensuses = censusListContext.filter(c => c.endDate !== null);

    // Sort the historical censuses chronologically by `startDate`
    const sortedHistoricalCensuses = historicalCensuses.sort((a, b) => {
      // Convert `startDate` to Date objects if not already
      const dateA = new Date(a.startDate);
      const dateB = new Date(b.startDate);

      // Compare by time value (earliest first)
      return dateA.getTime() - dateB.getTime();
    });

    // Combine the ongoing census at the top and the sorted historical censuses after
    return [...sortedCensusList, ...sortedHistoricalCensuses];
  };

  const sortedCensusList = getSortedCensusData();
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
      await siteDispatch({ site: selectedSite });
    }
    if (selectedSite === null) { // site's been reset, plot needs to be voided
      await handlePlotSelection(null);
    }
  };

  // Function to calculate the area based on dimensionX and dimensionY
  const calculateArea = (dimensionX: number, dimensionY: number): number => {
    return dimensionX * dimensionY;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === '-' || e.key === 'e') {
      e.preventDefault();
    }
  };

  // Handle changes in input and update the area when dimension changes
  // value has been clamped to ensure negative numbers are not inserted
  const handlePlotInputChange = (prop: keyof PlotRDS, value: string | number) => {
    if (typeof value === 'number') {
      // Clamp the value to ensure it's positive
      value = Math.max(value, 0);
      setNewPlotRDS(prev => {
        const updated = { ...prev, [prop]: value };
        // Automatically calculate and update the area if dimensions change
        if ((prop === 'dimensionX' || prop === 'dimensionY') && typeof value === 'number') {
          updated.area = calculateArea(
            prop === 'dimensionX' ? value : prev.dimensionX!,
            prop === 'dimensionY' ? value : prev.dimensionY!
          );
        }
        return updated;
      });
    } else {
      setNewPlotRDS(prev => ({
        ...prev,
        [prop]: value
      }));
    }
  };

  const handleCensusInputChange = (prop: keyof CensusRaw, value: any) => {
    setNewCensusRDS(prev => {
      let updatedValue = value;

      // Ensure that the starting date is before the ending date
      if (prop === 'startDate') {
        updatedValue = value !== null ? value : prev![prop];
        if (dayjs(updatedValue).isAfter(dayjs(prev?.endDate))) {
          // Automatically adjust end date if needed
          updatedValue = prev?.endDate;
        }
      }

      // Ensure that the ending date is after the starting date
      if (prop === 'endDate') {
        updatedValue = value !== null ? value : prev![prop];
        if (dayjs(updatedValue).isBefore(dayjs(prev?.startDate))) {
          // Automatically adjust start date if needed
          updatedValue = prev?.startDate;
        }
      }

      return {
        ...prev!,
        [prop]: updatedValue
      };
    });
  };

  // When adding a new plot
  const openAddPlotModal = () => {
    setNewPlotRDS(initialPlot); // Reset form or set to defaults
    setPlotModalMode('add');
    setShowPlotModForm(true);
  };

  const openEditPlotModal = (plot: Plot) => {
    let searchedPlot = plotsLoadContext?.find(item => item.plotID === plot?.id);
    if (!searchedPlot) throw new Error("could not find plotRDS object from plot");
    setNewPlotRDS(searchedPlot);
    setPlotModalMode('edit');
    setShowPlotModForm(true);
  };

  const handleSubmitPlot = async () => {
    const url = `/api/fixeddata/plots/${currentSite?.schemaName}/plotID`;
    const method = plotModalMode === 'add' ? 'POST' : 'PATCH';

    let response = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldRow: undefined, newRow: newPlotRDS })
    });

    if (response.ok) {
      setManualReset(true); // Reload data
      setOpenPlotSelectionModal(false); // Close modal
      setShowPlotModForm(false); // Reset the form state
      setNewPlotRDS(initialPlot); // Clear the form
    } else {
      alert('Failed to process the plot. Please try again.');
    }
  };

  const handleDeletePlot = async (plot: PlotRDS) => {
    const response = await fetch(`/api/fixeddata/plots/${currentSite?.schemaName}/plotID`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldRow: undefined, newRow: plot })
    });
    if (response.ok) {
      setManualReset(true);  // Reload data to reflect deletion
      setOpenPlotSelectionModal(false);  // Close the plot selection modal
    } else {
      alert('Failed to delete the plot. Please try again.');
    }
  };

  const openAddCensusModal = () => {
    setNewCensusRDS(initialCensus);
    setCensusModalMode('add');
    setShowCensusModForm(true);
  };

  const openEditCensusModal = (tempCensus: Census) => {
    const filteredCensus = censusLoadContext?.filter(census => census?.plotCensusNumber === tempCensus?.plotCensusNumber)
      .sort((a, b) => (b?.startDate?.getTime() ?? 0) - (a?.startDate?.getTime() ?? 0));
    // Update the context with the most recent census
    const mostRecentCensusRDS = filteredCensus?.[0] ?? null;
    setNewCensusRDS(mostRecentCensusRDS);
  };

  const handleSubmitCensus = async () => {
    if (newCensusRDS?.plotID === 0) {
      alert('Please ensure the plotID is correctly set and not zero.');
      return;
    }

    let response;
    const url = `/api/fixeddata/census/${currentSite?.schemaName}/censusID`;

    // Check if we are adding a new census
    if (censusModalMode === 'add') {
      // Find the highest plotCensusNumber for the current plot in the loaded context
      const plotCensuses = censusLoadContext?.filter(census => census?.plotID === currentPlot?.id) || [];
      let highestPlotCensusNumber = plotCensuses.reduce(
        (max, census) => (census?.plotCensusNumber! > max ? census?.plotCensusNumber! : max),
        0
      );

      // Create a new census with an incremented plotCensusNumber
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldRow: undefined,
          newRow: {
            ...newCensusRDS,
            plotCensusNumber: highestPlotCensusNumber + 1,
          }
        })
      });
    } else {
      // Handle closing the census
      response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldRow: undefined, newRow: newCensusRDS })
      });
    }

    if (response.ok) {
      setOpenCensusSelectionModal(false);
      setShowCensusModForm(false);
      setNewCensusRDS(initialCensus);
      setManualReset(true);
    } else {
      alert('Failed to process the census. Please try again');
    }
  };

  // Handle plot selection
  const handlePlotSelection = async (selectedPlot: Plot | null) => {
    setPlot(selectedPlot);
    if (plotDispatch) {
      await plotDispatch({ plot: selectedPlot });
    }
    if (selectedPlot === null) {
      await handleCensusSelection(null); // if plot's reset, then census needs to be voided too
    }
  };

  // Handle census selection
  const handleCensusSelection = async (selectedCensus: CensusRDS | null) => {
    setCensus(selectedCensus);
    if (censusDispatch) {
      await censusDispatch({ census: selectedCensus });
    }
  };

  // Saved session loading is modified to focus on Plot and Census only
  const handleResumeSession = async () => {
    storedSite ? await handleSiteSelection(storedSite) : undefined;
    storedPlot ? await handlePlotSelection(storedPlot) : undefined;
    storedCensus ? await handleCensusSelection(storedCensus) : undefined;
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

  const renderPlotForm = () => {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <DialogTitle>{plotModalMode === 'add' ? 'Add New Plot' : 'Edit Plot'}</DialogTitle>
        <form noValidate autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Grid container spacing={2} sx={{ flexGrow: 1 }}>
            {/* Left Column: Plot and Location Information */}
            <Grid xs={4}>
              <Grid container spacing={2} sx={{ flex: 1 }} direction={"column"}>
                <Grid xs={4}>
                  <FormControl required sx={{ marginBottom: '8px', width: '100%' }}>
                    <FormLabel>Plot Name</FormLabel>
                    <Input
                      type="text"
                      value={newPlotRDS.plotName!}
                      onChange={(e) => handlePlotInputChange('plotName', e.target.value)}
                    />
                  </FormControl>
                </Grid>
                <Grid xs={4}>
                  <FormControl sx={{ marginBottom: '8px', width: '100%' }}>
                    <FormLabel>Location Name</FormLabel>
                    <Input
                      type="text"
                      value={newPlotRDS.locationName!}
                      onChange={(e) => handlePlotInputChange('locationName', e.target.value)}
                    />
                  </FormControl>
                </Grid>
                <Grid xs={4}>
                  <FormControl sx={{ marginBottom: '8px', width: '100%' }}>
                    <FormLabel>Country Name</FormLabel>
                    <Input
                      type="text"
                      value={newPlotRDS.countryName!}
                      onChange={(e) => handlePlotInputChange('countryName', e.target.value)}
                    />
                  </FormControl>
                </Grid>
              </Grid>
            </Grid>

            {/* Middle Column: Dimensions and Coordinates */}
            <Grid xs={4}>
              <Grid container spacing={2} sx={{ flexGrow: 1 }}>
                <Grid xs={6}>
                  <FormControl sx={{ marginBottom: '8px', width: '100%' }} error={newPlotRDS.dimensionX! <= 0}>
                    <FormLabel>Dimension X</FormLabel>
                    <Input
                      type="number"
                      value={newPlotRDS.dimensionX!}
                      onKeyDown={handleKeyDown}
                      onChange={(e) => handlePlotInputChange('dimensionX', Number(e.target.value))}
                    />
                    {newPlotRDS.dimensionX! <= 0 && (
                      <FormHelperText>Value must be greater than 0!</FormHelperText>
                    )}
                  </FormControl>
                </Grid>
                <Grid xs={6}>
                  <FormControl sx={{ marginBottom: '8px', width: '100%' }} error={newPlotRDS.dimensionY! <= 0}>
                    <FormLabel>Dimension Y</FormLabel>
                    <Input
                      type="number"
                      value={newPlotRDS.dimensionY!}
                      onKeyDown={handleKeyDown}
                      onChange={(e) => handlePlotInputChange('dimensionY', Number(e.target.value))}
                    />
                    {newPlotRDS.dimensionY! <= 0 && (
                      <FormHelperText>Value must be greater than 0!</FormHelperText>
                    )}
                  </FormControl>
                </Grid>
              </Grid>
            </Grid>

            {/* Right Column: Other Fields */}
            <Grid xs={4}>
              <Grid container spacing={2} sx={{ flexGrow: 1 }}>
                <Grid xs={4}>
                  <FormControl sx={{ marginBottom: '8px', width: '100%' }}>
                    <FormLabel>Unit</FormLabel>
                    <Select
                      value={newPlotRDS.unit!}
                      onChange={(_event: React.SyntheticEvent | null,
                        newValue: string | null,) => handlePlotInputChange('unit', newValue ?? '')}
                      defaultValue={'m'}
                      placeholder="Select unit"
                      sx={{ minWidth: '200px' }}
                    >
                      <List>
                        <ListSubheader>Metric Units</ListSubheader>
                        <Option value="km">Kilometers (km)</Option>
                        <Option value="m">Meters (m)</Option>
                        <Option value="cm">Centimeters (cm)</Option>
                        <Option value="mm">Millimeters (mm)</Option>
                      </List>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid xs={4}>
                  <FormControl sx={{ marginBottom: '8px', width: '100%' }}>
                    <FormLabel>Plot Shape</FormLabel>
                    <Input
                      type="text"
                      value={newPlotRDS.plotShape!}
                      onChange={(e) => handlePlotInputChange('plotShape', e.target.value)}
                    />
                  </FormControl>
                </Grid>
                <Grid xs={4}>
                  <FormControl sx={{ width: '100%' }}>
                    <FormLabel>Area</FormLabel>
                    <Input type="text" disabled value={newPlotRDS.area!} />
                  </FormControl>
                </Grid>
              </Grid>
            </Grid>
          </Grid>
          <Stack direction={"row"}>
            <FormControl sx={{ marginRight: '8px', width: '100%' }} error={newPlotRDS.globalX! <= 0}>
              <FormLabel>Global X</FormLabel>
              <Input
                type="number"
                value={newPlotRDS.globalX!}
                onKeyDown={handleKeyDown}
                onChange={(e) => handlePlotInputChange('globalX', Number(e.target.value))}
              />
              {newPlotRDS.globalX! <= 0 && (
                <FormHelperText>Value must be greater than 0!</FormHelperText>
              )}
            </FormControl>
            <FormControl sx={{ marginRight: '8px', width: '100%' }} error={newPlotRDS.globalY! <= 0}>
              <FormLabel>Global Y</FormLabel>
              <Input
                type="number"
                value={newPlotRDS.globalY!}
                onKeyDown={handleKeyDown}
                onChange={(e) => handlePlotInputChange('globalY', Number(e.target.value))}
              />
              {newPlotRDS.globalY! <= 0 && (
                <FormHelperText>Value must be greater than 0!</FormHelperText>
              )}
            </FormControl>
            <FormControl sx={{ marginRight: '8px', width: '100%' }} error={newPlotRDS.globalZ! <= 0}>
              <FormLabel>Global Z</FormLabel>
              <Input
                type="number"
                value={newPlotRDS.globalZ!}
                onKeyDown={handleKeyDown}
                onChange={(e) => handlePlotInputChange('globalZ', Number(e.target.value))}
              />
              {newPlotRDS.globalZ! <= 0 && (
                <FormHelperText>Value must be greater than 0!</FormHelperText>
              )}
            </FormControl>
          </Stack>
          <Divider orientation='horizontal' sx={{ marginTop: 1 }} />
          {/* Plot Description */}
          <FormControl sx={{ marginTop: '16px', width: '100%' }}>
            <FormLabel>Plot Description</FormLabel>
            <Textarea
              name="soft"
              minRows={4}
              value={newPlotRDS.plotDescription!}
              onChange={(e) => handlePlotInputChange('plotDescription', e.target.value)}
            />
          </FormControl>
        </form>
      </Box>
    );
  };


  const renderCensusForm = () => {
    const isPlotIDValid = newCensusRDS?.plotID !== 0;
    const isEndDatePresent = !!newCensusRDS?.endDate;
    const isEndDateAfterStartDate = newCensusRDS?.startDate && newCensusRDS?.endDate
      ? dayjs(newCensusRDS.endDate).isAfter(dayjs(newCensusRDS.startDate))
      : true;

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <DialogTitle sx={{ marginBottom: 2 }}>Add New Census</DialogTitle>
        <form noValidate autoComplete="off" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Grid container spacing={1.5} sx={{ flexGrow: 1 }}>
            <Grid xs={6}>
              <Grid container spacing={1} direction="column" justifyContent="flex-start" alignItems="center">
                <Grid xs={6} sx={{ mb: 0.5 }}>
                  <FormControl required>
                    <FormLabel>Starting Date</FormLabel>
                    <DatePicker
                      label="Choose a starting Date"
                      value={dayjs(newCensusRDS?.startDate)}
                      onChange={(newValue) => handleCensusInputChange('startDate', newValue?.toDate())}
                      shouldDisableDate={(date) => dayjs(date).isAfter(dayjs(newCensusRDS?.endDate))}
                    />
                  </FormControl>
                </Grid>
                <Grid xs={6} sx={{ mb: 0.5 }}>
                  <FormControl>
                    <FormLabel>Description</FormLabel>
                    <Input
                      type="text"
                      value={newCensusRDS?.description!}
                      onChange={(e) => handleCensusInputChange('description', e.target.value)}
                    />
                  </FormControl>
                </Grid>
              </Grid>
            </Grid>
            <Grid xs={6}>
              <Grid container spacing={1} direction="column" justifyContent="flex-start" alignItems="center">
                <Grid xs={6} sx={{ mb: 0.5 }}>
                  <FormControl error={!isEndDateAfterStartDate}>
                    <FormLabel>Ending Date</FormLabel>
                    <DatePicker
                      label="Choose an ending Date (optional)"
                      value={newCensusRDS?.endDate ? dayjs(newCensusRDS.endDate) : null}
                      onChange={(newValue) => handleCensusInputChange('endDate', newValue?.toDate())}
                      shouldDisableDate={(date) => dayjs(date).isBefore(dayjs(newCensusRDS?.startDate))}
                    />
                    {!isEndDateAfterStartDate && (
                      <FormHelperText>
                        Error: Ending date must be after the starting date.
                      </FormHelperText>
                    )}
                    {!isEndDatePresent && isEndDateAfterStartDate && (
                      <FormHelperText>
                        Warning: You are creating an &quot;open&quot; census (no end date specified).
                      </FormHelperText>
                    )}
                  </FormControl>
                </Grid>
                <Grid xs={6} sx={{ mb: 0.5 }}>
                  <FormControl error={!isPlotIDValid}>
                    <FormLabel>PlotID</FormLabel>
                    <Input
                      disabled
                      type="number"
                      value={currentPlot?.id}
                      error={!isPlotIDValid}
                    />
                    {!isPlotIDValid && <FormHelperText>Error: Plot ID cannot be zero</FormHelperText>}
                  </FormControl>
                </Grid>
              </Grid>
            </Grid>
          </Grid>
        </form>
      </Box>
    );
  };

  type ToggleObject = {
    toggle?: boolean;
    setToggle?: Dispatch<SetStateAction<boolean>>;
  };

  // Define the array type
  type ToggleArray = ToggleObject[];
  const toggleArray: ToggleArray = [
    { toggle: undefined, setToggle: undefined },
    { toggle: measurementsToggle, setToggle: setMeasurementsToggle },
    { toggle: propertiesToggle, setToggle: setPropertiesToggle },
    { toggle: formsToggle, setToggle: setFormsToggle }
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
        <List aria-labelledby="allowed-sites-group" sx={{ '--ListItemDecorator-size': '28px' }}>
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

        <ListDivider role="none" />

        {/* Other Sites Group */}
        <List aria-labelledby="other-sites-group" sx={{ '--ListItemDecorator-size': '28px' }}>
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
    <Stack direction={"row"} sx={{ display: 'flex', width: 'fit-content' }}>
      {/*BASE SIDEBAR*/}
      <Box
        className="Sidebar"
        sx={{
          position: 'sticky',
          top: 0,
          left: 0,
          height: '100vh', // This makes the sidebar the full height of the viewport.
          width: 'calc(var(--Sidebar-width))',
          p: 2,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          borderRight: '1px solid',
          borderColor: 'divider',
          overflowY: 'auto' // This allows the sidebar to scroll independently of the page.
        }}
      >
        <GlobalStyles
          styles={(theme) => ({
            ':root': {
              '--Sidebar-width': '340px',
              [theme.breakpoints.up('lg')]: {
                '--Sidebar-width': '340px',
              },
            },
          })}
        />
        <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'left', flexDirection: 'column' }}>
            <Stack direction={"column"}>
              <Typography level="h1">
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Box sx={{ marginRight: 1.5 }}>
                    <RainbowIcon />
                  </Box>
                  ForestGEO
                </Box>
                {session?.user.isAdmin &&
                  <Typography level="h1" color='danger' sx={{ marginLeft: 0.5 }}>(Admin)</Typography>}
              </Typography>
            </Stack>
            <Divider orientation='horizontal' sx={{ my: 0.75 }} />
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
                <TravelExploreIcon />
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
                <PlotLogo />
              </Avatar>
              <Typography color={!currentPlot?.key ? "danger" : "success"}
                level="h3"
                sx={{ marginLeft: 1, display: 'flex', flexGrow: 1 }}>
                {currentPlot ? `Plot: ${currentPlot.key}` : "Select Plot"}
              </Typography>
            </Link>
            <SlideToggle
              isOpen={!isPlotSelectionRequired}>
              {/* This block will slide down when a plot is selected */}
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Link component={"button"} onClick={() => {
                  setOpenCensusSelectionModal(true);
                }}
                  sx={{ display: 'flex', alignItems: 'center', width: '100%', textAlign: 'left' }}>
                  <Avatar size={"sm"}>
                    <CensusLogo />
                  </Avatar>
                  <Typography color={(!currentCensus) ? "danger" : "success"}
                    level="h4"
                    sx={{ marginLeft: 1 }}>
                    {currentCensus ? `Census: ${currentCensus.plotCensusNumber}` : 'Select Census'}
                  </Typography>
                </Link>
                <Box
                  sx={{ marginLeft: '2.5em' }}> {/* Adjust marginLeft to match Avatar's width plus its marginLeft, mt for slight vertical adjustment */}
                  <Typography color={(!currentCensus) ? "danger" : "primary"}
                    level="body-md"
                    sx={{ textAlign: 'left', paddingLeft: '1em' }}>
                    {(currentCensus !== null) && (
                      <>{(currentCensus.startDate) ? `Starting: ${new Date(currentCensus?.startDate!).toDateString()}` : ''}</>
                    )}
                  </Typography>
                  <Typography color={(!currentCensus) ? "danger" : "primary"}
                    level="body-md"
                    sx={{ textAlign: 'left', paddingLeft: '1em' }}>

                    {(currentCensus !== null) && (
                      <>{(currentCensus.endDate) ? `Ending ${new Date(currentCensus.endDate).toDateString()}` : `Ongoing`}</>
                    )}
                  </Typography>
                </Box>
              </Box>
              <Divider orientation='horizontal' sx={{ marginTop: 2 }} />
              {/* Remaining Parts of Navigation Menu -- want this to be accessible from plot selection since not all links need census selection */}
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
                    // Calculate delay based on index (e.g., 100ms per item)
                    const delay = (index) * 200;

                    if (item.expanded.length === 0) {
                      return (
                        <TransitionComponent key={item.href} in={!isPlotSelectionRequired}
                          style={{ transitionDelay: `${delay}ms` }} direction="down">
                          <ListItem>
                            <ListItemButton selected={pathname === item.href}
                              disabled={isPlotSelectionRequired || isCensusSelectionRequired}
                              color={pathname === item.href ? 'primary' : undefined}
                              onClick={() => router.push(item.href)}>
                              <Icon />
                              <ListItemContent>
                                <Typography level={"title-sm"}>{item.label}</Typography>
                              </ListItemContent>
                            </ListItemButton>
                          </ListItem>
                        </TransitionComponent>
                      );
                    } else {
                      // Calculate the aggregate validity for subitems
                      let isParentDataIncomplete = item.expanded.some(subItem => {
                        const dataKey = validityMapping[subItem.href];
                        return dataKey !== undefined && !validity[dataKey];
                      });
                      return (
                        <TransitionComponent key={item.href} in={!isPlotSelectionRequired}
                          style={{ transitionDelay: `${delay}ms` }} direction="down">
                          <ListItem nested>
                            <SimpleToggler
                              renderToggle={MenuRenderToggle({
                                plotSelectionRequired: isPlotSelectionRequired,
                                censusSelectionRequired: isCensusSelectionRequired,
                                pathname, isParentDataIncomplete
                              }, item, toggle, setToggle)}
                              isOpen={!!toggle}
                            >
                              <List sx={{ gap: 0.75 }} size={"sm"}>
                                {item.expanded.map((link, subIndex) => {
                                  const SubIcon = link.icon;
                                  // Calculate delay based on index (e.g., 100ms per item)
                                  const delay = (subIndex + 1) * 200;
                                  let dataValidityKey = validityMapping[link.href];  // This should now be safely typed
                                  let isDataIncomplete = dataValidityKey ? !validity[dataValidityKey] : false;
                                  return (
                                    <TransitionComponent key={link.href} in={!!toggle}
                                      style={{ transitionDelay: `${delay}ms` }} direction="down">
                                      <ListItem sx={{ marginTop: 0.75 }}>
                                        <ListItemButton
                                          selected={pathname == (item.href + link.href)}
                                          disabled={isPlotSelectionRequired || isCensusSelectionRequired}
                                          onClick={() => router.push((item.href + link.href))}>
                                          <Badge
                                            color="danger"
                                            variant={isDataIncomplete ? 'solid' : 'soft'}
                                            badgeContent={isDataIncomplete ? '!' : undefined}
                                            invisible={!isDataIncomplete}
                                          >
                                            <SubIcon />
                                          </Badge>
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
        <Box sx={{ display: 'flex', alignItems: 'left', flexDirection: 'column' }}>
          <Divider orientation={"horizontal"} sx={{ mb: 2 }} />
          <LoginLogout />
        </Box>
        <Modal open={openSiteSelectionModal} onClose={() => {
          setSite(currentSite);
          setOpenSiteSelectionModal(false);
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon />
              Site Selection
            </DialogTitle>
            <Divider />
            <DialogContent sx={{ width: 750 }}>
              <Box sx={{ display: 'inline-block', alignItems: 'center' }} ref={containerRef}>
                <Stack direction={"column"} spacing={2}>
                  <Typography level={"title-sm"}>Select Site:</Typography>
                  {renderSiteOptions()}
                </Stack>
              </Box>
            </DialogContent>
            <DialogActions>
              <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
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
          setShowPlotModForm(false);  // Reset the form display state when closing the modal
          setOpenPlotSelectionModal(false);
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon />
              Plot Selection
            </DialogTitle>
            <Divider />
            <DialogContent sx={{ width: 750 }}>
              <Box sx={{ display: 'inline-block', alignItems: 'center' }} ref={containerRef}>
                {showPlotModForm ? (
                  <>{renderPlotForm()}</>
                ) : (
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
                          <Box sx={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            width: "100%"
                          }}>
                            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                              <Typography level="body-lg">{item?.key}</Typography>
                              <Typography level="body-md" color={"primary"} sx={{ paddingLeft: "1em" }}>
                                Quadrats: {item?.num}
                              </Typography>
                              <Typography level="body-md" color={"primary"} sx={{ paddingLeft: "1em" }}>
                                ID: {item?.id}
                              </Typography>
                            </Box>
                            <Box>
                              <IconButton sx={{ ml: "auto" }} onClick={(e) => {
                                e.stopPropagation();
                                openEditPlotModal(item);
                              }}>
                                <EditIcon />
                                Edit
                              </IconButton>
                              <IconButton sx={{ ml: "auto" }} onClick={(e) => {
                                e.stopPropagation(); // Prevents triggering the select's onChange
                                let searchedPlot = plotsLoadContext?.find(internal => internal.plotID === item?.id);
                                console.log(plotsLoadContext);
                                if (!searchedPlot) throw new Error("could not find plotRDS object from plot");
                                setPlotMarkedForDeletion(searchedPlot);
                                setOpenPlotDeletionConfirmDialog(true);
                              }}>
                                <DeleteIcon />
                                Delete
                              </IconButton>
                            </Box>
                          </Box>
                        </Option>
                      ))}
                    </Select>
                    <Button color="primary" variant="outlined" sx={{ alignSelf: 'flex-end' }} onClick={openAddPlotModal}>
                      Add New Plot
                    </Button>
                  </Stack>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              {!showPlotModForm ? (
                <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                  <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                    setPlot(currentPlot);
                    setOpenPlotSelectionModal(false);
                    setShowPlotModForm(false);
                    if (plot) setIsPlotSelectionRequired(false);
                    else setIsPlotSelectionRequired(true);
                  }}>
                    Cancel
                  </Button>
                  <Button size={"sm"} variant={"soft"} color="success" onClick={async () => {
                    await handlePlotSelection(plot);
                    setOpenPlotSelectionModal(false);
                    setShowPlotModForm(false);
                    if (plot) setIsPlotSelectionRequired(false);
                    else setIsPlotSelectionRequired(true);
                  }}>
                    Submit
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={2} divider={<Divider orientation='vertical' />}>
                  <Button variant="outlined" onClick={() => {
                    setShowPlotModForm(false);
                    setNewPlotRDS(initialPlot);
                  }}>Cancel</Button>
                  <Button onClick={handleSubmitPlot}>{plotModalMode === 'add' ? 'Add Plot' : 'Save Changes'}</Button>
                </Stack>
              )}
            </DialogActions>
          </ModalDialog>
        </Modal>
        <Modal open={openCensusSelectionModal} onClose={() => {
          setCensus(currentCensus);
          setOpenCensusSelectionModal(false);
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <WarningRoundedIcon />
              Census Selection
            </DialogTitle>
            <Divider />
            <DialogContent sx={{ width: 750 }}>
              <Box sx={{ display: 'inline-block', alignItems: 'center' }} ref={containerRef}>
                {showCensusModForm ? (
                  <>{renderCensusForm()}</>
                ) : (
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
                        <Divider orientation={"horizontal"} />
                        {sortedCensusList && sortedCensusList.length > 0 && (
                          sortedCensusList.map((item) => (
                            <Option key={item.plotCensusNumber} value={item.plotCensusNumber.toString()}>
                              <Box sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                width: "100%"
                              }}>
                                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                                  <Typography level="body-lg">Census: {item.plotCensusNumber}</Typography>
                                  <Typography level="body-md" color={"primary"} sx={{ paddingLeft: '1em' }}>
                                    {`Started: ${new Date(item.startDate).toDateString()}`}
                                  </Typography>
                                  {item.endDate && (
                                    <Typography level="body-md" color={"primary"} sx={{ paddingLeft: '1em' }}>
                                      {`Ended: ${new Date(item.endDate).toDateString()}`}
                                    </Typography>
                                  )}
                                </Box>
                                <Box>
                                  <IconButton sx={{ ml: "auto" }} onClick={(e) => {
                                    e.stopPropagation();
                                    // Filter and sort logic
                                    const filteredCensus = censusLoadContext?.filter(census => census?.plotCensusNumber === item.plotCensusNumber)
                                      .sort((a, b) => (b?.startDate?.getTime() ?? 0) - (a?.startDate?.getTime() ?? 0));
                                    // Update the context with the most recent census
                                    const mostRecentCensusRDS = filteredCensus?.[0] ?? null;
                                    setCensusMarkedForUpdate(mostRecentCensusRDS);
                                    setCensusMFUType(item.endDate ? 'open' : 'close');
                                    setOpenCensusCloseModal(true);
                                  }}>
                                    {item.endDate === null && (
                                      <>
                                        <StopIcon />
                                        Close Census
                                      </>
                                    )}
                                  </IconButton>
                                  <IconButton sx={{ ml: "auto" }} onClick={(e) => {
                                    e.stopPropagation();
                                    openEditCensusModal(item);
                                  }}>
                                    <EditIcon />
                                    Edit
                                  </IconButton>
                                  <IconButton sx={{ ml: "auto" }} onClick={(e) => {
                                    e.stopPropagation(); // Prevents triggering the select's onChange
                                    alert('Censuses cannot be deleted!');
                                  }}>
                                    <DeleteIcon />
                                    Delete
                                  </IconButton>
                                </Box>
                              </Box>
                            </Option>
                          ))
                        )}
                      </List>
                    </Select>
                    <Button color="primary" variant="outlined" sx={{ alignSelf: 'flex-end' }}
                      onClick={openAddCensusModal}>
                      Add New Census
                    </Button>
                  </Stack>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              {!showCensusModForm ? (
                <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                  <Button size={"sm"} color={"danger"} variant="soft" onClick={() => {
                    setCensus(currentCensus);
                    if (census) setIsCensusSelectionRequired(false);
                    else setIsCensusSelectionRequired(true);
                    setOpenCensusSelectionModal(false);
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
              ) : (
                <Stack direction="row" spacing={2} divider={<Divider orientation='vertical' />}>
                  <Button variant="outlined" onClick={() => {
                    setShowCensusModForm(false);
                    setNewCensusRDS(initialCensus);
                  }}>Cancel</Button>
                  <Button
                    onClick={handleSubmitCensus}>{censusModalMode === 'add' ? 'Add Census' : 'Save Changes'}</Button>
                </Stack>
              )}
            </DialogActions>
          </ModalDialog>
        </Modal>
        <Modal open={openPlotDeletionConfirmDialog} onClose={() => {
        }}>
          <ModalDialog variant="outlined" role="alertdialog">
            <DialogTitle>
              <Typography level='h3' color='danger'>Are you sure you want to delete this plot?</Typography>
            </DialogTitle>
            <DialogContent>
              <Typography level='body-lg' color='warning'>You are attempting to delete the following plot:</Typography>
              <Typography level='body-md'>Plot: {plotMarkedForDeletion?.plotName}</Typography>
              <Typography
                level='body-md'>Location: {plotMarkedForDeletion?.locationName}, {plotMarkedForDeletion?.countryName}</Typography>
              <Typography level='body-md'>Dimensions and
                Coordinates: {plotMarkedForDeletion?.dimensionX}x{plotMarkedForDeletion?.dimensionY},
                ({plotMarkedForDeletion?.globalX + ', ' + plotMarkedForDeletion?.globalY + ', ' + plotMarkedForDeletion?.globalZ})</Typography>
              <Divider orientation='horizontal' sx={{ marginY: 2 }} />
              <Typography level='body-lg' color='danger'>This action cannot be undone. Please click the Confirm button
                to continue
                , or the Cancel button to return to the Plot Selection Menu</Typography>
            </DialogContent>
            <DialogActions>
              <Stack direction={"row"} spacing={2} divider={<Divider orientation={"vertical"} />}>
                <Button size={"sm"} color={"warning"} variant="soft" onClick={() => {
                  setOpenPlotDeletionConfirmDialog(false);
                  setPlotMarkedForDeletion(initialPlot);
                }}>
                  Cancel
                </Button>
                <Button size={"sm"} variant={"soft"} color="danger" onClick={async () => {
                  setOpenPlotDeletionConfirmDialog(false);
                  setOpenPlotSelectionModal(false);
                  if (plotMarkedForDeletion === initialPlot) throw new Error("Plot marked for deletion is null for some reason?");
                  await handleDeletePlot(plotMarkedForDeletion);
                }}>
                  Confirm, Delete this Plot
                </Button>
              </Stack>
            </DialogActions>
          </ModalDialog>
        </Modal>
        <Modal open={openCensusCloseModal} onClose={() => {
        }}>
          <ModalDialog variant='outlined' role='alertdialog'>
            <DialogTitle>
              <Typography component={'div'} level='h3' color='danger'>Are you sure you want to close this
                census?</Typography>
            </DialogTitle>
            <DialogContent>
              <Typography level='body-lg' color='warning'>You are attempting to close the following
                census:</Typography>
              <Typography level='body-md'>Census: {censusMarkedForUpdate?.plotCensusNumber}</Typography>
              <Typography level='body-md'>Starting: {dayjs(censusMarkedForUpdate?.startDate).toString()}</Typography>
              <DatePicker
                label="Choose an ending date"
                value={censusMarkedForUpdate?.endDate ? dayjs(censusMarkedForUpdate.endDate) : null}
                onChange={(newValue) => {
                  setCensusMarkedForUpdate(prev => {
                    return {
                      ...prev!,
                      plotID: currentPlot?.id ?? 0,
                      endDate: newValue ? newValue.toDate() : null
                    };
                  });
                }}
                shouldDisableDate={(date) => dayjs(date).isBefore(dayjs(censusMarkedForUpdate?.startDate))}
              />
            </DialogContent>
            <DialogActions>
              <Stack direction="row" spacing={2} divider={<Divider orientation='vertical' />}>
                <Button variant="outlined" onClick={() => {
                  setOpenCensusCloseModal(false);
                  setCensusMarkedForUpdate(null);
                }}>Cancel</Button>
                <Button onClick={async () => {
                  const url = `/api/fixeddata/census/${currentSite?.schemaName}/censusID`;
                  let response = await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ oldRow: undefined, newRow: censusMarkedForUpdate })
                  });
                  if (response.ok) {
                    setOpenCensusCloseModal(false);
                    setOpenCensusSelectionModal(false);
                    setCensusMarkedForUpdate(null);
                    setManualReset(true);
                  } else {
                    alert('Failed to process the census. Please try again');
                  }
                  setCensusMarkedForUpdate(null);
                  setOpenCensusCloseModal(false);
                }}>Close Census</Button>
              </Stack>
            </DialogActions>
          </ModalDialog>
        </Modal>
      </Box>
    </Stack>
  );
}
