import {GridColDef} from '@mui/x-data-grid';
import {IDataMapper, parseDate} from '../../datamapper';


export type ReferenceRDS = {
  id?: number;
  referenceID?: number;
  publicationTitle?: string;
  fullReference?: string;
  dateOfPublication?: Date;
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
      ReferenceID: item.referenceID != null ? String(item.referenceID) : null,
      PublicationTitle: item.publicationTitle != null ? String(item.publicationTitle) : null,
      FullReference: item.fullReference != null ? String(item.fullReference) : null,
      DateOfPublication: item.dateOfPublication != null ? item.dateOfPublication.toISOString() : null,
    }));
  }

  mapData(results: ReferenceResult[], indexOffset: number = 1): ReferenceRDS[] {
    return results.map((item, index) => ({
      id: index + indexOffset,
      referenceID: item.ReferenceID != null ? Number(item.ReferenceID) : undefined,
      publicationTitle: item.PublicationTitle != null ? String(item.PublicationTitle) : undefined,
      fullReference: item.FullReference != null ? String(item.FullReference) : undefined,
      dateOfPublication: item.DateOfPublication != null ? parseDate(item.DateOfPublication) : undefined,
    }));
  }
}


export const ReferenceGridColumns: GridColDef[] = [
  {field: 'referenceID', headerName: 'ReferenceID', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'publicationTitle', headerName: 'PublicationTitle', headerClassName: 'header', flex: 1, align: 'left',},
  {field: 'fullReference', headerName: 'FullReference', headerClassName: 'header', flex: 1, align: 'left',},
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