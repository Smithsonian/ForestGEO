import React, {useCallback, useEffect, useState} from 'react';
import {
  Box,
  Button,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CircularProgress from '@mui/material/CircularProgress';
import SelectPlot, {SelectPlotProps} from '../SelectPlot';

// @todo: look into using an ID other than plot name.
// @todo: react router URL params to pass in the ID for Browse.
//        https://reactrouter.com/en/main/start/tutorial#url-params-in-loaders

/**
 * Keyed by csv filename, valued by date and user that uploaded it.
 */
interface PlotRows {
  [fileName: string]: {
    date: string;
    user: string;
  };
}

export interface BrowseProps extends SelectPlotProps {
}

export interface BrowsePureProps extends BrowseProps {
  error?: Error;
  /** True when plot data has finished loading. */
  isLoaded: boolean;
  /** All the rows of data for the plot. */
  plotRows?: PlotRows;
}

export default function Browse({plot, setPlot}: BrowseProps) {
  // @TODO - implement remove and download files
  // let handleRemove = (i: any) => {
  //   const newRows = [...rows];
  //   const index = rows.findIndex((row) => row.file === i);
  //   newRows.splice(index, 1);
  //   setRows(newRows);
  // };
  
  const [error, setError] = useState<Error>();
  const [isLoaded, setIsLoaded] = useState(false);
  const [plotRows, setRows] = useState<PlotRows>();
  
  const getListOfFiles = useCallback(async () => {
    if (plot.plotName) {
      let response = null;
      try {
        response = await fetch('/api/download?plot=' + plot.plotName, {
          method: 'Get',
        });
        
        if (!response.ok) {
          console.error('response.statusText', response.statusText);
          setError(new Error('API response not ok'));
        }
      } catch (e) {
        console.error(e);
        setError(new Error('API response not ok'));
      }
      
      if (response) {
        const data = await response.json();
        setRows(data);
        setIsLoaded(true);
      }
    } else {
      console.log('Plot is undefined');
      setError(new Error('No plot'));
    }
  }, [plot.plotName]);
  
  useEffect(() => {
    getListOfFiles();
  }, [getListOfFiles]);
  
  useEffect(() => {
    setPlot(plot);
    setIsLoaded(true);
    setError(undefined);
  }, [plot, setPlot, error, isLoaded]);
  
  return (
    <BrowsePure
      plot={plot}
      setPlot={setPlot}
      error={error}
      plotRows={plotRows}
      isLoaded={isLoaded}
    />
  );
}

/**
 * A container for layout.
 */
function Container({children}: { children?: React.ReactNode }) {
  return (
    <Grid
      container
      direction="column"
      sx={{
        marginTop: 20,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Box
        sx={{
          fontWeight: 'bold',
          fontSize: 35,
          marginBottom: 30,
        }}
      >
        {children}
      </Box>
    </Grid>
  );
}

/**
 * Allows selecting from a list of plots, then shows the data for that plot.
 */
export function BrowsePure({
                             plot,
                             setPlot,
                             error,
                             isLoaded,
                             plotRows,
                           }: BrowsePureProps) {
  if (!plot.plotName) {
    return (
      <Container>
        <Typography variant="h2" mt={2}>
          Please select plot
        </Typography>
        <SelectPlot plot={plot} setPlot={setPlot}/>
      </Container>
    );
  } else if (error) {
    return (
      <Container>
        <Typography variant="h2" mt={2}>
          Error while loading data.
        </Typography>
        <Typography mt={2} mb={2}>
          Perhaps try reloading the page. If it still doesn't work, please again
          a bit later.
        </Typography>
        <SelectPlot plot={plot} setPlot={setPlot}/>
      </Container>
    );
  } else if (!isLoaded || !plotRows) {
    return (
      <Container>
        <Typography variant="h2" mt={2}>
          Loading Files...
        </Typography>
        <CircularProgress size={60}></CircularProgress>
      </Container>
    );
  } else {
    return (
      <>
        <Typography variant="h2" mt={2}>
          Files for "{plot.plotName}"
        </Typography>
        <SelectPlot plot={plot} setPlot={setPlot}/>
        <Grid
          container
          direction="row"
          sx={{
            marginTop: 10,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <TableContainer
            sx={{
              maxHeight: 300,
              maxWidth: '75%',
              border: 'solid',
              borderColor: '#0f5530',
              borderRadius: 2,
            }}
          >
            <Table aria-label="simple table" stickyHeader>
              <TableHead>
                <TableRow
                  sx={{
                    fontWeight: 'bold',
                  }}
                >
                  <TableCell>File Name</TableCell>
                  <TableCell>Date Entered</TableCell>
                  <TableCell>Uploaded by</TableCell>
                  <TableCell sx={{textAlign: 'center'}}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.keys(plotRows).map((fileName) => {
                  return (
                    <TableRow key={fileName}>
                      <TableCell>{fileName}</TableCell>
                      <TableCell>{plotRows[fileName].date}</TableCell>
                      <TableCell>{plotRows[fileName].user}</TableCell>
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
}
