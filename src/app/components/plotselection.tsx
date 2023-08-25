import React, {Dispatch, SetStateAction} from "react";
import {Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button} from "@nextui-org/react";

export interface Plot {
  key: string;
  count: number;
}
export interface SelectPlotProps {
  plot: Plot;
  setPlot: Dispatch<SetStateAction<Plot>>;
}

export default function SelectPlot(props: SelectPlotProps) {
  const plots: Plot[] = [];
  const items = [
    { key: "Amacayacu", count: 16 },
    { key: "BCI", count: 40 },
    { key: "bukittimah", count: 22 },
    { key: "Cocoli", count: 39 },
    { key: "CRC", count: 1 },
    { key: "CTFS-Panama", count: 11 },
    { key: "Danum", count: 36 },
    { key: "Harvard Forest", count: 9 },
    { key: "Heishiding", count: 4 },
    { key: "HKK", count: 19 },
    { key: "ituri_all", count: 24 },
    { key: "khaochong", count: 38 },
    { key: "Korup", count: 10 },
    { key: "korup3census", count: 32 },
    { key: "Lambir", count: 35 },
    { key: "Lilly_Dickey", count: 41 },
    { key: "Luquillo", count: 25 },
    { key: "Mpala", count: 3 },
    { key: "osfdp", count: 37 },
    { key: "pasoh", count: 15 },
    { key: "Rabi", count: 17 },
    { key: "Scotty Creek", count: 8 },
    { key: "SERC", count: 7 },
    { key: "Sinharaja", count: 26 },
    { key: "Speulderbos", count: 29 },
    { key: "Stable_bukittimah", count: 27 },
    { key: "stable_pasoh", count: 28 },
    { key: "Traunstein", count: 34 },
    { key: "Tyson", count: 23 },
    { key: "UMBC", count: 18 },
    { key: "Utah", count: 30 },
    { key: "Vandermeer", count: 14 },
    { key: "wanang", count: 21 },
    { key: "Yosemite", count: 33 },
  ];
  items.forEach((e) => {
    const obj = Object.entries(e);
    plots.push({key: obj[0][0], count: obj[0][1]} as Plot);
  });
  return (
    <Dropdown backdrop="blur">
      <DropdownTrigger>
        <Button
          variant="bordered"
        >
          Open Menu
        </Button>
      </DropdownTrigger>
      <DropdownMenu variant={"faded"} aria-label="Dynamic Actions" items={items} onAction={(key) => alert(key)}>
        {items.map((item) => (
          <DropdownItem
            key={item.key}
            color={"default"}
            className={""}
          >
            {item.key}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
