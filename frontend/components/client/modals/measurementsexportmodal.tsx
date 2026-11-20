'use client';

import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormLabel,
  Modal,
  ModalDialog,
  Skeleton,
  Stack,
  Switch,
  Typography
} from '@mui/joy';
import CheckIcon from '@mui/icons-material/Check';
import GridOnIcon from '@mui/icons-material/GridOn';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import type { VisibleFilter } from '@/config/datagridhelpers';

export type MeasurementsExportType = 'csv' | 'form';

export interface MeasurementsExportModalProps {
  open: boolean;
  onClose: () => void;
  handleExport: (visibility: VisibleFilter[], exportType: MeasurementsExportType) => Promise<string>;
  initialVisibility: VisibleFilter[];
  csvHeaders: string[];
  formHeaders: string[];
  fileNameParts: { schemaName?: string; plotName?: string; plotCensusNumber?: number };
}

const CSV_MIME_TYPE = 'text/csv;charset=utf-8;';

export default function MeasurementsExportModal({
  open,
  onClose,
  handleExport,
  initialVisibility,
  csvHeaders,
  formHeaders,
  fileNameParts
}: MeasurementsExportModalProps) {
  const [exportType, setExportType] = useState<MeasurementsExportType>('csv');
  const [exportVisibility, setExportVisibility] = useState<VisibleFilter[]>(initialVisibility);
  const [isExporting, setIsExporting] = useState(false);

  const handleChipToggle = (type: VisibleFilter) => {
    setExportVisibility(prev => (prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]));
  };

  const downloadExportedData = async () => {
    setIsExporting(true);
    try {
      const data = await handleExport(exportVisibility, exportType);
      const blob = new Blob([data], { type: CSV_MIME_TYPE });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `measurements_${exportType}_${fileNameParts.schemaName ?? ''}_${fileNameParts.plotName ?? ''}_${fileNameParts.plotCensusNumber ?? 0}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Export failed:', error);
      alert(`Export failed: ${message}`);
    } finally {
      setIsExporting(false);
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <ModalDialog
        role={'dialog'}
        aria-labelledby={'exporting-data'}
        aria-describedby={'export-description'}
        sx={{
          width: '90%',
          maxWidth: '60vh',
          maxHeight: '90vh',
          overflowY: 'auto',
          p: 3
        }}
      >
        <DialogTitle id={'exporting-data'}>Exporting Data</DialogTitle>
        <DialogContent
          id={'export-description'}
          sx={{
            mt: 1,
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            overflowY: 'auto'
          }}
        >
          <Stack direction={'row'} sx={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction={'column'}>
              <Typography level={'body-md'}>Desired Format Type:</Typography>
              <Typography level={'body-sm'}>You can export data in either of these formats:</Typography>
              <Stack direction={'row'}>
                <Chip>
                  <strong>Table CSV</strong>
                </Chip>
                <Chip>
                  <strong>Form CSV</strong>
                </Chip>
              </Stack>
            </Stack>
            <Switch
              aria-label={'toggle whether to export as a CSV or a form'}
              size={'lg'}
              checked={exportType === 'csv'}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => (event.target.checked ? setExportType('csv') : setExportType('form'))}
              endDecorator={
                <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Skeleton loading={exportType !== 'csv'} variant={'circular'} width={'1.5em'} height={'1.5em'}>
                    <GridOnIcon />
                  </Skeleton>
                  <Typography level={'body-sm'}>
                    <Skeleton loading={exportType !== 'csv'}>CSV</Skeleton>
                  </Typography>
                </Stack>
              }
              startDecorator={
                <Stack direction={'column'} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Skeleton loading={exportType !== 'form'} variant={'circular'} width={'1.5em'} height={'1.5em'}>
                    <PictureAsPdfIcon />
                  </Skeleton>
                  <Typography level={'body-sm'}>
                    <Skeleton loading={exportType !== 'form'}>Form</Skeleton>
                  </Typography>
                </Stack>
              }
              sx={{
                marginRight: '1.5em',
                transform: 'scale(1.25)',
                transformOrigin: 'center'
              }}
            />
          </Stack>
          <Divider sx={{ my: 1 }} />
          <FormLabel id={'export-headers'} htmlFor={'display-export-headers'}>
            Export Headers:
          </FormLabel>
          <Box
            id={'display-export-headers'}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(125px, 0.5fr))',
              gap: '0.5rem',
              mb: 1,
              width: '100%',
              boxSizing: 'border-box'
            }}
          >
            {exportType === 'csv'
              ? csvHeaders.map((header, index) => (
                  <Chip key={index} variant={'soft'} color={'primary'}>
                    {header}
                  </Chip>
                ))
              : formHeaders.map((label, index) => (
                  <Chip key={index} variant={'soft'} color={'primary'}>
                    {label}
                  </Chip>
                ))}
          </Box>
          <Divider sx={{ my: 1 }} />
          <Typography level={'title-md'}>Please choose your desired visibility settings using the provided legend:</Typography>
          <Stack
            direction={'row'}
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              gap: 1
            }}
          >
            <Chip
              component={'button'}
              type={'button'}
              role={'checkbox'}
              aria-checked={exportVisibility.includes('valid')}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleChipToggle('valid');
                }
              }}
              color={'success'}
              size={'lg'}
              aria-label={exportVisibility.includes('valid') ? 'Rows passing validation will be exported' : "Rows passing validation won't be exported"}
              variant={exportVisibility.includes('valid') ? 'soft' : 'outlined'}
              startDecorator={exportVisibility.includes('valid') ? <CheckIcon /> : undefined}
              sx={{
                flex: 1,
                textAlign: 'center',
                whiteSpace: 'normal',
                wordBreak: 'break-word'
              }}
              onClick={() => handleChipToggle('valid')}
            >
              Rows passing validation
            </Chip>
            <Chip
              component={'button'}
              type={'button'}
              role={'checkbox'}
              aria-checked={exportVisibility.includes('errors')}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleChipToggle('errors');
                }
              }}
              color={'danger'}
              size={'lg'}
              variant={exportVisibility.includes('errors') ? 'soft' : 'outlined'}
              aria-label={exportVisibility.includes('errors') ? 'Rows failing validation will be exported' : "Rows failing validation won't be exported"}
              startDecorator={exportVisibility.includes('errors') ? <CheckIcon /> : undefined}
              sx={{
                flex: 1,
                textAlign: 'center',
                whiteSpace: 'normal',
                wordBreak: 'break-word'
              }}
              onClick={() => handleChipToggle('errors')}
            >
              Rows failing validation
            </Chip>
            <Chip
              component={'button'}
              type={'button'}
              role={'checkbox'}
              aria-checked={exportVisibility.includes('pending')}
              tabIndex={0}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleChipToggle('pending');
                }
              }}
              color={'primary'}
              size={'lg'}
              variant={exportVisibility.includes('pending') ? 'soft' : 'outlined'}
              aria-label={exportVisibility.includes('pending') ? 'Rows pending validation will be exported' : "Rows pending validation won't be exported"}
              startDecorator={exportVisibility.includes('pending') ? <CheckIcon /> : undefined}
              sx={{
                flex: 1,
                textAlign: 'center',
                whiteSpace: 'normal',
                wordBreak: 'break-word'
              }}
              onClick={() => handleChipToggle('pending')}
            >
              Rows pending validation
            </Chip>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={downloadExportedData}
            disabled={isExporting}
            startDecorator={isExporting ? <CircularProgress size="sm" /> : undefined}
            aria-label={'Export selected data/visibility and close the modal'}
          >
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
          <Button aria-label={'Cancel the operation and close the modal'} onClick={() => onClose()} disabled={isExporting}>
            Cancel
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
