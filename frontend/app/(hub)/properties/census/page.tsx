"use client";
import {GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
import {AlertProps} from "@mui/material";
import React, {useEffect, useState} from "react";
import {CensusGridColumns} from '@/config/sqlrdsdefinitions/censusrds';
import {useCensusContext, usePlotContext, useSiteContext} from "@/app/contexts/userselectionprovider";
import {randomId} from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagridcommons";
import {Button} from "@mui/joy";
import UpdateContextsFromIDB from "@/config/updatecontextsfromidb";
import {useSession} from "next-auth/react";
import {redirect} from "next/navigation";
import {useLoading} from "@/app/contexts/loadingprovider";
import {DatePicker} from '@mui/x-date-pickers';
import moment from "moment";


export default function CensusPage() {
  const initialRows: GridRowsProp = [
    {
      id: 0,
      censusID: 0,
      plotID: 0,
      plotCensusNumber: 0,
      startDate: new Date(),
      endDate: new Date(),
      description: ''
    },
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
  let currentPlot = usePlotContext();
  let currentSite = useSiteContext();
  let currentCensus = useCensusContext();
  let {setLoading} = useLoading();
  const {data: session} = useSession();
  const [openCensusId, setOpenCensusId] = useState<number | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  if (!session) redirect('/');
  const {updateQuadratsContext, updateCensusContext, updatePlotsContext} =
    UpdateContextsFromIDB({email: session.user.email ?? '', schema: currentSite?.schemaName ?? ''});

  // Function to validate the end date
  const validateEndDate = (censusId: number, chosenEndDate: Date | null): boolean => {
    const census = rows.find(row => row.censusID === censusId);
    if (!census) return false; // census not found
    const startDate = new Date(census.startDate);
    const endDate = chosenEndDate || new Date();
    return endDate >= startDate;
  };

  useEffect(() => {
    // Identify if there's an open census and set its ID
    const openCensus = rows.find(row => !row.endDate);
    setOpenCensusId(openCensus ? openCensus.censusID : null);
  }, [rows]);

  const handleToggleCensus = async () => {
    if (openCensusId !== null) {
      await closeOpenCensus(openCensusId);
    } else {
      await handleAddOpenCensus();
    }
  };

  const closeOpenCensus = async (censusId: number) => {
    // Close the open census
    if (!validateEndDate(censusId, endDate)) {
      setSnackbar({children: 'End date must be after the start date', severity: 'error'});
      return;
    }
    try {
      const updateData = {
        endDate: endDate || new Date()
      };
      const response = await fetch(`/api/fixeddata/census?schema=${currentSite?.schemaName ?? ''}&censusID=${censusId}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(updateData)
      });
      if (!response.ok) throw new Error('Failed to close open-ended census');
      // Update grid data after successful closing
      setRefresh(true);
      // Reset endDate
      setEndDate(null);
    } catch (error) {
      console.error('Error closing open-ended census:', error);
      setSnackbar({children: 'Error closing open-ended census', severity: 'error'});
    }
  };


  const handleAddOpenCensus = async () => {
    // Check if there's already an open-ended census
    const openCensusExists = rows.some(row => row.endDate === null);
    if (openCensusExists) {
      alert('An open-ended census already exists.');
      return;
    }

    // Logic to generate a new open-ended census row
    const newCensusId = rows.length > 0 ? Math.max(...rows.map(row => row.censusID)) + 1 : 1;
    const newOpenCensus = {
      id: newCensusId,
      censusID: newCensusId,
      plotID: currentPlot ? currentPlot.id : 0, // Assuming currentPlot holds the current plot context
      plotCensusNumber: newCensusId,
      startDate: new Date(), // Current date as start date
      endDate: null, // Open-ended census
      description: 'Open-ended census added automatically'
    };

    try {
      // Replace with your actual API call
      const response = await fetch(`/api/fixeddata/census?schema=${currentSite?.schemaName ?? ''}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(newOpenCensus)
      });
      if (!response.ok) throw new Error('Failed to add open-ended census');
      setRefresh(true);
      setLoading(true, 'Updating Contexts...');
      await Promise.all([updatePlotsContext(), updateQuadratsContext(), updateCensusContext()]);
      setLoading(false);
    } catch (error) {
      console.error('Error adding open-ended census:', error);
      setSnackbar({children: 'Error adding open-ended census', severity: 'error'});
    }
  };

  const addNewRowToGrid = () => {
    const id = randomId();
    const nextCensusID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.censusID, max), 0)
      : 0) + 1;
    const newRow = {
      id: id,
      censusID: nextCensusID,
      plotID: currentPlot ? currentPlot.id : 0,
      plotCensusNumber: 0,
      startDate: null,
      endDate: null,
      description: '',
      isNew: true
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: {mode: GridRowModes.Edit, fieldToFocus: 'StartDate'},
    }));
  };

  return (
    <>
      <Button variant="outlined" onClick={handleToggleCensus} sx={{marginBottom: 2}}>
        {openCensusId !== null ? "Close Open Census" : "Add Open Census"}
      </Button>
      {openCensusId !== null && (
        <DatePicker
          value={endDate ? moment(endDate) : moment()}
          onChange={(date) => setEndDate(date ? date.toDate() : null)}
          defaultValue={moment()}
        />
      )}
      <DataGridCommons
        gridType="census"
        gridColumns={CensusGridColumns}
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