'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormLabel,
  Input,
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
  // Set true when this preview replaced an earlier one because the server
  // returned a 409 plan-hash drift. Triggers a banner + resets the typed-
  // confirm input so the user can't re-Apply without re-reading.
  wasRefreshed?: boolean;
}

const SEVERITY_GROUP_ORDER: Severity[] = ['destructive', 'warn', 'info'];

const SEVERITY_CHIP_COLOR: Record<Severity, 'success' | 'warning' | 'danger'> = {
  info: 'success',
  warn: 'warning',
  destructive: 'danger'
};

const SEVERITY_CHIP_LABEL: Record<Severity, string> = {
  info: 'Safe edit',
  warn: 'Warning',
  destructive: 'Destructive'
};

// Typed-confirm sentinel for destructive single-row edits. Symmetric with
// the duplicate-deletion guard in revisions match (uploadrevisionmatch).
const DESTRUCTIVE_CONFIRM_TOKEN = 'APPLY';

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

export default function PreviewDialog({ plan, onConfirm, onCancel, busy, wasRefreshed }: PreviewDialogProps) {
  const orderedEffects = sortEffectsBySeverity(plan.effects);
  const isBlocked = plan.canApply === false || (plan.errors ?? []).some(error => error.blocking);
  const isDestructive = plan.maxSeverity === 'destructive' && !isBlocked;

  const [confirmText, setConfirmText] = useState('');
  // Reset the typed-confirm box whenever the plan identity or refresh status
  // changes — drift replay must force the user to re-acknowledge.
  useEffect(() => {
    setConfirmText('');
  }, [plan.planHash, wasRefreshed]);

  const typedConfirmSatisfied = !isDestructive || confirmText.trim().toUpperCase() === DESTRUCTIVE_CONFIRM_TOKEN;

  return (
    <Modal open={true} onClose={busy ? undefined : onCancel}>
      <ModalDialog
        aria-labelledby="edit-preview-dialog-title"
        aria-describedby="edit-preview-dialog-description"
        sx={{ minWidth: { xs: '92%', sm: 640 }, maxWidth: 900, maxHeight: '85vh', overflow: 'auto' }}
      >
        <DialogTitle id="edit-preview-dialog-title">
          <Stack direction="row" spacing={1} alignItems="center">
            <span>Review changes — Measurement #{plan.targetID}</span>
            <Chip size="sm" variant="soft" color={SEVERITY_CHIP_COLOR[plan.maxSeverity]} data-testid={`edit-preview-severity-${plan.maxSeverity}`}>
              {SEVERITY_CHIP_LABEL[plan.maxSeverity]}
            </Chip>
          </Stack>
        </DialogTitle>
        <DialogContent id="edit-preview-dialog-description">
          <Stack spacing={2}>
            {wasRefreshed ? (
              <Alert color="warning" variant="soft" data-testid="edit-preview-refreshed-banner">
                The preview was refreshed because the underlying data changed. Review the new effects before applying.
              </Alert>
            ) : null}

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
                        <tr key={change.field} data-testid={`edit-preview-field-${change.field}`} aria-label={`Field change: ${change.field}`}>
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

            {isDestructive ? (
              <FormControl data-testid="edit-preview-typed-confirm">
                <FormLabel htmlFor="edit-preview-typed-confirm-input">
                  Type <strong>{DESTRUCTIVE_CONFIRM_TOKEN}</strong> to confirm this destructive change:
                </FormLabel>
                {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- FormLabel above is associated via htmlFor + id on the input slot */}
                <Input
                  size="sm"
                  value={confirmText}
                  onChange={event => setConfirmText(event.target.value)}
                  placeholder={DESTRUCTIVE_CONFIRM_TOKEN}
                  disabled={busy}
                  slotProps={{
                    input: {
                      id: 'edit-preview-typed-confirm-input',
                      'data-testid': 'edit-preview-typed-confirm-input',
                      'aria-label': 'Type APPLY to confirm'
                    }
                  }}
                />
              </FormControl>
            ) : null}

            {isBlocked ? (
              <Typography level="body-sm" color="danger" data-testid="edit-preview-blocked">
                This edit cannot be applied by your current role.
              </Typography>
            ) : null}
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
            <Button
              variant="solid"
              color={isDestructive ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={busy || isBlocked || !typedConfirmSatisfied}
              loading={busy}
              data-testid="edit-preview-apply"
            >
              Apply
            </Button>
          </Stack>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
}
