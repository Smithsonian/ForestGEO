import {GridColDef} from '@mui/x-data-grid';


export type ValidationErrorRDS = {
  id: number;
  validationErrorID: number;
  validationErrorDescription: string | null;
};

export const ValidationErrorGridColumns: GridColDef[] = [
  {field: 'validationErrorID', headerName: 'ValidationErrorID', headerClassName: 'header', flex: 1, align: 'left',},
  {
    field: 'validationErrorDescription',
    headerName: 'ValidationErrorDescription',
    headerClassName: 'header',
    flex: 1,
    align: 'left',
  },
];
