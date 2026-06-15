'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, DialogContent, DialogTitle, Modal, ModalDialog, Option, Select, Stack, Typography } from '@mui/joy';
import { SourceFormat } from '@/config/macros/formdetails';
import { canonicalFieldsFor } from '@/lib/column-mapping/fields';
import { validateMapping } from '@/lib/column-mapping/mapping';
import { ColumnMapping, ColumnMappingField, SourceMetadata } from '@/lib/column-mapping/types';

interface ColumnMappingDialogProps {
  open: boolean;
  format: SourceFormat;
  /** Name of the file this mapping applies to; displayed under the title for multi-file batches. */
  fileName?: string;
  metadata: SourceMetadata;
  mapping: ColumnMapping;
  /** Server-side rejection of the last applied mapping; rendered so the user knows what to fix. */
  serverError?: string;
  onApply: (mapping: ColumnMapping) => void;
  onClose: () => void;
}

function sourceColumnsFromMetadata(metadata: SourceMetadata): string[] {
  return metadata.format === SourceFormat.csv ? metadata.headers : Array.from(new Set(metadata.sheets.flatMap(s => s.columns)));
}

function setFieldSources(mapping: ColumnMapping, canonicalField: string, sources: string[]): ColumnMapping {
  const fields: ColumnMappingField[] = mapping.fields.map(f => (f.canonicalField === canonicalField ? { ...f, sourceColumns: sources } : f));
  return { ...mapping, fields };
}

