'use client';

import {
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
  Textarea,
  Typography
} from '@mui/joy';
import { useEffect, useMemo, useState } from 'react';

export interface CensusCreationDetails {
  description?: string;
  startDate: string;
  endDate?: string;
}

interface CensusCreationModalProps {
  open: boolean;
  censusNumber: number;
  plotName?: string;
  isCreating: boolean;
  onClose: () => void;
  onCreate: (details: CensusCreationDetails) => void | Promise<void>;
}

const toDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function CensusCreationModal({ open, censusNumber, plotName, isCreating, onClose, onCreate }: CensusCreationModalProps) {
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(toDateInputValue(new Date()));
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!open) return;
    setDescription('');
    setStartDate(toDateInputValue(new Date()));
    setEndDate('');
  }, [open]);

  const dateError = useMemo(() => {
    if (!startDate) return 'Start date is required.';
    if (endDate && endDate < startDate) return 'End date cannot be before the start date.';
    return '';
  }, [endDate, startDate]);

  const handleCreate = () => {
    if (dateError) return;
    return onCreate({
      description: description.trim() || undefined,
      startDate,
      endDate: endDate || undefined
    });
  };

  return (
    <Modal open={open} onClose={isCreating ? undefined : onClose}>
      <ModalDialog aria-labelledby="create-census-title" sx={{ minWidth: { xs: 'calc(100vw - 32px)', sm: 480 } }}>
        {!isCreating && <ModalClose />}
        <Typography id="create-census-title" level="h2">
          Start Census {censusNumber}
        </Typography>
        <DialogContent>
          <Stack spacing={2}>
            <Typography level="body-sm">
              This will create a new census{plotName ? ` for ${plotName}` : ''} and copy the current census reference data. No census is created until you
              confirm.
            </Typography>
            <FormControl required error={Boolean(dateError)}>
              <FormLabel id="census-start-date-label" htmlFor="census-start-date-input">
                Start date
              </FormLabel>
              <Input
                type="date"
                aria-labelledby="census-start-date-label"
                value={startDate}
                onChange={event => setStartDate(event.target.value)}
                disabled={isCreating}
                slotProps={{ input: { id: 'census-start-date-input' } }}
              />
              {dateError && <FormHelperText>{dateError}</FormHelperText>}
            </FormControl>
            <FormControl>
              <FormLabel id="census-end-date-label" htmlFor="census-end-date-input">
                End date (optional)
              </FormLabel>
              <Input
                type="date"
                aria-labelledby="census-end-date-label"
                value={endDate}
                onChange={event => setEndDate(event.target.value)}
                disabled={isCreating}
                slotProps={{ input: { id: 'census-end-date-input', min: startDate } }}
              />
            </FormControl>
            <FormControl>
              <FormLabel id="census-description-label" htmlFor="census-description-input">
                Description (optional)
              </FormLabel>
              <Textarea
                minRows={3}
                aria-labelledby="census-description-label"
                value={description}
                onChange={event => setDescription(event.target.value)}
                disabled={isCreating}
                slotProps={{ textarea: { id: 'census-description-input' } }}
              />
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreate} loading={isCreating} disabled={Boolean(dateError)}>
            Create Census {censusNumber}
          </Button>
          <Button variant="plain" color="neutral" onClick={onClose} disabled={isCreating}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
