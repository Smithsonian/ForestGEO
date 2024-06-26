// "use client";
// import {GridColDef, GridRowModes, GridRowModesModel, GridRowsProp} from "@mui/x-data-grid";
// import {AlertProps} from "@mui/material";
// import React, {useCallback, useEffect, useState} from "react";
// import {QuadratsGridColumns as BaseQuadratsGridColumns, Quadrat} from '@/config/sqlrdsdefinitions/tables/quadratrds';
// import {
//   useOrgCensusContext,
//   usePlotContext,
//   useQuadratDispatch,
// } from "@/app/contexts/userselectionprovider";
// import {randomId} from "@mui/x-data-grid-generator";
// import DataGridCommons from "@/components/datagrids/datagridcommons";
// import {Box, Button, Typography} from "@mui/joy";
// import {useSession} from "next-auth/react";
// import UploadParentModal from "@/components/uploadsystemhelpers/uploadparentmodal";

// export default function QuadratsDataGrid() {
//   const initialRows: GridRowsProp = [
//     {
//       id: 0,
//       quadratID: 0,
//       plotID: 0,
//       censusID: 0,
//       quadratName: '',
//       dimensionX: 0,
//       dimensionY: 0,
//       area: 0,
//       unit: '',
//       quadratShape: '',
//     },
//   ];
//   const [rows, setRows] = React.useState(initialRows);
//   const [rowCount, setRowCount] = useState(0);  // total number of rows
//   const [rowModesModel, setRowModesModel] = React.useState<GridRowModesModel>({});
//   const [locked, setLocked] = useState(false);
//   const [snackbar, setSnackbar] = React.useState<Pick<
//     AlertProps,
//     'children' | 'severity'
//   > | null>(null);
//   const [refresh, setRefresh] = useState(false);
//   const [paginationModel, setPaginationModel] = useState({
//     page: 0,
//     pageSize: 10,
//   });
//   const [isNewRowAdded, setIsNewRowAdded] = useState<boolean>(false);
//   const [shouldAddRowAfterFetch, setShouldAddRowAfterFetch] = useState(false);
//   // const [censusOptions, setCensusOptions] = useState<GridSelections[]>([]);
//   const {data: session} = useSession();
//   const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
//   const [uploadFormType, setUploadFormType] = useState<'quadrats' | 'subquadrats'>('quadrats');

//   const currentPlot = usePlotContext();
//   const currentCensus = useOrgCensusContext();
//   const quadratDispatch = useQuadratDispatch();

//   useEffect(() => {
//     if (currentCensus !== undefined) {
//       setLocked(currentCensus.dateRanges[0].endDate !== undefined); // if the end date is not undefined, then grid should be locked
//     }
//   }, [currentCensus]);

//   const handleSelectQuadrat = useCallback((quadratID: number | null) => {
//     // we want to select a quadrat contextually when using this grid FOR subquadrats selection
//     // however, this information should not be retained, as the user might select a different quadrat or change quadrat information
//     // thus, we add the `| null` to the function and ensure that the context is properly reset when the user is done making changes or cancels their changes.
//     if (quadratID === null) quadratDispatch && quadratDispatch({quadrat: undefined}).catch(console.error); // dispatches are asynchronous
//     else {
//       const selectedQuadrat = rows.find(row => row.quadratID === quadratID) as Quadrat; // GridValidRowModel needs to be cast to Quadrat
//       if (selectedQuadrat && quadratDispatch) quadratDispatch({quadrat: selectedQuadrat}).catch(console.error);
//     }
//   }, [rows, quadratDispatch]);

//   const addNewRowToGrid = () => {
//     const id = randomId();
//     const nextQuadratID = (rows.length > 0
//       ? rows.reduce((max, row) => Math.max(row.quadratID, max), 0)
//       : 0) + 1;
//     const newRow = {
//       id: id,
//       quadratID: nextQuadratID,
//       plotID: currentPlot ? currentPlot.id : 0,
//       censusID: currentCensus ? currentCensus.dateRanges[0].censusID : 0,
//       quadratName: '',
//       dimensionX: 0,
//       dimensionY: 0,
//       area: 0,
//       unit: '',
//       quadratShape: '',
//       isNew: true,
//     };
//     // Add the new row to the state
//     setRows(oldRows => [...oldRows, newRow]);
//     // Set editing mode for the new row
//     setRowModesModel(oldModel => ({
//       ...oldModel,
//       [id]: {mode: GridRowModes.Edit, fieldToFocus: 'quadratName'},
//     }));
//   };

//   // const updatePersonnelInRows = useCallback((id: GridRowId, newPersonnel: PersonnelRDS[]) => {
//   //   setRows(rows => rows.map(row =>
//   //     row.id === id
//   //       ? {...row, personnel: newPersonnel.map(person => ({...person}))}
//   //       : row
//   //   ));
//   // }, []);

//   // const handlePersonnelChange = useCallback(
//   //   async (rowId: GridRowId, selectedPersonnel: PersonnelRDS[]) => {
//   //     console.log(rows);
//   //     const row = rows.find((row) => row.id === rowId);
//   //     const quadratId = row?.quadratID;
//   //     const personnelIds = selectedPersonnel.map(person => person.personnelID);
//   //     console.log('new personnel ids: ', personnelIds);

//   //     // Check if quadratID is valid and not equal to the initial row's quadratID
//   //     if (quadratId === undefined || quadratId === initialRows[0].quadratID) {
//   //       console.error("Invalid quadratID, personnel update skipped.");
//   //       setSnackbar({children: "Personnel update skipped due to invalid quadratID.", severity: 'error'});
//   //       return;
//   //     }

