"use client";
import {usePlotContext} from "@/app/plotcontext";
import {useState} from "react";
import {Button, getKeyValue, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow} from "@nextui-org/react";
import {IRecordSet} from "mssql";
import {tableHeaders} from "@/config/macros";

export default function Page() {
  const plot = usePlotContext()!;
  const [recordsets, setRecordsets] = useState<IRecordSet<any>[] | null>(null);
  const [loading, setLoading] = useState(false);
  
  async function getData() {
    setLoading(true);
    const res = await fetch('/api/sqlquery?plot=' + plot!.key, {
      method: 'GET',
    })
    const data = await res.json();
    if (!data) throw new Error("sqlquery route returned null");
    setRecordsets(await data.recordsets);
    setLoading(false);
  }
  if (recordsets) { // first one works
    let data: {tag: string,
      subquadrat: string,
      spcode: string,
      dbh: string,
      htmeas: string,
      codes: string,
      comments: string}[] = Object.values(recordsets[0]).map((row) => {
      return {
        tag: row[0],
        subquadrat: row[1],
        spcode: row[2],
        dbh: (row[3] as number).toFixed(2),
        htmeas: (row[4] as number).toFixed(2),
        codes: row[5],
        comments: row[6]
      }
    })
    return (
      <>
        {data.map((row, index) => (
          <div key={index}>
            {row.tag}
          </div>
        ))}
      </>
    );
    // return (
    //   <>
    //     <Table>
    //       <TableHeader columns={tableHeaders}>
    //         {(column) => <TableColumn key={column.key}>{column.label}</TableColumn>}
    //       </TableHeader>
    //       <TableBody items={data}>
    //         {(item) => (
    //           <TableRow key={Object.entries(item).findIndex(e => e[0] === item.tag)}>
    //             {(columnKey) => <TableCell>{getKeyValue(item, columnKey)}</TableCell>}
    //           </TableRow>
    //         )}
    //       </TableBody>
    //     </Table>
    //   </>
    // );
  } else {
    return (
      <>
        {<Button onClick={getData} isLoading={loading}>Click</Button>}
      </>
    );
  }
  
}