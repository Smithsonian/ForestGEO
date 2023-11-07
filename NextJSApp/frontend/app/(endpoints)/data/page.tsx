"use client";

import React, {useState} from "react";
import {usePlotContext} from "@/app/plotcontext";
import {IRecordSet} from "mssql";
import {gridColumns, RowDataStructure, tableHeaders, tableHeaderSettings} from "@/config/macros";
import Button from "@mui/joy/Button";
import Box from "@mui/joy/Box";
import { DataGrid, GridRowsProp, GridColDef } from '@mui/x-data-grid';

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
  if (!currentPlot?.key) {
    return (
      <>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <p>You must select a plot to continue!</p>
        </Box>
      </>
    );
  } else {
    let data: RowDataStructure[] = []
    if (recordsets) {
      Object.values(recordsets[0]).map((row) => {
        let temp: RowDataStructure = {tag: row['Tag'], subquadrat: row['Subquadrat'], spcode: row['SpCode'], dbh: (row['DBH'] as number).toFixed(2), htmeas: (row['Htmeas'] as number).toFixed(2), codes: row['Codes'], comments: row['Comments']}
        data.push(temp);
      })
      let gridRows : GridRowsProp = data;
      return (
        <>
          <Button onClick={getData} loading={loading}>Reload Data</Button>
          <Box>
            <DataGrid columns={gridColumns} rows={gridRows} />
          </Box>
          <div>
            {/*{recordsets && <Table>*/}
            {/*  <thead>*/}
            {/*  <tr>*/}
            {/*    {tableHeaders.map((item, index) => (*/}
            {/*      <th style={tableHeaderSettings} key={index}>{item.label}</th>*/}
            {/*    ))}*/}
            {/*  </tr>*/}
            {/*  </thead>*/}
            {/*  <tbody>*/}
            {/*  {data.map((row, rowIndex) => (*/}
            {/*    <tr key={rowIndex}>*/}
            {/*      {Object.values(row).map((rowEntry, rowEntryIndex) => (*/}
            {/*        <td key={rowEntryIndex}>{rowEntry}</td>*/}
            {/*      ))}*/}
            {/*    </tr>*/}
            {/*  ))}*/}
            {/*  </tbody>*/}
            {/*</Table>}*/}
          </div>
        </>
      );
    } else {
      return (
        <>
          <Button onClick={getData} loading={loading}>Reload Data</Button>
        </>
      );
    }
  }
}
