"use client";

import React, {useState} from "react";
import {Button} from "@nextui-org/react";
import {usePlotContext} from "@/app/plotcontext";
import {IRecordSet} from "mssql";
import {RowDataStructure, tableHeaders, tableHeaderSettings} from "@/config/macros";
import {Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow} from "@mui/material";
import {createTheme, ThemeProvider} from "@mui/material/styles";
const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

export default function Page() {
  const plot = usePlotContext()!;
  const [recordsets, setRecordsets] = useState<IRecordSet<any>[] | null>(null);
  const [loading, setLoading] = useState(false);
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
  let data: RowDataStructure[] = []
  if (recordsets) {
    Object.values(recordsets[0]).map((row) => {
      let temp: RowDataStructure = {tag: row['Tag'], subquadrat: row['Subquadrat'], spcode: row['SpCode'], dbh: (row['DBH'] as number).toFixed(2), htmeas: (row['Htmeas'] as number).toFixed(2), codes: row['Codes'], comments: row['Comments']}
      data.push(temp);
    })
    return (
      <>
        <Button onClick={getData} isLoading={loading}>Reload Data</Button>
        <div>
          <ThemeProvider theme={darkTheme}>
            <TableContainer component={Paper}>
              {recordsets && <Table sx={{minWidth: 650}}>
                <TableHead>
                  <TableRow>
                    {tableHeaders.map((item, index) => (
                      <TableCell sx={tableHeaderSettings} key={index}>{item.label}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {Object.values(row).map((rowEntry, rowEntryIndex) => (
                        <TableCell key={rowEntryIndex}>{rowEntry}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>}
            </TableContainer>
          </ThemeProvider>
        </div>
      </>
    );
  } else {
    return (
      <>
        <Button onClick={getData} isLoading={loading}>Reload Data</Button>
      </>
    );
  }
}
