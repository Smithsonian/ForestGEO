'use client';

import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
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
  Sheet,
  Stack,
  Typography
} from '@mui/joy';
import { BulkEditPlan, Effect, PreviewError, SEVERITY_RANK, Severity, SpeciesCorrectionGroup } from '@/config/editplan/types';
import EditEffectRow from './editeffectrow';

interface ImpactSummaryProps {
  bulkPlan: BulkEditPlan;
  /** Rows the confirm will write: actionable matched + included new + invalid (recorded as failed). */
  selectedRowCount: number;
  newRowCount?: number;
  includeNewRows?: boolean;
  onIncludeNewRowsChange?: (includeNewRows: boolean) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}

const SEVERITY_GROUP_ORDER: Severity[] = ['destructive', 'warn', 'info'];
const MAX_DISPLAYED_BLOCKING_ERRORS = 5;

export const SELECTED_ROW_COUNT_EXPLANATION =
  'This number counts the updates and deduplications, the new rows if you include them, and the invalid rows that will be recorded as failed measurements.';

export function formatIncludeNewRowsLabel(newRowCount: number): string {
  return `Also insert ${newRowCount} new row${newRowCount === 1 ? '' : 's'}`;
}

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

interface SpeciesCorrectionGroupMemberCounts {
  requestedMemberCount: number;
  siblingMemberCount: number;
  additionalAffectedMeasurementCount: number;
}

/**
 * Splits a #427 species-correction group's membership into the three
 * distinct counts the preview must show separately: rows in THIS batch that
 * requested the correction, other submitted rows for the same tree pulled
 * in by membership, and measurements the correction affects that the batch
 * did not submit at all (never summed into "requested").
 */
function summarizeSpeciesCorrectionGroupMembers(group: SpeciesCorrectionGroup): SpeciesCorrectionGroupMemberCounts {
  const requestedMemberCount = group.members.filter(member => member.requestedCorrection).length;
  const siblingMemberCount = group.members.length - requestedMemberCount;
  const submittedCoreMeasurementIDs = new Set(group.members.map(member => member.coreMeasurementID));
  const additionalAffectedMeasurementCount = group.affectedCoreMeasurementIDs.filter(
    coreMeasurementID => !submittedCoreMeasurementIDs.has(coreMeasurementID)
  ).length;
  return { requestedMemberCount, siblingMemberCount, additionalAffectedMeasurementCount };
}

function isRoleForbiddenError(error: PreviewError): boolean {
  return error.kind === 'RoleForbiddenField';
}

