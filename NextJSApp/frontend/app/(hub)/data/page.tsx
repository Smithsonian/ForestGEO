"use client";

import {useState} from "react";
import {usePlotContext} from "@/app/contexts/plotcontext";
import {IRecordSet} from "mssql";
import {DataGrid} from '@mui/x-data-grid';
import {styled} from "@mui/system";

const StyledDataGrid = styled(DataGrid)(({theme}) => ({
  border: 0,
  color:
    theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.85)',
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"',
  ].join(','),
  WebkitFontSmoothing: 'auto',
  letterSpacing: 'normal',
  '& .MuiDataGrid-columnsContainer': {
    backgroundColor: theme.palette.mode === 'light' ? '#fafafa' : '#1d1d1d',
  },
  '& .MuiDataGrid-iconSeparator': {
    display: 'none',
  },
  '& .MuiDataGrid-columnHeader, .MuiDataGrid-cell': {
    borderRight: `1px solid ${
      theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'
    }`,
  },
  '& .MuiDataGrid-columnsContainer, .MuiDataGrid-cell': {
    borderBottom: `1px solid ${
      theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'
    }`,
  },
  '& .MuiDataGrid-cell': {
    color:
      theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.65)',
  },
  '& .MuiPaginationItem-root': {
    borderRadius: 0,
  },
}));


export default function Page() {
  const plot = usePlotContext()!;
  const [recordsets, setRecordsets] = useState<IRecordSet<any>[] | null>(null);
  const [loading, setLoading] = useState(false);
  const currentPlot = usePlotContext();
  
  async function getData() {
    setLoading(true);
    const res = await fetch(`/api/getalldataforplot?plot=` + plot!.key, {
      method: 'GET',
    })
    const data = await res.json();
    if (!data) throw new Error("getalldataforplot route returned null");
    setRecordsets(await data.recordsets);
    setLoading(false);
  }
  
  // if (!currentPlot) {
  //   return (
  //     <>
  //       <Box sx={{display: 'flex', gap: 1, alignItems: 'center'}}>
  //         <p>You must select a <b>plot</b> to continue!</p>
  //       </Box>
  //     </>
  //   );
  // } else {
  //   let gridRows: GridRowDataStructure[] = []
  //   if (recordsets) {
  //     Object.values(recordsets[0]).map((row) => {
  //       let temp: RowDataStructure = {
  //         tag: row['Tag'],
  //         subquadrat: row['Subquadrat'],
  //         spcode: row['SpCode'],
  //         dbh: (row['DBH'] as number).toFixed(2),
  //         htmeas: (row['Htmeas'] as number).toFixed(2),
  //         codes: row['Codes'],
  //         comments: row['Comments']
  //       }
  //       let gridTemp: GridRowDataStructure = {
  //         id: row['Tag'],
  //         subquadrat: row['Subquadrat'],
  //         spcode: row['SpCode'],
  //         dbh: (row['DBH'] as number).toFixed(2),
  //         htmeas: (row['Htmeas'] as number).toFixed(2),
  //         codes: row['Codes'],
  //         comments: row['Comments']
  //       }
  //       gridRows.push(gridTemp);
  //     })
  //     // let gridRows : GridRowsProp = data;
  //     let gridRowsProp: GridRowsProp = gridRows;
  //     return (
  //       <>
  //
  //         <Box sx={{flexDirection: 'column'}}>
  //           <Box>
  //             <Button onClick={getData} loading={loading}>Reload Data</Button>
  //           </Box>
  //           <Box sx={{display: 'flex'}}>
  //             <StyledDataGrid columns={gridColumns} rows={gridRowsProp}/>
  //           </Box>
  //         </Box>
  //       </>
  //     );
  //   } else {
  //     return (
  //       <>
  //         <Box sx={{display: 'flex', flexDirection: 'column', marginBottom: 5}}>
  //           <Button onClick={getData} loading={loading}>Reload Data</Button>
  //         </Box>
  //       </>
  //     );
  //   }
  // }
}
