import React from 'react';
import clsx from 'clsx';
import { Delete } from '@mui/icons-material';
import {
  IconButton,
  lighten,
  makeStyles,
  Toolbar,
  Typography,
  Tooltip,
} from '@mui/material';
import PropTypes from 'prop-types';
import GlobalFilter from './GlobalFilter';
import AddUserDialog from './AddUserDialog';

const useToolbarStyles = makeStyles((theme) => ({
  root: {
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(1),
  },
  highlight:
    theme.palette.type === 'light'
      ? {
          color: theme.palette.secondary.main,
          backgroundColor: lighten(theme.palette.secondary.light, 0.85),
        }
      : {
          color: theme.palette.text.primary,
          backgroundColor: theme.palette.secondary.dark,
        },
  title: {
    flex: '1 1 100%',
  },
}));

const TableToolbar = (props) => {
  const classes = useToolbarStyles();
  const {
    numSelected,
    addUserHandler,
    deleteUserHandler,
    preGlobalFilteredRows,
    setGlobalFilter,
    globalFilter,
  } = props;
  return (
    <Toolbar
      className={clsx(classes.root, {
        [classes.highlight]: numSelected > 0,
      })}
    >
      <AddUserDialog addUserHandler={addUserHandler} />
      {numSelected > 0 ? (
        <Typography
          className={classes.title}
          color="inherit"
          variant="subtitle1"
        >
          {numSelected} selected
        </Typography>
      ) : (
        <Typography className={classes.title} variant="h6" id="tableTitle">
          Users
        </Typography>
      )}

      {numSelected > 0 ? (
        <Tooltip title="Delete">
          <IconButton aria-label="delete" onClick={deleteUserHandler}>
            <Delete />
          </IconButton>
        </Tooltip>
      ) : (
        <GlobalFilter
          preGlobalFilteredRows={preGlobalFilteredRows}
          globalFilter={globalFilter}
          setGlobalFilter={setGlobalFilter}
        />
      )}
    </Toolbar>
  );
};

TableToolbar.propTypes = {
  numSelected: PropTypes.number.isRequired,
  addUserHandler: PropTypes.func.isRequired,
  deleteUserHandler: PropTypes.func.isRequired,
  setGlobalFilter: PropTypes.func.isRequired,
  preGlobalFilteredRows: PropTypes.array.isRequired,
  globalFilter: PropTypes.string.isRequired,
};

export default TableToolbar;
