'use client';

import {
  Button,
  Card,
  CardContent,
  DialogActions,
  DialogContent,
  FormControl,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Option,
  Select,
  Snackbar,
  Stack,
  Typography
} from '@mui/joy';
import { Plot } from '@/config/sqlrdsdefinitions/zones';
import { ChangeEvent, Dispatch, SetStateAction, useEffect, useState } from 'react';
import { areaSelectionOptions, unitSelectionOptions } from '@/config/macros';
import Grid from '@mui/joy/Grid';
import { createPostPatchQuery } from '@/config/datagridhelpers';
import { useSiteContext } from '@/app/contexts/userselectionprovider';
import { Portal } from '@mui/base';
import CircularProgress from '@mui/joy/CircularProgress';
import Filter5Icon from '@mui/icons-material/Filter5';
import Filter4Icon from '@mui/icons-material/Filter4';
import Filter3Icon from '@mui/icons-material/Filter3';
import Filter2Icon from '@mui/icons-material/Filter2';
import Filter1Icon from '@mui/icons-material/Filter1';

export default function PlotCardModal(props: {
  plot: Plot;
  openPlotCardModal: boolean;
  setOpenPlotCardModal: Dispatch<SetStateAction<boolean>>;
  setManualReset: Dispatch<SetStateAction<boolean>>;
}) {
  const { plot, openPlotCardModal, setOpenPlotCardModal, setManualReset } = props;
  const [isEditing, setIsEditing] = useState(false);
  const [openSnackbar, setOpenSnackbar] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editablePlot, setEditablePlot] = useState<Plot>({ ...plot });
  const [countdown, setCountdown] = useState(5);
  const currentSite = useSiteContext();

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
    if (!isEditing) {
      setEditablePlot({ ...plot });
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (editablePlot) {
      setEditablePlot({ ...editablePlot, [name]: value });
    }
  };

  const handleSave = async () => {
    setSubmitting(true);
    if (!editablePlot) throw new Error('Editable plot is undefined');

    const { numQuadrats, usesSubquadrats, ...filteredPlot } = editablePlot;
    const fetchProcessQuery = createPostPatchQuery(currentSite?.schemaName ?? '', 'plots', 'plotID');

    const response = await fetch(fetchProcessQuery, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldRow: plot, newRow: filteredPlot })
    });

    if (response.ok) {
      setSnackbarMessage('Update successful! System will now reload. Please wait...');
    } else {
      // if response fails, then reset should not occur.
      setSnackbarMessage('Update failed. Please try again.');
    }
    setOpenSnackbar(true);
    setCountdown(5);
  };

  useEffect(() => {
    if (openSnackbar) {
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer); // Stop the timer when countdown ends
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer); // Cleanup on unmount or Snackbar close
    }
  }, [openSnackbar]);

  const countdownIcon = () => {
    switch (countdown) {
      case 5:
        return <Filter5Icon fontSize={'large'} />;
      case 4:
        return <Filter4Icon fontSize={'large'} />;
      case 3:
        return <Filter3Icon fontSize={'large'} />;
      case 2:
        return <Filter2Icon fontSize={'large'} />;
      case 1:
        return <Filter1Icon fontSize={'large'} />;
      default:
        return null;
    }
  };

  return (
    <>
      <Modal open={openPlotCardModal}>
        <ModalDialog variant={'plain'}>
          <DialogContent>
            <ModalClose onClick={() => setOpenPlotCardModal(false)} />
            <Card sx={{ width: '100%', height: '100%', display: 'flex', flex: 1, flexDirection: 'column' }} variant={'plain'}>
              <CardContent>
                <Grid container spacing={1} sx={{ flexGrow: 1 }}>
                  <Grid xs={12}>
                    <Typography level={'title-lg'} color={'primary'} sx={{ alignSelf: 'flex-start' }}>
                      Plot Name & Details
                    </Typography>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Name</FormLabel>
                      <Input
                        placeholder="Plot Name..."
                        name="plotName"
                        value={editablePlot?.plotName ?? ''}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Location</FormLabel>
                      <Input
                        placeholder="Plot Location..."
                        name="locationName"
                        value={editablePlot?.locationName ?? ''}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Country</FormLabel>
                      <Input
                        placeholder="Plot Country..."
                        name="countryName"
                        value={editablePlot?.countryName ?? ''}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Plot Shape</FormLabel>
                      <Input
                        placeholder="Plot Shape..."
                        name="plotShape"
                        value={editablePlot?.plotShape ?? 'Plot Shape'}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={8}>
                    <FormControl>
                      <FormLabel>Plot Description</FormLabel>
                      <Input
                        sx={{ display: 'flex', flex: 1, width: '100%' }}
                        placeholder="Plot Description..."
                        name="plotDescription"
                        value={editablePlot?.plotDescription ?? 'Plot Description'}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={12}>
                    <Typography level={'title-lg'} color={'primary'} sx={{ alignSelf: 'flex-start' }}>
                      Starting Coordinates
                    </Typography>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Global X-coordinate</FormLabel>
                      <Input
                        placeholder="X-coordinate..."
                        name="globalX"
                        value={isEditing ? (editablePlot?.globalX ?? '') : Number(editablePlot?.globalX ?? 0).toFixed(2)}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Global Y-coordinate</FormLabel>
                      <Input
                        placeholder="Y-coordinate..."
                        name="globalY"
                        value={isEditing ? (editablePlot?.globalY ?? '') : Number(editablePlot?.globalY ?? 0).toFixed(2)}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Global Z-coordinate</FormLabel>
                      <Input
                        placeholder="Z-coordinate..."
                        name="globalZ"
                        value={isEditing ? (editablePlot?.globalZ ?? '') : Number(editablePlot?.globalZ ?? 0).toFixed(2)}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={12}>
                    <Typography level={'title-lg'} color={'primary'} sx={{ alignSelf: 'flex-start' }}>
                      Plot Dimensions
                    </Typography>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>X Dimension</FormLabel>
                      <Input
                        placeholder="X dimension..."
                        name="dimensionX"
                        value={isEditing ? (editablePlot?.dimensionX ?? '') : Number(editablePlot?.dimensionY ?? 0).toFixed(2)}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Y Dimension</FormLabel>
                      <Input
                        placeholder="Y dimension..."
                        name="dimensionY"
                        value={isEditing ? (editablePlot?.dimensionY ?? '') : Number(editablePlot?.dimensionY ?? 0).toFixed(2)}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Plot Area</FormLabel>
                      <Input
                        placeholder="Plot Area..."
                        name="area"
                        value={isEditing ? (editablePlot?.area ?? '') : Number(editablePlot?.area ?? 0).toFixed(2)}
                        onChange={handleInputChange}
                        disabled={!isEditing}
                      />
                    </FormControl>
                  </Grid>
                  <Grid xs={12}>
                    <Typography level={'title-lg'} color={'primary'} sx={{ alignSelf: 'flex-start' }}>
                      Plot Default Units
                    </Typography>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Default Dimension Units</FormLabel>
                      <Select
                        placeholder={'Select Default Dimension Units'}
                        value={editablePlot?.defaultDimensionUnits ?? ''}
                        onChange={(_event, newValue: string | null) => {
                          if (newValue) {
                            setEditablePlot(prev => (prev ? { ...prev, defaultDimensionUnits: newValue ?? undefined } : undefined));
                          }
                        }}
                        disabled={!isEditing}
                      >
                        {unitSelectionOptions.map(unit => (
                          <Option key={unit} value={unit}>
                            {unit}
                          </Option>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Default Coordinate Units</FormLabel>
                      <Select
                        placeholder={'Select Default Coordinate Units'}
                        value={editablePlot?.defaultCoordinateUnits ?? ''}
                        onChange={(_event, newValue: string | null) => {
                          if (newValue) {
                            setEditablePlot(prev => (prev ? { ...prev, defaultCoordinateUnits: newValue || undefined } : undefined));
                          }
                        }}
                        disabled={!isEditing}
                      >
                        {unitSelectionOptions.map(unit => (
                          <Option key={unit} value={unit}>
                            {unit}
                          </Option>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid xs={4}>
                    <FormControl>
                      <FormLabel>Default Area Units</FormLabel>
                      <Select
                        placeholder={'Select Default Area Units'}
                        value={editablePlot?.defaultAreaUnits ?? ''}
                        onChange={(_event, newValue: string | null) => {
                          if (newValue) {
                            setEditablePlot(prev => (prev ? { ...prev, defaultAreaUnits: newValue } : undefined));
                          }
                        }}
                        disabled={!isEditing}
                      >
                        {areaSelectionOptions.map(unit => (
                          <Option key={unit} value={unit}>
                            {unit}
                          </Option>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid xs={6}>
                    <FormControl>
                      <FormLabel>Default DBH Units</FormLabel>
                      <Select
                        placeholder={'Select Default DBH Units'}
                        value={editablePlot?.defaultDBHUnits ?? ''}
                        onChange={(_event, newValue: string | null) => {
                          if (newValue) {
                            setEditablePlot(prev => (prev ? { ...prev, defaultDBHUnits: newValue } : undefined));
                          }
                        }}
                        disabled={!isEditing}
                      >
                        {unitSelectionOptions.map(unit => (
                          <Option key={unit} value={unit}>
                            {unit}
                          </Option>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid xs={6}>
                    <FormControl>
                      <FormLabel>Default HOM Units</FormLabel>
                      <Select
                        placeholder={'Select Default HOM Units'}
                        value={editablePlot?.defaultHOMUnits ?? ''}
                        onChange={(_event, newValue: string | null) => {
                          if (newValue) {
                            setEditablePlot(prev => (prev ? { ...prev, defaultHOMUnits: newValue } : undefined));
                          }
                        }}
                        disabled={!isEditing}
                      >
                        {unitSelectionOptions.map(unit => (
                          <Option key={unit} value={unit}>
                            {unit}
                          </Option>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>
          </DialogContent>
          <DialogActions>
            {isEditing ? (
              <>
                <Button onClick={handleSave} loading={submitting} loadingIndicator={<CircularProgress />} loadingPosition={'start'}>
                  Save Changes
                </Button>
                <Button onClick={handleEditToggle}>Cancel</Button>
              </>
            ) : (
              <Button onClick={handleEditToggle}>Edit</Button>
            )}
          </DialogActions>
        </ModalDialog>
      </Modal>
      <Portal>
        <Snackbar
          autoHideDuration={5000}
          variant="soft"
          color={snackbarMessage.includes('failed') ? 'danger' : 'success'}
          size="lg"
          invertedColors
          open={openSnackbar}
          onClose={() => {
            setOpenSnackbar(false);
            setOpenPlotCardModal(false);
            if (snackbarMessage.includes('successful')) {
              setManualReset(true); // reset only triggers if the patch command worked && the snackbar is closed
            }
            setIsEditing(false);
            setSubmitting(false);
          }}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          sx={theme => ({
            zIndex: theme.zIndex.modal + 1,
            position: 'fixed',
            background: `linear-gradient(45deg, ${theme.palette.primary[600]} 30%, ${theme.palette.primary[500]} 90%}`
          })}
        >
          <Stack direction={'row'} spacing={2} alignItems={'center'} justifyContent={'center'}>
            {countdownIcon()}
            <Typography level={'title-lg'} fontWeight={'bolder'}>
              {snackbarMessage}
            </Typography>
          </Stack>
        </Snackbar>
      </Portal>
    </>
  );
}
