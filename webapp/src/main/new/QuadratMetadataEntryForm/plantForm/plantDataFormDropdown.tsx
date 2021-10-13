import {
  Dropdown,
  IDropdownOption,
  IDropdownStyles,
} from "@fluentui/react/lib/Dropdown";

import React from "react";
import { initializeIcons } from "@fluentui/react";

const dropdownStyles: Partial<IDropdownStyles> = { dropdown: { width: 300 } };

export interface DataCollectionDropdownProps {
  label: string;
  placeholder: string;
  options: IDropdownOption<any>[];
}
export const DataCollectionDropdown: React.FunctionComponent<DataCollectionDropdownProps> =
  ({ label, options }: DataCollectionDropdownProps) => {
    const [selectedItem] = React.useState<IDropdownOption>();

    initializeIcons(undefined, { disableWarnings: true });
    return (
      <div>
        <Dropdown
          label={label}
          selectedKey={selectedItem ? selectedItem.key : undefined}
          onChange={(item) => console.log(item)}
          placeholder={label}
          options={options}
          styles={dropdownStyles}
        />
      </div>
    );
  };
