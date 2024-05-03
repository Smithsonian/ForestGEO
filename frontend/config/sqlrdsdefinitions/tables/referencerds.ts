import { GridColDef } from '@mui/x-data-grid';
import { IDataMapper, parseDate } from '../../datamapper';


export type ReferenceRDS = {
  id: number;
  referenceID: number;
  publicationTitle: string | null;
  fullReference: string | null;
  dateOfPublication: Date | null;
};

export interface ReferenceResult {
  ReferenceID: any;
  PublicationTitle: any;
  FullReference: any;
  DateOfPublication: any;
}

export class ReferenceMapper implements IDataMapper<ReferenceResult, ReferenceRDS> {
  demapData(results: ReferenceRDS[]): ReferenceResult[] {
    return results.map(item => ({
      ReferenceID: item.referenceID,
      PublicationTitle: item.publicationTitle,
      FullReference: item.fullReference,
      DateOfPublication: item.dateOfPublication
    }));

  }
  mapData(results: ReferenceResult[], indexOffset: number = 1): ReferenceRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      referenceID: Number(item.ReferenceID),
      publicationTitle: String(item.PublicationTitle),
      fullReference: String(item.FullReference),
      dateOfPublication: parseDate(item.DateOfPublication)
    }));
  }
}

export const ReferenceGridColumns: GridColDef[] = [
  { field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'publicationTitle', headerName: 'PublicationTitle', headerClassName: 'header', flex: 1, align: 'left', },
  { field: 'fullReference', headerName: 'FullReference', headerClassName: 'header', flex: 1, align: 'left', },
  {
    field: 'dateOfPublication',
    headerName: 'DateOfPublication',
    type: "date",
    headerClassName: 'header',
    flex: 1,
    align: 'left',
    valueGetter: (params: any) => {
      if (!params.value) return null;
      return new Date(params.value);
    }
  },
];