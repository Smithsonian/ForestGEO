import {Dispatch, SetStateAction} from 'react';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormHelperText from '@mui/material/FormHelperText';
import FormControl from '@mui/material/FormControl';
import Select, {SelectChangeEvent} from '@mui/material/Select';

export interface Plot {
  plotName: string;
  plotNumber: number;
}

export interface SelectPlotProps {
  plot: Plot;
  setPlot: Dispatch<SetStateAction<Plot>>;
}

export default function SelectPlot(props: SelectPlotProps) {
  const plots: Plot[] = [];
  
  const plotsObjects: { [key: string]: number }[] = [
    {Amacayacu: 16},
    {BCI: 40},
    {bukittimah: 22},
    {Cocoli: 39},
    {CRC: 1},
    {'CTFS-Panama': 11},
    {Danum: 36},
    {'Harvard Forest': 9},
    {Heishiding: 4},
    {HKK: 19},
    {ituri_all: 24},
    {khaochong: 38},
    {Korup: 10},
    {korup3census: 32},
    {Lambir: 35},
    {Lilly_Dickey: 41},
    {Luquillo: 25},
    {Mpala: 3},
    {osfdp: 37},
    {pasoh: 15},
    {Rabi: 17},
    {'Scotty Creek': 8},
    {SERC: 7},
    {Sinharaja: 26},
    {Speulderbos: 29},
    {Stable_bukittimah: 27},
    {stable_pasoh: 28},
    {Traunstein: 34},
    {Tyson: 23},
    {UMBC: 18},
    {Utah: 30},
    {Vandermeer: 14},
    {wanang: 21},
    {Yosemite: 33},
  ];
  
  plotsObjects.forEach((e) => {
    const obj = Object.entries(e);
    plots.push({plotName: obj[0][0], plotNumber: obj[0][1]});
  });
  
  const handleChange = (event: SelectChangeEvent) => {
    const chosenPlotNumber = parseInt(event.target.value);
    const setNumberPlot = plots.find((e) => e.plotNumber === chosenPlotNumber);
    const chosenPlotName = setNumberPlot!.plotName;
    const newPlot: Plot = {
      plotName: chosenPlotName,
      plotNumber: chosenPlotNumber,
    };
    props.setPlot(newPlot);
  };
  let value;
  props.plot.plotNumber === 0
    ? (value = '')
    : (value = props.plot.plotNumber.toString());
  return (
    <FormControl sx={{m: 1, minWidth: 180}} required>
      <InputLabel id="simple">Plot</InputLabel>
      <Select
        labelId="simple"
        id="simple-select-required"
        value={value}
        label="Plot *"
        onChange={handleChange}
      >
        <MenuItem value="">
          <em>None</em>
        </MenuItem>
        
        {plots.map((plot: Plot, i) => {
          return (
            <MenuItem value={plot.plotNumber.toString()} key={i}>
              {plot.plotName}
            </MenuItem>
          );
        })}
      </Select>
      <FormHelperText>Required</FormHelperText>
    </FormControl>
  );
}
