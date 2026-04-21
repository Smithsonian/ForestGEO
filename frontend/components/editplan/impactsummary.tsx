'use client';

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Modal,
  ModalDialog,
  Stack,
  Typography
} from '@mui/joy';
import { BulkEditPlan, Effect, SEVERITY_RANK, Severity } from '@/config/editplan/types';
import EditEffectRow from './editeffectrow';

interface ImpactSummaryProps {
  bulkPlan: BulkEditPlan;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}

const SEVERITY_GROUP_ORDER: Severity[] = ['destructive', 'warn', 'info'];

function sortEffectsBySeverity(effects: Effect[]): Effect[] {
  return [...effects].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function tallyRowStatuses(bulkPlan: BulkEditPlan): { matched: number; newRows: number; unchanged: number; invalid: number } {
  return bulkPlan.rowPlans.reduce(
    (acc, rowPlan) => {
      if (rowPlan.status === 'matched') acc.matched += 1;
      else if (rowPlan.status === 'new') acc.newRows += 1;
      else if (rowPlan.status === 'unchanged') acc.unchanged += 1;
      else if (rowPlan.status === 'invalid') acc.invalid += 1;
      return acc;
    },
    { matched: 0, newRows: 0, unchanged: 0, invalid: 0 }
  );
}

export default function ImpactSummary({ bulkPlan, onConfirm, onCancel, busy }: ImpactSummaryProps) {
  const stats = useMemo(() => tallyRowStatuses(bulkPlan), [bulkPlan]);
  const orderedEffects = useMemo(() => sortEffectsBySeverity(bulkPlan.aggregateEffects), [bulkPlan.aggregateEffects]);

  const typedConfirmRequired = bulkPlan.maxSeverity === 'destructive';
  const expectedConfirmPhrase = `APPLY ${bulkPlan.rowCount}`;
  const [confirmInput, setConfirmInput] = useState('');
  const typedConfirmPassed = !typedConfirmRequired || confirmInput.trim() === expectedConfirmPhrase;

  const applyDisabled = busy || !typedConfirmPassed;

  return (
    <Modal open={true} onClose={busy ? undefined : onCancel}>
      <ModalDialog
        aria-labelledby="impact-summary-dialog-title"
        aria-describedby="impact-summary-dialog-description"
        sx={{ minWidth: { xs: '92%', sm: 720 }, maxWidth: 960, maxHeight: '85vh', overflow: 'auto' }}
      >
        <DialogTitle id="impact-summary-dialog-title">Review bulk revision — {bulkPlan.rowCount} rows</DialogTitle>
        <DialogContent id="impact-summary-dialog-description">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} flexWrap="wrap" data-testid="impact-summary-stats">
              <Chip color="primary" variant="soft">
                Matched: {stats.matched}
              </Chip>
              <Chip color="success" variant="soft">
                New: {stats.newRows}
              </Chip>
              <Chip color="neutral" variant="soft">
                Unchanged: {stats.unchanged}
              </Chip>
              <Chip color="danger" variant="soft">
                Invalid: {stats.invalid}
              </Chip>
            </Stack>

            <Divider />

            <Box>
              <Typography level="title-sm" sx={{ marginBottom: 1 }}>
                Aggregate effects
              </Typography>
              {orderedEffects.length === 0 ? (
                <Typography level="body-sm">No downstream effects detected.</Typography>
              ) : (
                <Stack spacing={1} data-testid="impact-summary-effects">
                  {SEVERITY_GROUP_ORDER.flatMap(severity =>
                    orderedEffects.filter(effect => effect.severity === severity).map(effect => <EditEffectRow key={effect.id} effect={effect} />)
                  )}
                </Stack>
              )}
            </Box>

            {typedConfirmRequired ? (
              <FormControl data-testid="impact-summary-typed-confirm">
                <FormLabel>Confirm destructive apply</FormLabel>
                <Input
                  placeholder={expectedConfirmPhrase}
                  value={confirmInput}
                  onChange={event => setConfirmInput(event.target.value)}
                  disabled={busy}
                  data-testid="impact-summary-typed-confirm-input"
                />
                <FormHelperText>Type {expectedConfirmPhrase} to enable the apply button.</FormHelperText>
              </FormControl>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" color="neutral" onClick={onCancel} disabled={busy} data-testid="impact-summary-cancel">
            Cancel
          </Button>
          <Button
            variant="solid"
            color={typedConfirmRequired ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={applyDisabled}
            loading={busy}
            data-testid="impact-summary-apply"
          >
            Apply
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