export default function ImpactSummary({
  bulkPlan,
  selectedRowCount,
  newRowCount = 0,
  includeNewRows = false,
  onIncludeNewRowsChange,
  onConfirm,
  onCancel,
  busy
}: ImpactSummaryProps) {
  const stats = useMemo(() => tallyRowStatuses(bulkPlan), [bulkPlan]);
  const orderedEffects = useMemo(() => sortEffectsBySeverity(bulkPlan.aggregateEffects), [bulkPlan.aggregateEffects]);

  // Split blocking errors by kind so the banner describes the actual reason
  // instead of always claiming a role failure. A TreeStemResolution group
  // conflict (e.g. group_species_conflict) is never a role problem and must
  // never be rendered under the role-blocked copy.
  const blockingErrors = useMemo(() => (bulkPlan.errors ?? []).filter(error => error.blocking), [bulkPlan.errors]);
  const roleBlockingErrors = useMemo(() => blockingErrors.filter(isRoleForbiddenError), [blockingErrors]);
  const otherBlockingErrors = useMemo(() => blockingErrors.filter(error => !isRoleForbiddenError(error)), [blockingErrors]);

  const speciesCorrectionGroups = bulkPlan.speciesCorrectionGroups ?? [];
  const hasSpeciesCorrections = speciesCorrectionGroups.length > 0;
  const speciesCorrectionMemberCounts = useMemo(() => speciesCorrectionGroups.map(summarizeSpeciesCorrectionGroupMembers), [speciesCorrectionGroups]);

  const typedConfirmRequired = bulkPlan.maxSeverity === 'destructive';
  const expectedConfirmPhrase = `APPLY ${selectedRowCount}`;
  const [confirmInput, setConfirmInput] = useState('');
  const typedConfirmPassed = !typedConfirmRequired || confirmInput.trim() === expectedConfirmPhrase;
  const isBlocked = bulkPlan.canApply === false || blockingErrors.length > 0;
  // canApply can be false with zero blocking errors surfaced (e.g. a
  // server-side gate with no accompanying PreviewError) — that must still
  // explain itself as blocked, but as a generic non-role reason, never as a
  // fabricated role claim.
  const hasUnexplainedBlock = isBlocked && otherBlockingErrors.length === 0 && roleBlockingErrors.length === 0;

  const applyDisabled = busy || !typedConfirmPassed || isBlocked || selectedRowCount === 0;

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
              {hasSpeciesCorrections ? (
                <Chip color="warning" variant="soft" data-testid="impact-summary-species-correction-count">
                  Species corrections: {speciesCorrectionGroups.length}
                </Chip>
              ) : null}
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

            {hasSpeciesCorrections ? (
              <>
                <Divider />
                <Box data-testid="impact-summary-species-corrections">
                  <Typography level="title-sm" sx={{ marginBottom: 0.5 }}>
                    Tree-wide species corrections
                  </Typography>
                  <Typography level="body-sm" sx={{ marginBottom: 1 }}>
                    Each correction below updates the species for the whole tree across the census, including measurements not included in this upload.
                  </Typography>
                  <Stack spacing={1.5}>
                    {speciesCorrectionGroups.map((group, index) => {
                      const memberCounts = speciesCorrectionMemberCounts[index];
                      return (
                        <Sheet
                          key={`${group.treeID}-${group.censusID}`}
                          variant="outlined"
                          sx={{ padding: 1.5, borderRadius: 'sm' }}
                          data-testid={`impact-summary-species-correction-${group.treeID}-${group.censusID}`}
                        >
                          <Stack spacing={0.25}>
                            <Typography level="body-sm" fontWeight="lg">
                              Tree {group.correction.treeTag} (ID {group.treeID})
                            </Typography>
                            <Typography level="body-sm">
                              {group.correction.oldSpeciesCode} → {group.correction.newSpeciesCode}
                            </Typography>
                            <Typography level="body-sm">
                              Active stems: {group.correction.activeStemCount} · Inactive stems: {group.correction.inactiveStemCount}
                            </Typography>
                            <Typography level="body-sm">
                              Active measurements: {group.correction.activeMeasurementCount} · Inactive measurements:{' '}
                              {group.correction.inactiveMeasurementCount}
                            </Typography>
                            <Typography level="body-sm">Submitted rows requesting this correction: {memberCounts.requestedMemberCount}</Typography>
                            <Typography level="body-sm">Other submitted rows for this tree: {memberCounts.siblingMemberCount}</Typography>
                            <Typography level="body-sm">
                              Additional measurements affected but not submitted: {memberCounts.additionalAffectedMeasurementCount}
                            </Typography>
                          </Stack>
                        </Sheet>
                      );
                    })}
                  </Stack>
                </Box>
              </>
            ) : null}

            {roleBlockingErrors.length > 0 ? (
              <Typography level="body-sm" color="danger" data-testid="impact-summary-blocked">
                This revision cannot be applied by your current role.
              </Typography>
            ) : null}

            {otherBlockingErrors.length > 0 || hasUnexplainedBlock ? (
              <Stack spacing={0.5} data-testid="impact-summary-blocking-errors">
                <Typography level="body-sm" fontWeight="lg" color="danger">
                  This revision cannot be applied:
                </Typography>
                {otherBlockingErrors.length > 0 ? (
                  <>
                    {otherBlockingErrors.slice(0, MAX_DISPLAYED_BLOCKING_ERRORS).map((error, index) => (
                      <Typography key={`${error.kind}-${error.rowIndex ?? 'none'}-${index}`} level="body-sm" color="danger">
                        {typeof error.rowIndex === 'number' ? `Row ${error.rowIndex + 1}: ` : ''}
                        {error.message}
                      </Typography>
                    ))}
                    {otherBlockingErrors.length > MAX_DISPLAYED_BLOCKING_ERRORS ? (
                      <Typography level="body-sm" color="neutral">
                        +{otherBlockingErrors.length - MAX_DISPLAYED_BLOCKING_ERRORS} more
                      </Typography>
                    ) : null}
                  </>
                ) : (
                  <Typography level="body-sm" color="danger">
                    This revision cannot be applied in its current state.
                  </Typography>
                )}
              </Stack>
            ) : null}

            {newRowCount > 0 ? (
              // eslint-disable-next-line jsx-a11y/control-has-associated-label -- Joy UI Checkbox `label` prop renders an associated <label> at runtime
              <Checkbox
                label={formatIncludeNewRowsLabel(newRowCount)}
                checked={includeNewRows}
                onChange={event => onIncludeNewRowsChange?.(event.target.checked)}
                disabled={busy}
                data-testid="impact-summary-include-new-rows"
              />
            ) : null}

            {typedConfirmRequired ? (
              <FormControl data-testid="impact-summary-typed-confirm">
                <FormLabel htmlFor="impact-summary-typed-confirm-input">Confirm destructive apply</FormLabel>
                <Input
                  aria-label="Confirm destructive apply"
                  slotProps={{ input: { id: 'impact-summary-typed-confirm-input' } }}
                  placeholder={expectedConfirmPhrase}
                  value={confirmInput}
                  onChange={event => setConfirmInput(event.target.value)}
                  disabled={busy}
                  data-testid="impact-summary-typed-confirm-input"
                />
                <FormHelperText>Type {expectedConfirmPhrase} to enable the apply button.</FormHelperText>
                <Typography level="body-xs" data-testid="impact-summary-selected-count-explanation">
                  {SELECTED_ROW_COUNT_EXPLANATION}
                </Typography>
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
