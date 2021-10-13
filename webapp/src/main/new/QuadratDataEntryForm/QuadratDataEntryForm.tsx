import { useState, useMemo } from "react";
import { Column } from "react-table";
import { EditableTable } from "../../../components/editableTable";

import { Stem } from "../../../types";

interface QuadratDataEntryFormProps {
  columns: Column[];
  initialData: Stem[];
}
export function QuadratDataEntryForm({
  columns,
  initialData,
}: QuadratDataEntryFormProps) {
  const [data, setData] = useState(useMemo(() => initialData, []));

  const updateData = (rowIndex: number, columnId: string, value: any) => {
    console.log(`set data for ${columnId} at row ${rowIndex} to ${value}`);

    setData((old) =>
      old.map((row, index) => {
        if (index === rowIndex) {
          return {
            ...old[rowIndex],
            [columnId]: value,
          };
        }
        return row;
      })
    );
  };

  return (
    <EditableTable columns={columns} data={data} updateData={updateData} />
  );
}
QuadratDataEntryForm.defaultName = "QuadratDataEntryForm";