//   //     try {
//   //       const response = await fetch(`/api/formsearch/personnelblock?quadratID=${quadratId}&schema=${currentSite?.schemaName ?? ''}`, {
//   //         method: 'PUT',
//   //         headers: {
//   //           'Content-Type': 'application/json'
//   //         },
//   //         body: JSON.stringify(personnelIds)
//   //       });

//   //       if (!response.ok) {
//   //         setSnackbar({children: `Personnel updates failed!`, severity: 'error'});
//   //         throw new Error('Failed to update personnel');
//   //       }

//   //       // Handle successful response
//   //       const responseData = await response.json();
//   //       updatePersonnelInRows(rowId, selectedPersonnel);
//   //       setRefresh(true);
//   //       setSnackbar({children: `${responseData.message}`, severity: 'success'});
//   //     } catch (error) {
//   //       console.error("Error updating personnel:", error);
//   //     }
//   //   },
//   //   [rows, currentSite?.schemaName, setSnackbar, setRefresh, updatePersonnelInRows]
//   // );


//   const quadratsGridColumns: GridColDef[] = [...BaseQuadratsGridColumns,
//     // {
//     //   field: 'personnel',
//     //   headerName: 'Personnel',
//     //   flex: 1,
//     //   renderCell: (params) => (
//     //     <PersonnelAutocompleteMultiSelect
//     //       initialValue={params.row.personnel}
//     //       onChange={(newPersonnel) => handlePersonnelChange(params.id, newPersonnel)}
//     //       locked={!rowModesModel[params.id] || rowModesModel[params.id].mode !== GridRowModes.Edit}
//     //     />
//     //   ),
//     // },
//     // {
//     //   field: 'subquadrats',
//     //   headerName: 'Subquadrats',
//     //   flex: 1,
//     //   renderCell: (params) => (
//     //     <Box sx={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
//     //       <Button
//     //         fullWidth
//     //         onClick={() => setIsSubquadratDialogOpen(true)}
//     //         disabled={!rowModesModel[params.id] || rowModesModel[params.id].mode !== GridRowModes.Edit}
//     //         size="md"
//     //       >
//     //         <Typography>
//     //           [ {subquadratList ? subquadratList.filter(subquadrat => subquadrat?.quadratID === params.row.quadratID).map(sq => sq?.subquadratName).join(', ') : ''} ]
//     //         </Typography>
//     //       </Button>
//     //     </Box>
//     //   ),
//     // }
//   ];

//   return (
//     <>
//       <Box sx={{display: 'flex', alignItems: 'center', mb: 3, width: '100%'}}>
//         <Box sx={{
//           width: '100%',
//           display: 'flex',
//           justifyContent: 'space-between',
//           alignItems: 'center',
//           backgroundColor: 'warning.main',
//           borderRadius: '4px',
//           p: 2
//         }}>
//           <Box sx={{flexGrow: 1}}>
//             {session?.user.isAdmin && (
//               <Typography level={"title-lg"} sx={{color: "#ffa726"}}>
//                 Note: ADMINISTRATOR VIEW
//               </Typography>
//             )}
//             <Typography level={"title-md"} sx={{color: "#ffa726"}}>
//               Note: This is a locked view and will not allow modification.
//             </Typography>
//             <Typography level={"body-md"} sx={{color: "#ffa726"}}>
//               Please use this view as a way to confirm changes made to measurements.
//             </Typography>
//           </Box>

//           {/* Upload Button */}
//           <Button onClick={() => {
//             setIsUploadModalOpen(true);
//             setUploadFormType('quadrats');
//           }} color={'primary'}>
//             Upload Quadrats
//           </Button>
//           {/* <Button onClick={() => {
//             setIsUploadModalOpen(true);
//             setUploadFormType('subquadrats');
//           }} color={'neutral'}>
//             Upload Subquadrats
//           </Button> */}
//         </Box>
//       </Box>
//       <UploadParentModal isUploadModalOpen={isUploadModalOpen} handleCloseUploadModal={() => {
//         setIsUploadModalOpen(false);
//         setRefresh(true);
//       }} formType={uploadFormType}/>
//       {/* <Modal
//         open={isSubquadratDialogOpen}
//         onClose={() => {
//         }}
//         aria-labelledby="upload-dialog-title"
//         sx={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}
//       >
//         <ModalDialog
//           size="lg"
//           sx={{width: '100%', maxHeight: '100vh', overflow: 'auto'}}
//           role="alertdialog"
//         >
//           <IconButton
//             aria-label="close"
//             onClick={() => setIsSubquadratDialogOpen(false)}
//             sx={{position: 'absolute', top: 8, right: 8}}
//           >
//             <CloseIcon/>
//           </IconButton>
//           <SubquadratsDataGrid/>
//         </ModalDialog>
//       </Modal> */}
//       <DataGridCommons
//         locked={locked}
//         gridType="quadrats"
//         gridColumns={quadratsGridColumns}
//         rows={rows}
//         setRows={setRows}
//         rowCount={rowCount}
//         setRowCount={setRowCount}
//         rowModesModel={rowModesModel}
//         setRowModesModel={setRowModesModel}
//         snackbar={snackbar}
//         setSnackbar={setSnackbar}
//         refresh={refresh}
//         setRefresh={setRefresh}
//         paginationModel={paginationModel}
//         setPaginationModel={setPaginationModel}
//         isNewRowAdded={isNewRowAdded}
//         setIsNewRowAdded={setIsNewRowAdded}
//         shouldAddRowAfterFetch={shouldAddRowAfterFetch}
//         setShouldAddRowAfterFetch={setShouldAddRowAfterFetch}
//         addNewRowToGrid={addNewRowToGrid}
//         handleSelectQuadrat={handleSelectQuadrat}
//       />
//     </>
//   );
// }