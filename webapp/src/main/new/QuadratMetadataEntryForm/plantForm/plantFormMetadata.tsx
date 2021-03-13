import React from "react";
import "./plantForm.css";
import { Dropdown, DropdownMenuItemType, IDropdownOption, IDropdownStyles } from '@fluentui/react/lib/Dropdown';
import { DataCollectionDropdown } from "./plantDataFormDropdown";
import { PlantDatePicker } from "./plantDateFormDropdown";
import { Icon } from "@fluentui/react";
export const PlantFormMetadata = () => (
    <div>     
          <div>
            <DataCollectionDropdown label={"Quadrat"} placeholder={"Quadrat Empty List"} options={quadratDropdownOptions}/>
          </div>
          <div className="plantFormMetadata">
            <div>
              <DataCollectionDropdown label={"Data Collected By"} placeholder={"Jane Doe"} options={DataCollectionDropdownOptions}/>
              <DataCollectionDropdown label={"Data Checked By"} placeholder={"Jane Doe"} options={DataCollectionDropdownOptions}/>
              <DataCollectionDropdown label={"Data Entered By"} placeholder={"Jane Doe"} options={DataCollectionDropdownOptions}/>
            </div>
            <div>
                <PlantDatePicker label ={"Date Collected"}/>       
                <PlantDatePicker label ={"Date Checked"}/>
               <PlantDatePicker label ={"Date Entered"}/>
              </div>
          </div>
    </div>
);

PlantFormMetadata.defaultName = 'PlantFormMetadata';

const dropdownStyles: Partial<IDropdownStyles> = { dropdown: { width: 300 } };

const quadratDropdownOptions = [
  { key: 'Quadrat', text: 'Quadrat' },
];

const DataCollectionDropdownOptions = [
  { key: 'JaneDoe', text: 'Jane Doe' },
];
