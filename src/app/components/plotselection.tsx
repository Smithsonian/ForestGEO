import React from "react";
import {Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button} from "@nextui-org/react";

interface SelectPlotProps {
  setSelection: (value: (((prevState: string) => string) | string)) => void
}

export default function SelectPlot(setSelection: SelectPlotProps) {
  const items = [
    { key: "Amacayacu" },
    { key: "BCI" },
    { key: "bukittimah" },
    { key: "Cocoli" },
    { key: "CRC" },
    { key: "CTFS-Panama" },
    { key: "Danum" },
    { key: "Harvard Forest" },
    { key: "Heishiding" },
    { key: "HKK" },
    { key: "ituri_all" },
    { key: "khaochong" },
    { key: "Korup" },
    { key: "korup3census" },
    { key: "Lambir" },
    { key: "Lilly_Dickey" },
    { key: "Luquillo" },
    { key: "Mpala" },
    { key: "osfdp" },
    { key: "pasoh" },
    { key: "Rabi" },
    { key: "Scotty Creek" },
    { key: "SERC" },
    { key: "Sinharaja" },
    { key: "Speulderbos" },
    { key: "Stable_bukittimah" },
    { key: "stable_pasoh" },
    { key: "Traunstein" },
    { key: "Tyson" },
    { key: "UMBC" },
    { key: "Utah" },
    { key: "Vandermeer" },
    { key: "wanang" },
    { key: "Yosemite" },
  ];
  return (
    <Dropdown>
      <DropdownTrigger>
        <Button
          variant="bordered"
        >
          Open Menu
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label="Dynamic Actions" items={items}
      onAction={(key) => setSelection(key)}
      >
        {items.map((item) => (
          <DropdownItem
            key={item.key}
            color={item.key === "delete" ? "danger" : "default"}
            className={item.key === "delete" ? "text-danger" : ""}
          >
            {item.key}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}
