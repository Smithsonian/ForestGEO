"use client";
import { GridRowModes, GridRowModesModel, GridRowsProp } from "@mui/x-data-grid";
import { AlertProps } from "@mui/material";
import React, { useState } from "react";
import { initialQuadratRDSRow, QuadratsGridColumnSet } from '@/config/sqlrdsdefinitions/tables/quadratrds';
import { useOrgCensusContext, usePlotContext, } from "@/app/contexts/userselectionprovider";
import { randomId } from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagrids/datagridcommons";
import { Box, Button, Stack, Typography } from "@mui/joy";
import { useSession } from "next-auth/react";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";
import Link from 'next/link';
import { GridColDef } from "@mui/x-data-grid";
import { unitSelectionOptions } from "@/config/macros";

export default function QuadratsDataGrid() {
  const [rows, setRows] = React.useState([initialQuadratRDSRow] as GridRowsProp);
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
  const { data: session } = useSession();
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFormType, setUploadFormType] = useState<'quadrats'>('quadrats');
  const [a, b] = QuadratsGridColumnSet;

  const currentPlot = usePlotContext();
  const currentCensus = useOrgCensusContext();

  const quadratsUnitColumn: GridColDef = {
    field: 'unit',
    headerName: 'Unit',
    headerClassName: 'header',
    flex: 0.3,
    renderHeader: () => <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
      <Typography level='body-sm' fontWeight={'xl'}>Quadrat</Typography>
      <Typography level='body-xs'>Units</Typography>
    </Stack>,
    align: 'center',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };

  const addNewRowToGrid = () => {
    const id = randomId();
    const nextQuadratID = (rows.length > 0
      ? rows.reduce((max, row) => Math.max(row.quadratID, max), 0)
      : 0) + 1;
    const newRow = {
      ...initialQuadratRDSRow,
      id: id,
      quadratID: nextQuadratID,
      plotID: currentPlot ? currentPlot.id : 0,
      censusID: currentCensus ? currentCensus.dateRanges[0].censusID : 0,
      isNew: true,
    };
    // Add the new row to the state
    setRows(oldRows => [...oldRows, newRow]);
    // Set editing mode for the new row
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: GridRowModes.Edit, fieldToFocus: 'quadratName' },
    }));
  };
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, width: '100%' }}>
        <Box sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'warning.main',
          borderRadius: '4px',
          p: 2
        }}>
          <Box sx={{ flexGrow: 1 }}>
            {session?.user.userStatus !== 'fieldcrew' && (
              <Typography level={"title-lg"} sx={{ color: "#ffa726" }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
            <Typography level={"title-md"} sx={{ color: "#ffa726" }}>
              Note: This is a locked view and will not allow modification.
            </Typography>
            <Typography level={"body-md"} sx={{ color: "#ffa726" }}>
              Please use this view as a way to confirm changes made to measurements.
            </Typography>
          </Box>

          {/* Upload Button */}
          <Button onClick={() => {
            setIsUploadModalOpen(true);
            setUploadFormType('quadrats');
          }} color={'primary'}>
            Upload Quadrats
          </Button>
          {/* Link to Quadrat Personnel Data Grid */}
          <Link href="/fixeddatainput/quadratpersonnel" passHref>
            <Button variant="solid" color="primary" sx={{ ml: 2 }}>View Quadrat Personnel</Button>
          </Link>
        </Box>
      </Box>
      <UploadParentModal isUploadModalOpen={isUploadModalOpen} handleCloseUploadModal={() => {
        setIsUploadModalOpen(false);
        setRefresh(true);
      }} formType={uploadFormType} />
      <DataGridCommons
        gridType="quadrats"
        gridColumns={[...a, quadratsUnitColumn, ...b]}
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
