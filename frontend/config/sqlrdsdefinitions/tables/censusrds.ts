import {GridColDef} from '@mui/x-data-grid';
import {IDataMapper, parseDate} from "../../datamapper";

export interface CensusResult {
  CensusID: any;
  PlotID: any;
  PlotCensusNumber: any;
  StartDate: any;
  EndDate: any;
  Description: any;
}

export type CensusRaw = {
  id?: number;
  censusID?: number;
  plotID?: number;
  plotCensusNumber?: number;
  startDate?: Date;
  endDate?: Date;
  description?: string;
};

export type CensusRDS = CensusRaw | undefined;


export class CensusMapper implements IDataMapper<CensusResult, CensusRDS> {
  mapData(results: CensusResult[], indexOffset: number = 1): CensusRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      censusID: item.CensusID != null ? Number(item.CensusID) : undefined,
      plotID: item.PlotID != null ? Number(item.PlotID) : undefined,
      plotCensusNumber: item.PlotCensusNumber != null ? Number(item.PlotCensusNumber) : undefined,
      startDate: item.StartDate ? parseDate(item.StartDate) : undefined,
      endDate: item.EndDate ? parseDate(item.EndDate) : undefined,
      description: item.Description != null ? String(item.Description) : undefined
    }));
  }

  demapData(results: CensusRDS[]): CensusResult[] {
    return results.map((item): CensusResult => ({
      CensusID: item?.censusID !== undefined ? Number(item.censusID) : null,
      PlotID: item?.plotID !== undefined ? Number(item.plotID) : null,
      PlotCensusNumber: item?.plotCensusNumber !== undefined ? Number(item.plotCensusNumber) : null,
      StartDate: item?.startDate ? parseDate(item.startDate) : null,
      EndDate: item?.endDate ? parseDate(item.endDate) : null,
      Description: item?.description !== undefined ? String(item.description) : null
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
  {field: 'description', headerName: 'Description', headerClassName: 'header', flex: 1, type: 'string', editable: true},
];