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
import '../CSS/Browse.css';

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
      <Grid id={'grid1'} container direction="column" sx={{ marginTop: 20 }}>
        <Box id={'box'}>Loading Files...</Box>
        <CircularProgress size={60}></CircularProgress>
      </Grid>
    );
  } else {
    return (
      <Grid id={'grid2'} container direction="row" sx={{ marginTop: 10 }}>
        <TableContainer id={'tableContainer'}>
          <Table aria-label="simple table" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell id="tableCell">Form</TableCell>
                <TableCell id="tableCell">Quadrant</TableCell>
                <TableCell id="tableCell">Date Entered</TableCell>
                <TableCell id="tableCell">Validation</TableCell>
                <TableCell id="lastTableCell">Actions</TableCell>
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
