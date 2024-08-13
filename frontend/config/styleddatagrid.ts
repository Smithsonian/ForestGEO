import { DataGrid } from '@mui/x-data-grid';
import { styled } from '@mui/material/styles';

export const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
  border: 0,
  color: theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.85)',
  fontFamily: [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    'sans-serif',
    '"Apple Color Emoji"',
    '"Segoe UI Emoji"',
    '"Segoe UI Symbol"'
  ].join(','),
  WebkitFontSmoothing: 'auto',
  letterSpacing: 'normal',
  '& .MuiDataGrid-columnsContainer': {
    backgroundColor: theme.palette.mode === 'light' ? '#fafafa' : '#1d1d1d'
  },
  '& .MuiDataGrid-iconSeparator': {
    display: 'none'
  },
  '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {
    borderRight: `1px solid ${theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'}`
  },
  '& .MuiDataGrid-columnsContainer, & .MuiDataGrid-cell': {
    borderBottom: `1px solid ${theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'}`
  },
  '& .MuiDataGrid-cell': {
    color: theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.65)',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    lineHeight: '1.2'
  },
  '& .MuiPaginationItem-root': {
    borderRadius: 0
  },
  '& .MuiSelect-select': {
    display: 'flex',
    alignItems: 'center',
    padding: '0 4px' // Adjust padding to reduce space
  },
  '& .MuiSelect-icon': {
    fontSize: '12px', // Adjust icon size
    marginLeft: '4px' // Adjust margin to reduce space between text and icon
  },
  '& .MuiSelect-root': {
    fontSize: '12px', // Adjust font size as needed
    padding: '4px 0' // Adjust padding to reduce space
  }
}));
