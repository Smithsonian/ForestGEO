import React from "react";

import { Dropdown, IDropdownOption } from "@fluentui/react/lib/Dropdown";
import {
  DatePicker,
  DayOfWeek,
  IDatePickerStrings,
  mergeStyleSets,
  Icon,
} from "@fluentui/react";
import "./plantForm.css";
const DayPickerStrings: IDatePickerStrings = {
  months: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],

  shortMonths: [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ],

  days: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],

  shortDays: ["S", "M", "T", "W", "T", "F", "S"],

  goToToday: "Go to today",
  prevMonthAriaLabel: "Go to previous month",
  nextMonthAriaLabel: "Go to next month",
  prevYearAriaLabel: "Go to previous year",
  nextYearAriaLabel: "Go to next year",
  closeButtonAriaLabel: "Close date picker",
  monthPickerHeaderAriaLabel: "{0}, select to change the year",
  yearPickerHeaderAriaLabel: "{0}, select to change the month",
};

const controlClass = mergeStyleSets({
  control: {
    margin: "0 0 5px 0",
    width: "300px",
  },
});

export interface PlantDatePickerProps {
  label: string;
}

export const PlantDatePicker: React.FunctionComponent<PlantDatePickerProps> = (
  props: PlantDatePickerProps
) => {
  const [firstDayOfWeek, setFirstDayOfWeek] = React.useState(DayOfWeek.Sunday);

  const onDropdownChange = (event: any, option: any) => {
    setFirstDayOfWeek(DayOfWeek.Friday);
  };

  return (
    <div className="plantDataPicker">
      <span>
        <DatePicker
          label={props.label}
          className={controlClass.control}
          firstDayOfWeek={firstDayOfWeek}
          strings={DayPickerStrings}
          placeholder="Select a date..."
          ariaLabel="Select a date"
        />
      </span>
    </div>
  );
};
