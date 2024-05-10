import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper, parseDate } from "../../datamapper";
import { Templates } from '@/config/datagridhelpers';

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

export class CensusMapper implements IDataMapper<CensusResult, CensusRDS> {
  mapData(results: CensusResult[], indexOffset: number = 1): CensusRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      censusID: Number(item.CensusID),
      plotID: Number(item.PlotID),
      plotCensusNumber: Number(item.PlotCensusNumber),
      startDate: parseDate(item.StartDate),
      endDate: parseDate(item.EndDate),
      description: String(item.Description)
    }));
  }
  demapData(results: CensusRDS[]): CensusResult[] {
    return results.map((item) => ({
      CensusID: Number(item?.censusID),
      PlotID: Number(item?.plotID),
      PlotCensusNumber: Number(item?.plotCensusNumber),
      StartDate:  item?.startDate ? parseDate(item?.startDate) : null,
      EndDate: item?.endDate ? parseDate(item?.endDate) : null,
      Description: String(item?.description)
    }));
  }
}

export const censusFields = [
  'plotID',
  'plotCensusNumber',
  'startDate',
  'endDate',
  'description'
];


export const CensusGridColumns: GridColDef[] = [
  {
    field: 'censusID',
    headerName: 'ID',
    type: 'number',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: false
  },
  {
    field: 'plotCensusNumber',
    headerName: 'PlotCensusNumber',
    type: 'number',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    editable: false
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
  { field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, type: 'string', editable: true },
];