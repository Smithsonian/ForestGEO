'use client';

import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Modal,
  ModalClose,
  ModalDialog,
  Stack,
  Typography
} from '@mui/joy';
import { useEffect, useMemo, useState } from 'react';
import { CENSUS_END_BEFORE_START_MESSAGE, CENSUS_START_DATE_REQUIRED_MESSAGE, type CensusDates, isCensusEndBeforeStart } from '@/config/censuswindow';

interface CensusDatesModalProps {
  open: boolean;
  censusNumber: number;
  initialStartDate: string | null;
  initialEndDate: string | null;
  isSaving: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onSave: (dates: CensusDates) => void | Promise<void>;
}

export default function CensusDatesModal({
  open,
  censusNumber,
  initialStartDate,
  initialEndDate,
  isSaving,
  errorMessage,
  onClose,
  onSave
}: CensusDatesModalProps) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setStartDate(initialStartDate ?? '');
    setEndDate(initialEndDate ?? '');
  }, [open, initialStartDate, initialEndDate]);

  const dateError = useMemo(() => {
    if (!startDate) return CENSUS_START_DATE_REQUIRED_MESSAGE;
    if (isCensusEndBeforeStart(startDate, endDate)) return CENSUS_END_BEFORE_START_MESSAGE;
    return null;
  }, [startDate, endDate]);

  const handleSave = () => {
    if (dateError) return;
    return onSave({ startDate, endDate: endDate || null });
  };

  return (
    <Modal open={open} onClose={isSaving ? undefined : onClose}>
      <ModalDialog aria-labelledby="edit-census-dates-title" sx={{ minWidth: { xs: 'calc(100vw - 32px)', sm: 480 } }}>
        {!isSaving && <ModalClose />}
        <Typography id="edit-census-dates-title" level="h2">
          Edit Census {censusNumber} Dates
        </Typography>
        <DialogContent>
          <Stack spacing={2}>
            <Typography level="body-sm">Saving does not re-run validations, so existing census date-range errors stay until validations run again.</Typography>
            {errorMessage && (
              <Alert color="danger" variant="soft">
                {errorMessage}
              </Alert>
            )}
            <FormControl required error={Boolean(dateError)}>
              <FormLabel id="edit-census-start-date-label" htmlFor="edit-census-start-date-input">
                Start date
              </FormLabel>
              <Input
                type="date"
                aria-labelledby="edit-census-start-date-label"
                value={startDate}
                onChange={event => setStartDate(event.target.value)}
                disabled={isSaving}
                slotProps={{ input: { id: 'edit-census-start-date-input' } }}
              />
              {dateError && <FormHelperText>{dateError}</FormHelperText>}
            </FormControl>
            <FormControl>
              <FormLabel id="edit-census-end-date-label" htmlFor="edit-census-end-date-input">
                End date (optional)
              </FormLabel>
              <Input
                type="date"
                aria-labelledby="edit-census-end-date-label"
                value={endDate}
                onChange={event => setEndDate(event.target.value)}
                disabled={isSaving}
                slotProps={{ input: { id: 'edit-census-end-date-input', min: startDate } }}
              />
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleSave} loading={isSaving} disabled={dateError !== null}>
            Save Dates
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