export default function ColumnMappingDialog({ open, format, fileName, metadata, mapping, serverError, onApply, onClose }: ColumnMappingDialogProps) {
  // The dialog edits a local draft so nothing reaches the parent until Apply. The draft is keyed
  // on fileName + headerSignature (not prop identity) because hosts may rebuild the mapping prop
  // on every render; reseeding on identity alone would clobber in-progress edits.
  const [draft, setDraft] = useState<ColumnMapping>(mapping);
  const seededKey = useRef<string | null>(null);
  const openKey = open ? `${fileName ?? ''}::${mapping.headerSignature ?? ''}` : null;
  useEffect(() => {
    if (open && openKey !== seededKey.current) {
      setDraft(mapping);
      seededKey.current = openKey;
    } else if (!open) {
      seededKey.current = null;
    }
  }, [open, openKey, mapping]);

  const defs = useMemo(() => canonicalFieldsFor(format), [format]);
  const sourceColumns = useMemo(() => sourceColumnsFromMetadata(metadata), [metadata]);
  const validation = useMemo(() => validateMapping(draft, metadata), [draft, metadata]);

  const sheetNames = metadata.format === SourceFormat.arcgis_xlsx ? metadata.sheets.map(s => s.name) : [];

  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog data-testid="column-mapping-dialog" sx={{ minWidth: 640, maxWidth: 820 }}>
        <DialogTitle>Map your columns</DialogTitle>
        {fileName && (
          <Typography level="body-sm" textColor="text.tertiary">
            File: {fileName}
          </Typography>
        )}
        <DialogContent>
          <Typography level="body-sm" sx={{ mb: 1 }}>
            Match each column in your file to the field the app expects. Required fields must be mapped before you can continue.
          </Typography>

          {serverError && (
            <Alert color="danger" sx={{ mb: 2 }}>
              {serverError}
            </Alert>
          )}

          {metadata.format === SourceFormat.arcgis_xlsx && (
            <Box sx={{ mb: 2 }}>
              <Typography level="title-sm">Sheet roles</Typography>
              {(['trees', 'stems'] as const).map(role => (
                <Stack key={role} direction="row" alignItems="center" spacing={1} sx={{ my: 0.5 }}>
                  <Typography sx={{ width: 80 }}>{role}</Typography>
                  <Select
                    data-testid={`mapping-sheet-role-select-${role}`}
                    placeholder={`Select ${role} sheet`}
                    value={(role === 'trees' ? draft.sheetRoles?.treesSheetName : draft.sheetRoles?.stemsSheetName) ?? null}
                    onChange={(_e, v) =>
                      setDraft({
                        ...draft,
                        sheetRoles: {
                          ...draft.sheetRoles,
                          ...(role === 'trees' ? { treesSheetName: v ?? undefined } : { stemsSheetName: v ?? undefined })
                        }
                      })
                    }
                  >
                    {sheetNames.map(n => (
                      <Option key={n} value={n}>
                        {n}
                      </Option>
                    ))}
                  </Select>
                </Stack>
              ))}
            </Box>
          )}

          <Stack spacing={0.5}>
            {defs.map(def => {
              const field = draft.fields.find(f => f.canonicalField === def.canonicalField);
              const selected = field?.sourceColumns ?? [];
              const unmappedRequired = def.required && selected.length === 0;
              return (
                <Stack
                  key={def.canonicalField}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  data-testid={`mapping-row-${def.canonicalField}`}
                  sx={{ py: 0.75, borderTop: '1px solid', borderColor: 'divider', bgcolor: unmappedRequired ? 'danger.softBg' : 'transparent' }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Select
                      data-testid={`mapping-source-select-${def.canonicalField}`}
                      multiple={def.multiSource}
                      placeholder={unmappedRequired ? 'Choose a column' : 'Unmapped'}
                      value={def.multiSource ? selected : (selected[0] ?? null)}
                      onChange={(_e, v) => setDraft(setFieldSources(draft, def.canonicalField, def.multiSource ? (v as string[]) : v ? [v as string] : []))}
                    >
                      {sourceColumns.map(c => (
                        <Option key={c} value={c}>
                          {c}
                        </Option>
                      ))}
                    </Select>
                  </Box>
                  <Typography sx={{ width: 24, textAlign: 'center' }}>→</Typography>
                  <Box sx={{ flex: 1.2 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography level="title-sm">{def.canonicalField}</Typography>
                      <Chip size="sm" color={def.required ? 'danger' : 'neutral'}>
                        {def.required ? 'required' : 'optional'}
                      </Chip>
                    </Stack>
                    {def.explanation && (
                      <Typography level="body-xs" textColor="text.tertiary">
                        {def.explanation}
                      </Typography>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Stack>

          {!validation.valid && (
            <Alert color="danger" sx={{ mt: 2 }}>
              {validation.missingRequired.length > 0 && <span>Unmapped required: {validation.missingRequired.join(', ')}. </span>}
              {validation.missingSourceColumns.length > 0 && <span>Missing columns: {validation.missingSourceColumns.join(', ')}. </span>}
              {validation.duplicateSourceColumns.length > 0 && (
                <span>Mapped to more than one field: {validation.duplicateSourceColumns.join(', ')}. Each column can feed only one field. </span>
              )}
              {validation.unknownFields.length > 0 && <span>Unknown fields (remove these): {validation.unknownFields.join(', ')}. </span>}
              {(validation.missingSheetRoles?.length ?? 0) > 0 && <span>Select sheet roles: {validation.missingSheetRoles!.join(', ')}. </span>}
              {validation.sheetRoleConflict && <span>Trees and stems must be different sheets.</span>}
            </Alert>
          )}
          {validation.ignoredSourceColumns.length > 0 && (
            <Typography level="body-xs" textColor="text.tertiary" sx={{ mt: 1 }}>
              Ignored (unused) columns: {validation.ignoredSourceColumns.join(', ')}
            </Typography>
          )}

          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
            <Button data-testid="mapping-cancel" variant="plain" color="neutral" onClick={onClose}>
              Cancel
            </Button>
            <Button data-testid="mapping-apply" disabled={!validation.valid} onClick={() => onApply(draft)}>
              Apply mapping
            </Button>
          </Stack>
        </DialogContent>
      </ModalDialog>
    </Modal>
  );
}
