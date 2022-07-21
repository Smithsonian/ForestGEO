import React, { useState, useEffect } from 'react';
import {
  TableContainer,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Grid,
  Button,
  Box,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import data from '../mock-table-data.json';
import CircularProgress from '@mui/material/CircularProgress';

const Browse = () => {
  let handleRemove = (i: any) => {
    const newRows = [...rows];
    const index = rows.findIndex((row) => row.file === i);
    newRows.splice(index, 1);
    setRows(newRows);
  };

  async function getData() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(data);
        //reject('Failed to load');
      }, 2000);
    });
  }

  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    getData().then(
      (data: any) => {
        setIsLoaded(true);
        setRows(data);
      },
      (error) => {
        setIsLoaded(true);
        setError(error);
      }
    );
  }, []);

  if (error) {
    return <div>Error</div>;
  } else if (!isLoaded) {
    return (
      <Grid
        container
        direction="column"
        justifyContent="center"
        alignItems="center"
        sx={{ marginTop: 20 }}
      >
        <Box sx={{ fontWeight: 'bold', fontSize: '35px', mb: '30px' }}>
          Loading Files...
        </Box>
        <CircularProgress size={60}></CircularProgress>
      </Grid>
    );
  } else {
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
                    <Button onClick={() => handleRemove(row.file)}>
                      <DeleteIcon></DeleteIcon>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Grid>
    );
  }
};

export default Browse;
