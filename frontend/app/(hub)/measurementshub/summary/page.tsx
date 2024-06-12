'use client';
import React, {useEffect, useState} from "react";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {Alert, AlertProps, LinearProgress, Tooltip, TooltipProps, styled, tooltipClasses} from "@mui/material";
import {gridColumnsArrayMSVRDS, initialMeasurementsSummaryViewRDSRow} from '@/config/sqlrdsdefinitions/views/measurementssummaryviewrds';
import {
  Box,
  ListItemContent,
  ListItem,
  List,
  Modal,
  ModalDialog,
  Typography,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Stack,
} from "@mui/joy";
import Select, {SelectOption} from "@mui/joy/Select";
import {useSession} from "next-auth/react";
import {
  useOrgCensusContext,
  usePlotContext,
  useQuadratDispatch,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";
import {useQuadratListContext} from "@/app/contexts/listselectionprovider";
import {Quadrat} from "@/config/sqlrdsdefinitions/tables/quadratrds";
import Option from '@mui/joy/Option';
import MeasurementSummaryGrid from "@/components/datagrids/msvdatagrid";
import {useDataValidityContext} from "@/app/contexts/datavalidityprovider";
import {UnifiedValidityFlags} from "@/config/macros";

const LargeTooltip = styled(({className, ...props}: TooltipProps) => (
  <Tooltip {...props} classes={{popper: className}}/>
))(({theme}) => ({
  [`& .${tooltipClasses.tooltip}`]: {
    fontSize: 16,
    maxWidth: 600, // Increase maxWidth to give more space for text
  },
}));

interface ChecklistProgress {
  progress: number;
  message: string;
  error?: string;
}

export default function SummaryPage() {
  const {data: session} = useSession();
  const [quadrat, setQuadrat] = useState<Quadrat>();
  const [quadratList, setQuadratList] = useState<Quadrat[] | undefined>([]);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const quadratListContext = useQuadratListContext();
  const quadratDispatch = useQuadratDispatch();
  const {validity, recheckValidityIfNeeded} = useDataValidityContext();
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [isUploadAllowed, setIsUploadAllowed] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [triggerGlobalError, setTriggerGlobalError] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  useEffect(() => {
    if (currentPlot) {
      // ensure that selectable list is restricted by selected plot
      setQuadratList(quadratListContext?.filter(quadrat => quadrat?.plotID === currentPlot.plotID) || undefined);
    }
  }, [currentPlot, quadratListContext]);

  const [rows, setRows] = React.useState([initialMeasurementsSummaryViewRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0); // total number of rows
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<AlertProps, 'children' | 'severity'> | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [useSubquadrats, setUseSubquadrats] = useState(currentPlot?.usesSubquadrats ?? false);

  useEffect(() => {
    const verifyPreconditions = async () => {
      setIsUploadAllowed(!Object.entries(validity).filter(item => item[0] !== 'subquadrats').map(item => item[1]).includes(false));
    };

    if (progressDialogOpen) {
      verifyPreconditions().catch(console.error);
    }
  }, [progressDialogOpen, validity]);

  const addNewRowToGrid = () => {
    const id = randomId();
    // Define new row structure based on MeasurementsSummaryRDS type
    const newRow = {
      ...initialMeasurementsSummaryViewRDSRow,
      id: id,
      coreMeasurementID: 0,
      plotID: currentPlot?.plotID,
      plotName: currentPlot?.plotName,
      censusID: currentCensus?.dateRanges[0].censusID,
      censusStartDate: currentCensus?.dateRanges[0]?.startDate,
      censusEndDate: currentCensus?.dateRanges[0]?.endDate,
      isNew: true,
    };
    setRows(oldRows => [...oldRows, newRow]);
    setRowModesModel(oldModel => ({...oldModel, [id]: {mode: GridRowModes.Edit}}));
  };

  const handleCloseGlobalError = () => {
    setGlobalError(null);
    setTriggerGlobalError(false);
  };

  const handleCloseProgressDialog = () => {
    setProgressDialogOpen(false);
    if (isUploadAllowed) {
      setTimeout(() => {
        setIsUploadModalOpen(true);
      }, 300);
    } else {
      setGlobalError('Missing prerequisites! Please upload supporting data before submitting measurements!');
      setTriggerGlobalError(true);
    }
  };

  const checklistItems: (keyof UnifiedValidityFlags)[] = ['attributes', 'species', 'personnel', 'quadrats'];

  const ProgressDialog = () => (
    <Modal
      open={progressDialogOpen}
      onClose={() => {
      }}
      sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}
    >
      <ModalDialog
        size="lg"
        sx={{width: '100%', maxHeight: '100vh', overflow: 'auto'}}
        role="alertdialog"
      >
        <DialogTitle>Pre-Validation Systems Check</DialogTitle>
        <DialogContent>
          <Typography level={'title-lg'}>Measurements Upload Warning:</Typography>
          <Typography level={'body-lg'}>
            In order to upload measurements, all of the following tables must be populated!
          </Typography>
          <List>
            {checklistItems.map((item) => {
              const isValid = validity[item];
              const progressData = isValid
                ? {
                  progress: 100,
                  message: `Passed: ${item.charAt(0).toUpperCase() + item.substring(1)}`,
                  error: undefined
                }
                : {
                  progress: 0,
                  message: `Failure: ${item.charAt(0).toUpperCase() + item.substring(1)}`,
                  error: `${item.charAt(0).toUpperCase() + item.substring(1)} is invalid or missing.`
                };
              const tooltipMessage = progressData.error
                ? `${progressData.error}`
                : progressData.message;

              return (
                <ListItem sx={{alignItems: 'center', display: 'flex', flexDirection: 'row'}} key={item}>
                  <ListItemContent sx={{minWidth: '160px', mr: 2, my: 'auto'}}>
                    <Typography level={'body-md'}>{progressData.message}</Typography>
                  </ListItemContent>
                  <LargeTooltip title={tooltipMessage} placement="top" arrow>
                    <Box sx={{width: '100%', maxWidth: 'calc(100% - 180px)', my: 'auto'}}>
                      <LinearProgress
                        variant="determinate"
                        value={progressData.progress}
                        color={isValid ? 'primary' : 'error'}
                        sx={{width: '100%', height: 8}}
                      />
                    </Box>
                  </LargeTooltip>
                </ListItem>
              );
            })}
          </List>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setProgressDialogOpen(false);
            }}
            color="primary"
          >
            Cancel
          </Button>
          <Button
            disabled={!isUploadAllowed}
            onClick={handleCloseProgressDialog}
            color={!isUploadAllowed ? 'danger' : 'success'}
          >
            {isUploadAllowed ? 'Continue to Upload' : 'Key Data Missing!'}
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );

  const renderQuadratValue = (option: SelectOption<string> | null) => {
    if (!option) {
      return <Typography>Select a Quadrat</Typography>; // or some placeholder JSX
    }

    // Find the corresponding Quadrat object
    const selectedValue = option.value; // assuming option has a 'value' property
    const selectedQuadrat = quadratListContext?.find(c => c?.quadratName === selectedValue);

    // Return JSX
    return selectedQuadrat ? <Typography>{`Quadrat: ${selectedQuadrat?.quadratName}`}</Typography> :
      <Typography>No Quadrat</Typography>;
  };

  const handleQuadratSelection = async (selectedQuadrat: Quadrat | undefined) => {
    setQuadrat(selectedQuadrat);
    if (quadratDispatch) {
      await quadratDispatch({quadrat: selectedQuadrat});
    }
  };

  const handleConfirmQuadrat = async () => {
    await handleQuadratSelection(quadrat);
  };

  const QuadratSelectionMenu = () => (
    <Stack direction="column" spacing={2} marginBottom={2}>
      <Typography level="title-sm">Select Quadrat:</Typography>
      <Select
        disabled={!validity['quadrats'] || !currentPlot?.usesSubquadrats}
        placeholder="Select a Quadrat"
        name="None"
        required
        autoFocus
        size="md"
        renderValue={renderQuadratValue}
        onChange={async (_event: React.SyntheticEvent | null, newValue: string | null) => {
          const selectedQuadrat = quadratList?.find(quadrat => quadrat?.quadratName === newValue) || undefined;
          setQuadrat(selectedQuadrat);
        }}
      >
        <Option value="">None</Option>
        {quadratList?.map((item) => (
          <Option value={item?.quadratName} key={item?.quadratName}>
            <Box sx={{display: 'flex', flexDirection: 'column', alignItems: 'flex-start'}}>
              <Typography level="body-lg">{item?.quadratName}</Typography>
            </Box>
          </Option>
        ))}
      </Select>
      <Button
        onClick={handleConfirmQuadrat}
        size="sm"
        color="primary"
        disabled={!currentPlot?.usesSubquadrats}
      >Confirm</Button>
      {!validity['quadrats'] && (
        <Alert severity="warning" sx={{mt: 2}}>
          <Typography level="body-lg" color="warning">No quadrats exist to be selected.</Typography>
        </Alert>
      )}
    </Stack>
  );

  useEffect(() => {
    const updateUseSubquadrats = async () => {
      const updatedPlot = {
        ...currentPlot,
        usesSubquadrats: useSubquadrats,
      };
      const response = await fetch(`/api/fixeddata/plots?schema=${currentSite?.schemaName ?? ''}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(updatedPlot)
      });
      if (!response.ok) setGlobalError('Toggling subquadrats usage failed!');
    };

    if (currentPlot?.usesSubquadrats !== useSubquadrats) {
      updateUseSubquadrats().catch(console.error);
    }
  }, [currentPlot, useSubquadrats]);

  return (
    <>
      {globalError && (
        <Snackbar open={triggerGlobalError} autoHideDuration={6000} onClose={handleCloseGlobalError}>
          <Alert onClose={handleCloseGlobalError} severity="error">{globalError}</Alert>
        </Snackbar>
      )}
      <Box sx={{display: 'flex', alignItems: 'center', mb: 3, width: '100%'}}>
        <ProgressDialog/>
        <Box sx={{
          width: '100%', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', backgroundColor: 'warning.main', borderRadius: '4px', p: 2
        }}>
          <Stack direction="column">
            <Box sx={{display: 'flex', flexDirection: 'column', flexGrow: 1}}>
              <Box sx={{flex: 1, display: 'flex', justifyContent: 'left', flexDirection: 'column', marginTop: 2}}>
                {currentPlot?.usesSubquadrats ? (
                  <Box sx={{display: 'flex', flexDirection: 'row'}}>
                    <Typography level={"title-md"} sx={{color: "#ffa726"}}>Note: This plot has been set to accept
                      subquadrats. <br/>
                      Please ensure you select a quadrat before proceeding.</Typography>
                    <QuadratSelectionMenu/>
                  </Box>
                ) : (
                  <Typography level={"title-md"} sx={{color: "#ffa726"}}>Note: This plot does not accept
                    subquadrats. <br/>
                    Please ensure that you use quadrat names when submitting new measurements instead of subquadrat
                    names</Typography>
                )}
                {session?.user.isAdmin ? (
                  <Stack direction="column">
                    {/* <Typography level={"title-lg"} sx={{color: "#ffa726"}}>Note: ADMINISTRATOR VIEW</Typography>
                    <Stack direction="row" spacing={4}>
                      <Typography level={"title-md"} sx={{color: "#ffa726"}}>Please use the toggle to change this
                        setting if it is incorrect</Typography>
                      <Switch
                        checked={useSubquadrats}
                        onChange={(event) => setUseSubquadrats(event.target.checked)}
                        color={useSubquadrats ? 'primary' : 'neutral'}
                        variant={useSubquadrats ? 'solid' : 'outlined'}
                        endDecorator={useSubquadrats ? 'Use subquadrats' : 'Use quadrats'}
                        slotProps={{
                          endDecorator: {
                            sx: {
                              minWidth: 24,
                            },
                          },
                        }}
                      />
                    </Stack> */}
                  </Stack>
                ) : (
                  <Typography level={"title-md"} sx={{color: "#ffa726"}}>If this setting is inaccurate, please contact
                    an administrator.</Typography>
                )}
              </Box>
            </Box>
          </Stack>
          <Box sx={{display: 'flex', alignItems: 'center', gap: 2}}>
            <Button onClick={() => setProgressDialogOpen(true)} variant="solid" color="primary">Upload</Button>
          </Box>
        </Box>
      </Box>
      <UploadParentModal
        isUploadModalOpen={isUploadModalOpen}
        handleCloseUploadModal={() => {
          setIsUploadModalOpen(false);
          setRefresh(true);
        }}
        formType={"measurements"}
      />
      <MeasurementSummaryGrid
        gridColumns={gridColumnsArrayMSVRDS[0]}
        rows={rows}
        setRows={setRows}
        rowCount={rowCount}
        setRowCount={setRowCount}
        rowModesModel={rowModesModel}
        setRowModesModel={setRowModesModel}
        snackbar={snackbar}
        setSnackbar={setSnackbar}
        refresh={refresh}
        setRefresh={setRefresh}
        paginationModel={paginationModel}
        setPaginationModel={setPaginationModel}
        isNewRowAdded={isNewRowAdded}
        setIsNewRowAdded={setIsNewRowAdded}
        shouldAddRowAfterFetch={shouldAddRowAfterFetch}
        setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
        addNewRowToGrid={addNewRowToGrid}
      />
    </>
  );
}