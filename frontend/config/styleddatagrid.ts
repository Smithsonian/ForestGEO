// styleddatagrid.ts
import { DataGrid } from '@mui/x-data-grid';
import { styled } from '@mui/joy/styles';

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
    borderRight: `1px solid ${theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center'
  },
  '& .MuiDataGrid-columnsContainer, & .MuiDataGrid-cell': {
    borderBottom: `1px solid ${theme.palette.mode === 'light' ? '#f0f0f0' : '#303030'}`
  },
  '& .MuiDataGrid-cell': {
    color: theme.palette.mode === 'light' ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,0.65)',
    whiteSpace: 'normal',
    wordWrap: 'break-word',
    lineHeight: '1.2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center'
  },
  '& .MuiPaginationItem-root': {
    borderRadius: 0
  },
  '& .MuiSelect-select': {
    display: 'flex',
    alignItems: 'center',
    padding: '0 4px'
  },
  '& .MuiSelect-icon': {
    fontSize: '12px',
    marginLeft: '4px'
  },
  '& .MuiSelect-root': {
    fontSize: '12px',
    padding: '4px 0'
  },
  '& .treestemstate--newrecruit': {
    backgroundColor: theme.palette.primary.softBg,
    '&:hover': { backgroundColor: theme.palette.primary.softHoverBg },
    '&.Mui-selected': {
      backgroundColor: theme.palette.primary.softActiveBg
    }
  },
  '& .treestemstate--oldtrees': {
    backgroundColor: theme.palette.success.softBg,
    '&:hover': { backgroundColor: theme.palette.success.softHoverBg },
    '&.Mui-selected': {
      backgroundColor: theme.palette.success.softActiveBg
    }
  },
  '& .treestemstate--multistem': {
    backgroundColor: theme.palette.warning.softBg,
    '&:hover': { backgroundColor: theme.palette.warning.softHoverBg },
    '&.Mui-selected': {
      backgroundColor: theme.palette.warning.softActiveBg
    }
  },
  '& .treestemstate--null': {
    backgroundColor: theme.palette.danger['900'],
    '&:hover': { backgroundColor: theme.palette.danger['800'] },
    '&.Mui-selected': {
      backgroundColor: theme.palette.danger['700']
    }
  }
}));
