import React, { useState, useEffect, useCallback } from 'react';
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

interface FileWithMetadata {
  fileName: {
    metaData: string;
  };
}

const Browse = (props: plotProps) => {
  // @TODO - implement remove and download files
  // let handleRemove = (i: any) => {
  //   const newRows = [...rows];
  //   const index = rows.findIndex((row) => row.file === i);
  //   newRows.splice(index, 1);
  //   setRows(newRows);
  // };

  const [error, setError] = useState<Error>();
  const [isLoaded, setIsLoaded] = useState(false);
  const [rows, setRows] = useState<FileWithMetadata>();

  const getListOfFiles = useCallback(async () => {
    if (props.plot.plotName) {
      const response = await fetch(
        '/api/download?plot=' + props.plot.plotName,
        {
          method: 'Get',
        }
      );
      const data = await response.json();
      setRows(data);
      setIsLoaded(true);
    } else {
      console.log('Plot is undefined');
      setError(new Error('No plot'));
    }
  }, [props.plot.plotName]);

  useEffect(() => {
    getListOfFiles();
  }, [getListOfFiles]);

  useEffect(() => {
    props.setPlot(props.plot);
    setIsLoaded(true);
    setError(undefined);
  }, [props, error, isLoaded]);

  if (!props.plot.plotName) {
    return (
      <>
        <div>Please select plot</div>
        <SelectPlot plot={props.plot} setPlot={props.setPlot} />
      </>
    );
  } else if (error) {
    return (
      <>
        <div>Error while loading data. Please select plot</div>
        <SelectPlot plot={props.plot} setPlot={props.setPlot} />
      </>
    );
  } else if (!isLoaded || !rows) {
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
                {Object.entries(rows).map((row, index) => {
                  return (
                    <TableRow key={index}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell>{row[0]}</TableCell>
                      <TableCell>{row[1].date}</TableCell>
                      <TableCell>{row[1].user}</TableCell>
                      <TableCell align="center">
                        <Button>
                          <DownloadIcon></DownloadIcon>
                        </Button>
                        <Button>
                          <EditIcon></EditIcon>
                        </Button>
                        <Button
                          onClick={() =>
                            console.log('trying to remove the file')
                          }
                        >
                          <DeleteIcon></DeleteIcon>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Grid>
      </>
    );
  }
};

export default Browse;
