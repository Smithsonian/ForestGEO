import React, { useState } from 'react';
import {
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Grid,
  Button,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import data from '../mock-table-data.json';

const Browse = () => {
  const [rows, setRows] = useState(data);

  let handleRemove = (i: any) => {
    const newRows = [...rows];
    const index = rows.findIndex((row) => row.file === i);
    newRows.splice(index, 1);
    setRows(newRows);
  };

  return (
    <Grid
      container
      direction="row"
      justifyContent="center"
      alignItems="center"
      sx={{ marginTop: 10 }}
    >
      <TableContainer
        sx={{
          maxHeight: '300px',
          maxWidth: '75%',
          border: 'solid',
          borderColor: 'primary.main',
          borderRadius: 2,
        }}
      >
        <Table aria-label="simple table" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold' }}>Form</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Quadrant</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Date Entered</TableCell>
              <TableCell sx={{ fontWeight: 'bold' }}>Validation</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                Actions
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.file}>
                <TableCell>{row.file}</TableCell>
                <TableCell>{row.quadrant}</TableCell>
                <TableCell>{row.date}</TableCell>
                <TableCell>{row.validation}</TableCell>
                <TableCell align="center">
                  <Button>
                    <DownloadIcon></DownloadIcon>
                  </Button>
                  <Button>
                    <EditIcon></EditIcon>
                  </Button>
                  <Button>
                    <DeleteIcon
                      onClick={() => handleRemove(row.file)}
                    ></DeleteIcon>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Grid>
  );
};

export default Browse;
