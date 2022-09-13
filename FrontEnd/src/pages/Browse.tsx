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
import CircularProgress from '@mui/material/CircularProgress';
import '../CSS/Browse.css';
import SelectPlot from '../components/SelectPlot';
import { plotProps } from '../components/SelectPlot';

const Browse = (props: plotProps) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const initialState: { [fileName: string]: { [metaData: string]: string } } =
    {};
  // const [listOfFiles, setListOfFiles] = useState(initialState);

  const getListOfFiles = async () => {
    if (props.plot) {
      const response = await fetch(
        '/api/download?plot=' + props.plot.plotName,
        {
          method: 'Get',
        }
      );
      const data = await response.json();
      return data;
    } else {
      console.log('Plot is undefined');
      throw new Error('No plot');
    }
  };

  // let handleRemove = (i: any) => {
  //   const newRows = [...rows];
  //   const index = rows.findIndex((row) => row.file === i);
  //   newRows.splice(index, 1);
  //   setRows(newRows);
  // };

  async function getData() {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve(getListOfFiles);
        reject('Failed to load');
      }, 2000);
    });
  }

  const [error, setError] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [rows, setRows] = useState<{
    [fileName: string]: { [metaData: string]: string };
  }>({});

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
  });

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
      <>
        <SelectPlot plot={props.plot} setPlot={props.setPlot} />
        <Grid id={'grid2'} container direction="row" sx={{ marginTop: 10 }}>
          <TableContainer id={'tableContainer'}>
            <Table aria-label="simple table" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell id="tableCell">#</TableCell>
                  <TableCell id="tableCell">File Name</TableCell>
                  <TableCell id="tableCell">Date Entered</TableCell>
                  <TableCell id="tableCell">Uploaded by</TableCell>
                  <TableCell id="lastTableCell">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(rows).map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>{index}</TableCell>
                    <TableCell>{row[0]}</TableCell>
                    <TableCell>{row[0][0]}</TableCell>
                    <TableCell>{row[0][1]}</TableCell>
                    <TableCell align="center">
                      <Button>
                        <DownloadIcon></DownloadIcon>
                      </Button>
                      <Button>
                        <EditIcon></EditIcon>
                      </Button>
                      <Button
                        onClick={() => console.log('trying to remove the file')}
                      >
                        <DeleteIcon></DeleteIcon>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </>
    );
  }
};

export default Browse;
