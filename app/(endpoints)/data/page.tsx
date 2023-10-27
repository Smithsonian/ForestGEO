"use client";

import React, {useState} from "react";
import {usePlotContext} from "@/app/plotcontext";
import {IRecordSet} from "mssql";
import {RowDataStructure, tableHeaders, tableHeaderSettings} from "@/config/macros";
import {Table} from "@mui/joy";
import Button from "@mui/joy/Button";

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
        <Button onClick={getData} loading={loading}>Reload Data</Button>
        <div>
          {recordsets && <Table>
            <thead>
            <tr>
              {tableHeaders.map((item, index) => (
                <th style={tableHeaderSettings} key={index}>{item.label}</th>
                ))}
            </tr>
            </thead>
            <tbody>
            {data.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {Object.values(row).map((rowEntry, rowEntryIndex) => (
                  <td key={rowEntryIndex}>{rowEntry}</td>
                ))}
              </tr>
              ))}
            </tbody>
          </Table>}
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
