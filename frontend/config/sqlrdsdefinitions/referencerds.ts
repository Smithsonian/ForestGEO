import {GridColDef} from '@mui/x-data-grid';


export type ReferenceRDS = {
  id: number;
  referenceID: number;
  publicationTitle: string | null;
  fullReference: string | null;
  dateOfPublication: Date | null;
};


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
