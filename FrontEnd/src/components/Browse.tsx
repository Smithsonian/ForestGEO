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
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import data from '../mock-table-data.json';

const Browse = () => {
  let handleRemove = (i: any) => {
    const newRows = [...rows];
    const index = rows.findIndex((row) => row.file === i);
    newRows.splice(index, 1);
    setRows(newRows);
  };

  //PERMANENT CODE BELOW
  //Commented out code is for use once the backend is set up.
  //Once set up, simply replace fetch call with correct link, uncomment the code,
  //and then delete the TEMPORARY code at the end of the file.

  /*
  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    fetch('https://api.example.com/items')
      .then((res) => res.json())
      .then(
        (result) => {
          setIsLoaded(true);
          setRows(result);
        },
        // Note: it's important to handle errors here
        // instead of a catch() block so that we don't swallow
        // exceptions from actual bugs in components.
        (error) => {
          setIsLoaded(true);
          setError(error);
        }
      );
  }, []);

  if (error) {
    return <div>Error: {error.message}</div>;
  } else if (!isLoaded) {
    return <div>Loading...</div>;
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
*/

  //TEMPORARY CODE BELOW
  //Everything below is TEMPORARY data to test the UI for the table on browse page.
  const [rows, setRows] = useState(data);

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
};

export default Browse;
