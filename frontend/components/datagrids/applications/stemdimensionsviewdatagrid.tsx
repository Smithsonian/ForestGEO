// stemdimensionsview datagrid
"use client";
import { GridColDef, GridRowsProp } from "@mui/x-data-grid";
import { AlertProps } from "@mui/material";
import React, { useState } from "react";
import { randomId } from "@mui/x-data-grid-generator";
import DataGridCommons from "@/components/datagrids/datagridcommons";
import { Box, Button, Typography } from "@mui/joy";
import { useSession } from "next-auth/react";
import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";
import { gridColumnsArraySDVRDS, initialStemDimensionsViewRDSRow } from "@/config/sqlrdsdefinitions/views/stemdimensionsviewrds";
import { unitSelectionOptions } from "@/config/macros";
import { useOrgCensusContext } from "@/app/contexts/userselectionprovider";

export default function StemDimensionsViewDataGrid() {
  const [rows, setRows] = useState([initialStemDimensionsViewRDSRow] as GridRowsProp);
  const [rowCount, setRowCount] = useState(0);
  const [rowModesModel, setRowModesModel] = useState({});
  const [snackbar, setSnackbar] = React.useState<Pick<
    AlertProps,
    'children' | 'severity'
  > | null>(null);
  const [refresh, setRefresh] = useState(false);
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 10 });
  const [isNewRowAdded, setIsNewRowAdded] = useState(false);
  const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { data: session } = useSession();
  const currentCensus = useOrgCensusContext();
  const [a, b, c, d] = gridColumnsArraySDVRDS;

  const addNewRowToGrid = () => {
    const id = randomId();
    const newRow = {
      ...initialStemDimensionsViewRDSRow,
      id,
      isNew: true,
    };

    setRows(oldRows => [...oldRows ?? [], newRow]);
    setRowModesModel(oldModel => ({
      ...oldModel,
      [id]: { mode: 'edit', fieldToFocus: 'stemTag' },
    }));
    console.log('attributes addnewrowtogrid triggered');
  };
  // stem, subquadrats, quadrat, plot
  const stemUnitsColumn: GridColDef = {
    field: 'stemUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };
  const subquadratUnitsColumn: GridColDef = {
    field: 'subquadratUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };
  const quadratUnitsColumn: GridColDef = {
    field: 'quadratUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
  };
  const plotUnitsColumn: GridColDef = {
    field: 'plotUnits',
    headerName: 'U',
    headerClassName: 'header',
    flex: 0.4,
    renderHeader: () => <Typography level='body-xs'>U</Typography>,
    align: 'left',
    editable: true,
    type: 'singleSelect',
    valueOptions: unitSelectionOptions
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
            {session?.user.isAdmin && (
              <Typography level={"title-lg"} sx={{ color: "#ffa726" }}>
                Note: ADMINISTRATOR VIEW
              </Typography>
            )}
          </Box>


          {/* Upload Button */}
          <Button onClick={() => {
              if (currentCensus?.dateRanges[0].endDate === undefined) setIsUploadModalOpen(true);
              else alert('census must be opened before upload allowed');
            }} variant="solid" color="primary">Upload</Button>
        </Box>
      </Box>

      <UploadParentModal isUploadModalOpen={isUploadModalOpen} handleCloseUploadModal={() => {
        setIsUploadModalOpen(false);
        setRefresh(true);
      }} formType={"species"} />

      <DataGridCommons
        gridType="stemdimensionsview"
        gridColumns={[...a, stemUnitsColumn, ...b, subquadratUnitsColumn, ...c, quadratUnitsColumn, ...d, plotUnitsColumn]}
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