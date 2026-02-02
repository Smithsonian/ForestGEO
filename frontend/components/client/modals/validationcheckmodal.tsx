'use client';

import React from 'react';
import { Box, Button, DialogContent, DialogTitle, Modal, ModalClose, ModalDialog, Stack, Typography, Chip } from '@mui/joy';

interface ValidationCheckDetails {
  failedMeasurementID: number;
  tag?: string;
  stemTag?: string;
  currentFailureReasons?: string | null;
  originalFailureReasons?: string | null;
  isReady: boolean;
}

interface ValidationCheckResults {
  totalRows: number;
  readyCount: number;
  failingCount: number;
  validatedAt?: string;
  details: ValidationCheckDetails[];
}

interface ValidationCheckModalProps {
  open: boolean;
  onClose: () => void;
  results: ValidationCheckResults | null;
}

export default function ValidationCheckModal({ open, onClose, results }: ValidationCheckModalProps) {
  const readyRows = results?.details?.filter(row => row.isReady) ?? [];
  const failingRows = results?.details?.filter(row => !row.isReady) ?? [];

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog sx={{ minWidth: { xs: '90%', sm: 700 }, maxHeight: '80vh', overflow: 'auto' }}>
        <ModalClose />
        <DialogTitle>Validation Check</DialogTitle>
        <DialogContent>
          {!results ? (
            <Typography level="body-sm">No validation results available.</Typography>
          ) : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Chip color="success" variant="soft">
                  Ready: {results.readyCount}
                </Chip>
                <Chip color="danger" variant="soft">
                  Still failing: {results.failingCount}
                </Chip>
                <Chip color="neutral" variant="soft">
                  Total: {results.totalRows}
                </Chip>
                {results.validatedAt ? (
                  <Typography level="body-sm" sx={{ marginLeft: 'auto' }}>
                    Validated: {results.validatedAt}
                  </Typography>
                ) : null}
              </Stack>

              <Box>
                <Typography level="title-sm" sx={{ marginBottom: 1 }}>
                  Ready for reingestion
                </Typography>
                {readyRows.length === 0 ? (
                  <Typography level="body-sm">No rows are ready yet.</Typography>
                ) : (
                  <Stack spacing={1}>
                    {readyRows.map(row => (
                      <Box key={row.failedMeasurementID} sx={{ padding: 1, borderRadius: 6, backgroundColor: 'neutral.softBg' }}>
                        <Typography level="body-sm">
                          #{row.failedMeasurementID} - Tag: {row.tag ?? 'null'}, Stem: {row.stemTag ?? 'null'}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>

              <Box>
                <Typography level="title-sm" sx={{ marginBottom: 1 }}>
                  Still failing
                </Typography>
                {failingRows.length === 0 ? (
                  <Typography level="body-sm">No remaining failures.</Typography>
                ) : (
                  <Stack spacing={1}>
                    {failingRows.map(row => (
                      <Box key={row.failedMeasurementID} sx={{ padding: 1, borderRadius: 6, backgroundColor: 'danger.softBg' }}>
                        <Typography level="body-sm">
                          #{row.failedMeasurementID} - Tag: {row.tag ?? 'null'}, Stem: {row.stemTag ?? 'null'}
                        </Typography>
                        <Typography level="body-xs" sx={{ marginTop: 0.5 }}>
                          Current: {row.currentFailureReasons ?? 'Unknown'}
                        </Typography>
                        {row.originalFailureReasons ? (
                          <Typography level="body-xs" sx={{ marginTop: 0.5 }}>
                            Original: {row.originalFailureReasons}
                          </Typography>
                        ) : null}
                      </Box>
                    ))}
                  </Stack>
                )}
              </Box>

              <Stack direction="row" spacing={2} justifyContent="flex-end">
                <Button variant="solid" onClick={onClose}>
                  Close
                </Button>
              </Stack>
            </Stack>
          )}
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}
