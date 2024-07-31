'use client';
import React, { useEffect, useState } from "react";
import { GridRowModes, GridRowModesModel, GridRowsProp } from "@mui/x-data-grid";
import { Alert, AlertProps, LinearProgress, Tooltip, TooltipProps, styled, tooltipClasses } from "@mui/material";
import { initialMeasurementsSummaryViewRDSRow } from '@/config/sqlrdsdefinitions/views/measurementssummaryviewrds';
import { Box, ListItemContent, ListItem, List, Modal, ModalDialog, Typography, Button, DialogTitle, DialogContent, DialogActions, Snackbar, Stack, } from "@mui/joy";
import Select, { SelectOption } from "@mui/joy/Select";
import { useSession } from "next-auth/react";
import { useOrgCensusContext, usePlotContext, useQuadratDispatch, useSiteContext } from "@/app/contexts/userselectionprovider";
import { randomId } from "@mui/x-data-grid-generator";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";
import { useQuadratListContext } from "@/app/contexts/listselectionprovider";
import { Quadrat } from "@/config/sqlrdsdefinitions/tables/quadratrds";
import Option from '@mui/joy/Option';
import MeasurementSummaryGrid from "@/components/datagrids/msvdatagrid";
import { useDataValidityContext } from "@/app/contexts/datavalidityprovider";
import { UnifiedValidityFlags } from "@/config/macros";
import { msvGridColumns } from "@/components/client/datagridcolumns";
const LargeTooltip = styled(({ className, ...props }: TooltipProps) => (
  <Tooltip {...props} classes={{ popper: className }} />
))(({ theme }) => ({
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
  const { data: session } = useSession();
  const [quadrat, setQuadrat] = useState<Quadrat>();
  const [quadratList, setQuadratList] = useState<Quadrat[] | undefined>([]);
  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();
  const currentSite = useSiteContext();
  const quadratListContext = useQuadratListContext();
  const quadratDispatch = useQuadratDispatch();
  const { validity, recheckValidityIfNeeded } = useDataValidityContext();
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
    setRowModesModel(oldModel => ({ ...oldModel, [id]: { mode: GridRowModes.Edit } }));
  };

  const handleCloseGlobalError = () => {
    setGlobalError(null);
    setTriggerGlobalError(false);
  };

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
      await quadratDispatch({ quadrat: selectedQuadrat });
    }
  };

  const handleConfirmQuadrat = async () => {
    await handleQuadratSelection(quadrat);
  };

  const QuadratSelectionMenu = () => (
    <Stack direction="column" spacing={2} marginBottom={2}>
      <Typography level="title-sm">Select Quadrat:</Typography>
      <Select
        disabled={!validity['quadrats']}
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
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <Typography level="body-lg">{item?.quadratName}</Typography>
            </Box>
          </Option>
        ))}
      </Select>
      <Button
        onClick={handleConfirmQuadrat}
        size="sm"
        color="primary"
        disabled={!validity['quadrats']}
      >Confirm</Button>
      {!validity['quadrats'] && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          <Typography level="body-lg" color="warning">No quadrats exist to be selected.</Typography>
        </Alert>
      )}
    </Stack>
  );

  return (
    <>
      {globalError && (
        <Snackbar open={triggerGlobalError} autoHideDuration={6000} onClose={handleCloseGlobalError}>
          <Alert onClose={handleCloseGlobalError} severity="error">{globalError}</Alert>
        </Snackbar>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, width: '100%' }}>
        <Box sx={{
          width: '100%', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', backgroundColor: 'warning.main', borderRadius: '4px', p: 2
        }}>
          <Stack direction="column">
            <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <Box sx={{ flex: 1, display: 'flex', justifyContent: 'left', flexDirection: 'column', marginTop: 2 }}>
                <Typography level={"title-md"} sx={{ color: "#ffa726" }}>Note: This plot does not accept
                  subquadrats. <br />
                  Please ensure that you use quadrat names when submitting new measurements instead of subquadrat
                  names
                </Typography>
                {session?.user.userStatus !== 'fieldcrew' ? (
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
                  <Typography level={"title-md"} sx={{ color: "#ffa726" }}>If this setting is inaccurate, please contact
                    an administrator.</Typography>
                )}
              </Box>
            </Box>
          </Stack>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button onClick={() => {
              if (currentCensus?.dateRanges[0].endDate === undefined) setIsUploadModalOpen(true);
              else alert('census must be opened before upload allowed');
            }} variant="solid" color="primary">Upload</Button>
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
        gridColumns={msvGridColumns}
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