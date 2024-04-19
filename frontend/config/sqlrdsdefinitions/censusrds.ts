import {GridColDef} from '@mui/x-data-grid';


export type CensusRaw = {
  id: number;
  censusID: number;
  plotID: number | null;
  plotCensusNumber: number | null;
  startDate: Date | null;
  endDate: Date | null;
  description: string | null;
};

export type CensusRDS = CensusRaw | null;

export const CensusGridColumns: GridColDef[] = [
  {
    field: 'censusID',
    headerName: 'ID',
    type: 'number',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  // {
  //   field: 'plotID',
  //   headerName: 'PlotID',
  //   headerClassName: 'header',
  //   flex: 1,
  //   align: 'left',
  //   editable: true
  // },
  {
    field: 'plotCensusNumber',
    headerName: 'PlotCensusNumber',
    type: 'number',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: true
  },
  {
    field: 'startDate',
    headerName: 'Starting',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    type: 'date',
    editable: true,
    valueFormatter: (params: any) => {
      if (params) {
        return new Date(params).toDateString();
      } else return "null";
    }
  },
  {
    field: 'endDate',
    headerName: 'Ending',
    headerClassName: 'header',
    type: 'date',
    flex: 1,
    align: 'left',
    editable: true,
    valueFormatter: (params: any) => {
      if (params) {
        return new Date(params).toDateString();
      } else return "null";
    }
  },
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, editable: true},
];

export interface Census {
  plotID: number;
  plotCensusNumber: number;
  startDate: Date;
  endDate: Date;
  description: string;
}

export interface CensusResult {
  CensusID: any;
  PlotID: any;
  PlotCensusNumber: any;
  StartDate: any;
  EndDate: any;
  Description: any;
}

