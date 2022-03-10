import React, { useState } from 'react';
import { Add } from '@mui/icons-material';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Switch,
  TextField,
  Tooltip,
} from '@mui/material';
import PropTypes from 'prop-types';

const initialUser = {
  firstName: '',
  lastName: '',
  age: 0,
  visits: 0,
  status: 'single',
  progress: 0,
  subRows: undefined,
};

const AddUserDialog = (props) => {
  const [user, setUser] = useState(initialUser);
  const { addUserHandler } = props;
  const [open, setOpen] = React.useState(false);

  const [switchState, setSwitchState] = React.useState({
    addMultiple: false,
  });

  const handleSwitchChange = (name) => (event) => {
    setSwitchState({ ...switchState, [name]: event.target.checked });
  };

  const resetSwitch = () => {
    setSwitchState({ addMultiple: false });
  };

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    resetSwitch();
  };

  const handleAdd = (event) => {
    addUserHandler(user);
    setUser(initialUser);
    switchState.addMultiple ? setOpen(true) : setOpen(false);
  };

  const handleChange =
    (name) =>
    ({ target: { value } }) => {
      setUser({ ...user, [name]: value });
    };

  return (
    <div>
      <Tooltip title="Add">
        <IconButton aria-label="add" onClick={handleClickOpen}>
          <Add />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={handleClose}
        aria-labelledby="form-dialog-title"
      >
        <DialogTitle id="form-dialog-title">Add User</DialogTitle>
        <DialogContent>
          <DialogContentText>Demo add item to react table.</DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="First Name"
            type="text"
            fullWidth
            value={user.firstName}
            onChange={handleChange('firstName')}
          />
          <TextField
            margin="dense"
            label="Last Name"
            type="text"
            fullWidth
            value={user.lastName}
            onChange={handleChange('lastName')}
          />
          <TextField
            margin="dense"
            label="Age"
            type="number"
            fullWidth
            value={user.age}
            onChange={handleChange('age')}
          />
          <TextField
            margin="dense"
            label="Visits"
            type="number"
            fullWidth
            value={user.visits}
            onChange={handleChange('visits')}
          />
          <TextField
            margin="dense"
            label="Status"
            type="text"
            fullWidth
            value={user.status}
            onChange={handleChange('status')}
          />
          <TextField
            margin="dense"
            label="Profile Progress"
            type="number"
            fullWidth
            value={user.progress}
            onChange={handleChange('progress')}
          />
        </DialogContent>
        <DialogActions>
          <Tooltip title="Add multiple">
            <Switch
              checked={switchState.addMultiple}
              onChange={handleSwitchChange('addMultiple')}
              value="addMultiple"
              inputProps={{ 'aria-label': 'secondary checkbox' }}
            />
          </Tooltip>
          <Button onClick={handleClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleAdd} color="primary">
            Add
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

AddUserDialog.propTypes = {
  addUserHandler: PropTypes.func.isRequired,
};

export default AddUserDialog;
