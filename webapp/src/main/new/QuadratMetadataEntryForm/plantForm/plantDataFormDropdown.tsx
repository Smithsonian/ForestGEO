import { Dropdown, IDropdownOption, IDropdownStyles } from '@fluentui/react/lib/Dropdown';


import React from "react";
import { initializeIcons, Icon } from '@fluentui/react';

const dropdownStyles: Partial<IDropdownStyles> = { dropdown: { width: 300 } };



export interface DataCollectionDropdownProps{
  label:string;
  placeholder:string;
  options:  IDropdownOption<any>[];
}
export const DataCollectionDropdown: React.FunctionComponent<DataCollectionDropdownProps> = (props: DataCollectionDropdownProps) => {
  const [selectedItem, setSelectedItem] = React.useState<IDropdownOption>();

  const onChange = (event: React.FormEvent<HTMLDivElement>, item: IDropdownOption): void => {
    setSelectedItem(item);
  };
  initializeIcons(undefined, { disableWarnings: true });
  return (
      <div>
          <Dropdown
            label= {props.label}
            selectedKey={selectedItem ? selectedItem.key : undefined}
            onChange={(event, item) => console.log(item)}
            placeholder= {props.label}
            options={props.options}
            styles={dropdownStyles} 
          />
      </div>
  );
};