import {GridColDef} from "@mui/x-data-grid";
import moment from "moment";


export type MeasurementsSummaryRDS = {
  id: number;
  coreMeasurementID: number;
  quadratID: number | null;
  plotID: number | null;
  plotName: string | null;
  plotCensusNumber: number | null;
  censusStartDate: any;
  censusEndDate: any;
  quadratName: string | null;
  subQuadratName: string | null;
  treeTag: string | null;
  stemTag: string | null;
  stemLocalX: number | null;
  stemLocalY: number | null;
  speciesName: string | null;
  subSpeciesName: string | null;
  genus: string | null;
  family: string | null;
  personnelName: string | null;
  measurementDate: any;
  measuredDBH: number | null;
  measuredHOM: number | null;
  description: string | null;
  attributes: string | null;
};

export const MeasurementsSummaryGridColumns: GridColDef[] = [
  {field: 'coreMeasurementID', headerName: '#', headerClassName: 'header', flex: 1, align: 'left'},
  // {field: 'plotName', headerName: 'Plot Name', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'plotCensusNumber', headerName: 'Plot Census', headerClassName: 'header', flex: 1, align: 'left',},
  // {
  //   field: 'censusStartDate',
  //   headerName: 'Census Start',
  //   type: "string",
  //   headerClassName: 'header',
  //   flex: 1,
  //   valueGetter: (params) => {
  //     if (!params.value) return null;
  //     return new Date(params.value).toDateString();
  //   }
  // },
  // {
  //   field: 'censusEndDate',
  //   headerName: 'Census End',
  //   type: "string",
  //   headerClassName: 'header',
  //   flex: 1,
  //   valueGetter: (params) => {
  //     if (!params.value) return null;
  //     return new Date(params.value).toDateString();
  //   }
  // },
  {field: 'quadratName', headerName: 'Quadrat', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'treeTag', headerName: 'Tag', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'stemTag', headerName: 'Stem', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemLocalX', headerName: 'Stem X', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemLocalY', headerName: 'Stem Y', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'stemQuadZ', headerName: 'Stem Z', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'speciesName', headerName: 'Species', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'subSpeciesName', headerName: 'SubSpecies', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'genus', headerName: 'Genus', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'family', headerName: 'Family', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'personnelName', headerName: 'Recording', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'measurementDate',
    headerName: 'Date',
    headerClassName: 'header',
    flex: 1,
    valueGetter: (value: any) => {
      // Check if the date is present and valid
      if (!value || !moment(value).isValid()) return '';
      // Format the date
      return new Date(value).toDateString();
    },
    // valueFormatter: (value: any) => {
    //   console.log('value formatter trigger: ', moment(value).format('MMMM DD, YYYY'));
    //   return moment(value).format('MMMM DD, YYYY');
    // }
  },
  {field: 'measuredDBH', headerName: 'DBH', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'measuredHOM', headerName: 'HOM', headerClassName: 'header', flex: 1, align: 'left',},
  // {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'attributes', headerName: 'Attributes', headerClassName: 'header', flex: 1, align: 'left',},
];

export interface ForestGEOMeasurementsSummaryResult {
  CoreMeasurementID: any;
  QuadratID: any;
  PlotID: any;
  PlotName: any;
  PlotCensusNumber: any;
  StartDate: any;
  EndDate: any;
  QuadratName: any;
  SubQuadratName: any;
  TreeTag: any;
  StemTag: any;
  StemLocalX: any;
  StemLocalY: any;
  SpeciesName: any;
  SubSpeciesName: any;
  Genus: any;
  Family: any;
  PersonnelName: any;
  MeasurementDate: any;
  MeasuredDBH: any;
  MeasuredHOM: any;
  Description: any;
  Attributes: any;
}

