'use client';

import React from 'react';
import {
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Modal,
  ModalDialog,
  Sheet,
  Stack,
  Table,
  Typography
} from '@mui/joy';
import { EditPlan, Effect, SEVERITY_RANK, Severity } from '@/config/editplan/types';
import EditEffectRow from './editeffectrow';

interface PreviewDialogProps {
  plan: EditPlan;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}

const SEVERITY_GROUP_ORDER: Severity[] = ['destructive', 'warn', 'info'];

function sortEffectsBySeverity(effects: Effect[]): Effect[] {
  return [...effects].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value === '' ? '""' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function PreviewDialog({ plan, onConfirm, onCancel, busy }: PreviewDialogProps) {
  const orderedEffects = sortEffectsBySeverity(plan.effects);

  return (
    <Modal open={true} onClose={busy ? undefined : onCancel}>
      <ModalDialog
        aria-labelledby="edit-preview-dialog-title"
        aria-describedby="edit-preview-dialog-description"
        sx={{ minWidth: { xs: '92%', sm: 640 }, maxWidth: 900, maxHeight: '85vh', overflow: 'auto' }}
      >
        <DialogTitle id="edit-preview-dialog-title">Review changes — Measurement #{plan.targetID}</DialogTitle>
        <DialogContent id="edit-preview-dialog-description">
          <Stack spacing={2}>
            <Box>
              <Typography level="title-sm" sx={{ marginBottom: 1 }}>
                Field changes
              </Typography>
              {plan.fieldChanges.length === 0 ? (
                <Typography level="body-sm">No field changes.</Typography>
              ) : (
                <Sheet variant="outlined" sx={{ borderRadius: 'sm', overflow: 'auto' }}>
                  <Table size="sm" data-testid="edit-preview-field-diff">
                    <thead>
                      <tr>
                        <th style={{ width: '30%' }}>Field</th>
                        <th>From</th>
                        <th>To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.fieldChanges.map(change => (
                        <tr key={change.field} data-testid={`edit-preview-field-${change.field}`}>
                          <td>
                            <Typography level="body-sm" sx={{ fontWeight: 600 }}>
                              {change.field}
                            </Typography>
                          </td>
                          <td>
                            <Typography level="body-sm" sx={{ fontFamily: 'monospace' }}>
                              {formatValue(change.from)}
                            </Typography>
                          </td>
                          <td>
                            <Typography level="body-sm" sx={{ fontFamily: 'monospace' }}>
                              {formatValue(change.to)}
                            </Typography>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </Sheet>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography level="title-sm" sx={{ marginBottom: 1 }}>
                Effects
              </Typography>
              {orderedEffects.length === 0 ? (
                <Typography level="body-sm">No downstream effects detected.</Typography>
              ) : (
                <Stack spacing={1} data-testid="edit-preview-effects">
                  {SEVERITY_GROUP_ORDER.flatMap(severity =>
                    orderedEffects.filter(effect => effect.severity === severity).map(effect => <EditEffectRow key={effect.id} effect={effect} />)
                  )}
                </Stack>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
            Undo available via Recent Changes or row menu
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" color="neutral" onClick={onCancel} disabled={busy} data-testid="edit-preview-cancel">
              Cancel
            </Button>
            <Button variant="solid" color="primary" onClick={onConfirm} disabled={busy} loading={busy} data-testid="edit-preview-apply">
              Apply
            </Button>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
