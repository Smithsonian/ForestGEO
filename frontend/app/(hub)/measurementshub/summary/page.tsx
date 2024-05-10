'use client';
import React, {useEffect, useState} from "react";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {Alert, AlertProps, LinearProgress, Tooltip, TooltipProps, styled, tooltipClasses} from "@mui/material";
import DataGridCommons from "@/components/datagridcommons";
import {MeasurementsSummaryGridColumns} from '@/config/sqlrdsdefinitions/views/measurementssummaryviewrds';
import {
  Box,
  IconButton,
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
} from "@mui/joy";
import {useSession} from "next-auth/react";
import {
  useCensusContext,
  usePlotContext,
  useSiteContext
} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";

const LargeTooltip = styled(({className, ...props}: TooltipProps) => (
  <Tooltip {...props} classes={{popper: className}}/>
))(({theme}) => ({
  [`& .${tooltipClasses.tooltip}`]: {
    fontSize: 16,
    maxWidth: 600,  // Increase maxWidth to give more space for text
  },
}));


interface ChecklistProgress {
  progress: number;
  message: string;
  error?: string;
}

interface ChecklistProgressMap {
  [key: string]: ChecklistProgress;
}

export default function SummaryPage() {
  const {data: session} = useSession();
  const initialRows: GridRowsProp = [
    {
      id: 0,
      coreMeasurementID: 0,
      plotID: 0,
      plotName: '',
      censusID: 0,
      censusStartDate: null,
      censusEndDate: null,
      quadratID: 0,
      quadratName: '',
      subquadratID: 0,
      subquadratName: '',
      treeID: 0,
      treeTag: '',
      stemID: 0,
      stemTag: '',
      stemLocalX: 0,
      stemLocalY: 0,
      stemUnits: '',
      personnelID: 0,
      personnelName: '',
      measurementDate: null,
      measuredDBH: 0,
      dbhUnits: '',
      measuredHOM: 0,
      homUnits: '',
      description: '',
      attributes: [],
    }
  ];
  const [rows, setRows] = React.useState(initialRows);
  const [rowCount, setRowCount] = useState(0);  // total number of rows
  const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [isUploadAllowed, setIsUploadAllowed] = useState(false);
  const [progressDialogOpen, setProgressDialogOpen] = useState(false);
  const [checklistProgress, setChecklistProgress] = useState<ChecklistProgressMap>({});
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [triggerGlobalError, setTriggerGlobalError] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  let currentPlot = usePlotContext();
  let currentCensus = useCensusContext();
  let currentSite = useSiteContext();

  useEffect(() => {
      const verifyPreconditions = async () => {
          const checklist = ['attributes', 'species', 'personnel', 'quadrats', 'subquadrats'];
          let allValid = true;

          for (const item of checklist) {
            const url = `/api/cmprevalidation/${item}/${currentSite?.schemaName}/${currentPlot?.id}/${currentCensus?.censusID}`;

            try {
              const response = await fetch(url, {method: 'GET'});
              if (!response.ok) {
                throw new Error(`Failed: ${response.statusText}`);
              }
              setChecklistProgress(prevState => ({
                ...prevState,
                [item]: {
                  progress: 100,
                  message: "Passed: " + item.charAt(0).toUpperCase() + item.substring(1),
                  error: undefined
                }
              }));
            } catch (err: any) {
              if (item === 'quadrats') {
                setChecklistProgress(prevState => ({
                  ...prevState,
                  [item]: {
                    progress: 100, // Ensure progress is 100% even on failure
                    message: "Failure: " + item.charAt(0).toUpperCase() + item.substring(1),
                    error: "A plot must contain at least 1 quadrat for the current census!"
                  }
                }));
              } else if (item === 'subquadrats') {
                setChecklistProgress(prevState => ({
                  ...prevState,
                  [item]: {
                    progress: 100, // Ensure progress is 100% even on failure
                    message: "Failure: " + item.charAt(0).toUpperCase() + item.substring(1),
                    error: "Each quadrat in the current census and plot must contain at least 1 subquadrat!"
                  }
                }));
              } else {
                setChecklistProgress(prevState => ({
                  ...prevState,
                  [item]: {
                    progress: 100, // Ensure progress is 100% even on failure
                    message: "Failure: " + item.charAt(0).toUpperCase() + item.substring(1),
                    error: "Table must contain at least 1 row of data!"
                  }
                }));
              }
              allValid = false;
            }
          }
          setIsUploadAllowed(allValid);
        }
      ;

      if (progressDialogOpen) {
        verifyPreconditions().catch(console.error);
      }
    }, [progressDialogOpen]
  )
  ;

  const addNewRowToGrid = () => {
    const id = randomId();
    // Define new row structure based on MeasurementsSummaryRDS type
    const newRow = {
      id: id,
      coreMeasurementID: 0,
      plotID: 0,
      plotName: '',
      censusID: 0,
      censusStartDate: null,
      censusEndDate: null,
      quadratID: 0,
      quadratName: '',
      subquadratID: 0,
      subquadratName: '',
      treeID: 0,
      treeTag: '',
      stemID: 0,
      stemTag: '',
      stemLocalX: 0,
      stemLocalY: 0,
      stemUnits: '',
      personnelID: 0,
      personnelName: '',
      measurementDate: null,
      measuredDBH: 0,
      dbhUnits: '',
      measuredHOM: 0,
      homUnits: '',
      description: '',
      attributes: [],
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
    }
  };
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
            {['attributes', 'species', 'personnel', 'quadrats', 'subquadrats'].map((item, index) => {
              const progressData = checklistProgress[item] || {progress: 0, message: "Pending..."};
              const tooltipMessage = progressData.error
                ? `${progressData.error}`
                : progressData.message;

              return (
                <ListItem sx={{alignItems: 'center', display: 'flex', flexDirection: 'row'}} key={item}>
                  <ListItemContent
                    sx={{minWidth: '160px', mr: 2, my: 'auto'}}> {/* Ensure vertical centering with margin auto */}
                    <Typography level={'body-md'}>{progressData.message}</Typography>
                  </ListItemContent>
                  <LargeTooltip title={tooltipMessage} placement="top" arrow>
                    <Box sx={{
                      width: '100%',
                      maxWidth: 'calc(100% - 180px)',
                      my: 'auto'
                    }}> {/* Adjust maxWidth accordingly */}
                      <LinearProgress
                        variant="determinate"
                        value={progressData.progress}
                        color={progressData.error ? 'error' : 'primary'}
                        sx={{
                          width: '100%',
                          height: 8, // Ensure the progress bar is visible enough
                          // backgroundColor: progressData.error ? 'error.main' : 'primary.main', // Use backgroundColor if bgcolor isn't effective
                        }}
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
              setChecklistProgress({});
              if (!isUploadAllowed) {
                setGlobalError('Missing prerequisites! Please upload supporting data before submitting measurements!');
                setTriggerGlobalError(true);
              }
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
          <Box sx={{flexGrow: 1}}>
            {session?.user.isAdmin && (
              <Typography level={"title-lg"} sx={{color: "#ffa726"}}>Note: ADMINISTRATOR VIEW</Typography>
            )}
            <Typography level={"title-md"} sx={{color: "#ffa726"}}>Note: This is a locked view and will not allow
              modification.</Typography>
            <Typography level={"body-md"} sx={{color: "#ffa726"}}>Please use this view as a way to confirm changes
              made
              to measurements.</Typography>
          </Box>
          <Button onClick={() => setProgressDialogOpen(true)} variant="solid" color="primary">Upload</Button>
        </Box>
      </Box>

      <UploadParentModal isUploadModalOpen={isUploadModalOpen}
                         handleCloseUploadModal={() => {
                           setIsUploadModalOpen(false);
                           setRefresh(true);
                         }} formType={"measurements"}/>

      <DataGridCommons
        locked={true}
        gridType="measurementssummaryview"
        gridColumns={MeasurementsSummaryGridColumns}
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
