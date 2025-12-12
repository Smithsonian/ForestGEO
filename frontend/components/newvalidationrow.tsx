'use client';

import React, { useState } from 'react';
import { useIsMounted } from '@/app/hooks/useIsMounted';
import { Box, TableCell, TableRow, TextField } from '@mui/material';
import { Cancel, Save, Code } from '@mui/icons-material';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { IconButton, Switch, Tooltip, CircularProgress, Snackbar, Button as JoyButton } from '@mui/joy';
import CodeEditor from '@/components/client/codeeditor';

interface NewValidationRowProps {
  validation: ValidationProceduresRDS;
  onValidationChange: (field: keyof ValidationProceduresRDS, value: any) => void;
  onSave: () => void;
  onCancel: () => void;
  schemaDetails: { table_name: string; column_name: string }[];
  isDarkMode: boolean;
  schema?: string;
}

const NewValidationRow: React.FC<NewValidationRowProps> = ({ validation, onValidationChange, onSave, onCancel, schemaDetails, isDarkMode, schema }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; color: 'success' | 'danger' | 'warning' }>({
    open: false,
    message: '',
    color: 'success'
  });
  const { isMountedRef } = useIsMounted();

  // Default validation query template following corequeries.sql patterns
  const defaultTemplate = `INSERT INTO cmverrors (CoreMeasurementID, ValidationErrorID)
SELECT DISTINCT cm.CoreMeasurementID, @validationProcedureID as ValidationErrorID
FROM coremeasurements cm
         JOIN census c ON cm.CensusID = c.CensusID AND c.IsActive = TRUE
         -- Add additional JOINs as needed for your validation logic
         LEFT JOIN cmverrors e ON e.CoreMeasurementID = cm.CoreMeasurementID
                                  AND e.ValidationErrorID = @validationProcedureID
WHERE cm.IsValidated IS NULL
  AND cm.IsActive = TRUE
  AND e.CoreMeasurementID IS NULL
  AND (@p_CensusID IS NULL OR cm.CensusID = @p_CensusID)
  AND (@p_PlotID IS NULL OR c.PlotID = @p_PlotID)
  -- Add your specific validation conditions here
  ;`;

  const handleUseTemplate = () => {
    onValidationChange('definition', defaultTemplate);
    setSnackbar({ open: true, message: 'Template loaded successfully', color: 'success' });
  };

  const handleSave = async () => {
    // Validate required fields
    if (!validation.procedureName || validation.procedureName.trim() === '') {
      setSnackbar({ open: true, message: 'Procedure name is required', color: 'danger' });
      return;
    }

    if (!validation.definition || validation.definition.trim() === '') {
      setSnackbar({ open: true, message: 'Validation definition (SQL query) is required', color: 'danger' });
      return;
    }

    setIsSaving(true);
    try {
      await onSave();
      if (!isMountedRef.current) return;
      setSnackbar({ open: true, message: 'Validation created successfully', color: 'success' });
    } catch (error: any) {
      console.error('Save error:', error);
      if (isMountedRef.current) {
        setSnackbar({ open: true, message: `Failed to create: ${error.message || 'Unknown error'}`, color: 'danger' });
      }
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleTestQuery = async () => {
    if (!schema) {
      setSnackbar({ open: true, message: 'No schema selected', color: 'warning' });
      return;
    }

    if (!validation.definition || validation.definition.trim() === '') {
      setSnackbar({ open: true, message: 'Please enter a query to test', color: 'warning' });
      return;
    }

    setIsTesting(true);
    try {
      const response = await fetch(`/api/validations/validate-query?schema=${schema}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: validation.definition })
      });

      if (!isMountedRef.current) return;

      if (response.ok) {
        const result = await response.json();
        if (result.isValid && result.errors.length === 0) {
          setSnackbar({ open: true, message: 'Query is valid!', color: 'success' });
        } else if (result.errors.length > 0) {
          setSnackbar({
            open: true,
            message: `Validation errors: ${result.errors.slice(0, 2).join(', ')}${result.errors.length > 2 ? '...' : ''}`,
            color: 'danger'
          });
        } else if (result.warnings.length > 0) {
          setSnackbar({
            open: true,
            message: `Warnings: ${result.warnings.slice(0, 2).join(', ')}${result.warnings.length > 2 ? '...' : ''}`,
            color: 'warning'
          });
        }
      } else {
        setSnackbar({ open: true, message: 'Failed to validate query', color: 'danger' });
      }
    } catch (error: any) {
      console.error('Test query error:', error);
      if (isMountedRef.current) {
        setSnackbar({ open: true, message: `Test failed: ${error.message || 'Unknown error'}`, color: 'danger' });
      }
    } finally {
      if (isMountedRef.current) setIsTesting(false);
    }
  };

  const isSaveDisabled = !validation.procedureName || !validation.definition || isSaving;

  return (
    <>
      <TableRow sx={{ borderBottom: 'unset', backgroundColor: 'rgba(25, 118, 210, 0.08)' }}>
        {/* Enabled Switch */}
        <TableCell>
          <Tooltip describeChild title="Toggle validation enabled state">
            <Switch
              checked={validation.isEnabled ?? false}
              onChange={e => onValidationChange('isEnabled', e.target.checked)}
              aria-label={validation.isEnabled ? 'Disable validation' : 'Enable validation'}
            />
          </Tooltip>
        </TableCell>

        {/* Procedure Name */}
        <TableCell>
          <TextField
            fullWidth
            size="small"
            placeholder="Procedure Name"
            value={validation.procedureName || ''}
            onChange={e => onValidationChange('procedureName', e.target.value)}
            required
            error={!validation.procedureName}
            helperText={!validation.procedureName ? 'Required' : ''}
            aria-label="Procedure Name"
            inputProps={{ 'aria-label': 'Procedure Name' }}
          />
        </TableCell>

        {/* Description */}
        <TableCell>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            placeholder="Description (separate items with semicolons)"
            value={validation.description || ''}
            onChange={e => onValidationChange('description', e.target.value)}
            aria-label="Description"
            inputProps={{ 'aria-label': 'Description' }}
          />
        </TableCell>

        {/* Criteria */}
        <TableCell>
          <TextField
            fullWidth
            size="small"
            multiline
            minRows={2}
            placeholder="Criteria (separate items with semicolons)"
            value={validation.criteria || ''}
            onChange={e => onValidationChange('criteria', e.target.value)}
            aria-label="Criteria"
            inputProps={{ 'aria-label': 'Criteria' }}
          />
        </TableCell>

        {/* Definition / Editor */}
        <TableCell sx={{ position: 'relative' }}>
          <Box sx={{ width: '100%', minHeight: '150px' }} aria-label="Code editor container">
            {!validation.definition && (
              <Box sx={{ mb: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <JoyButton size="sm" variant="outlined" startDecorator={<Code />} onClick={handleUseTemplate} sx={{ fontSize: '0.75rem' }}>
                  Use Template
                </JoyButton>
              </Box>
            )}
            <CodeEditor
              value={validation.definition || ''}
              height="150px"
              setValue={value => onValidationChange('definition', value)}
              schemaDetails={schemaDetails}
              isDarkMode={isDarkMode}
              readOnly={false}
              schema={schema}
              enableValidation={true}
              showFormatButton={true}
              showTestButton={true}
              testButtonLabel={isTesting ? 'Testing...' : 'Test Query'}
              onTestQuery={handleTestQuery}
              aria-label="New validation script editor"
            />
          </Box>
        </TableCell>

        {/* Action Buttons */}
        <TableCell sx={{ whiteSpace: 'normal', wordBreak: 'break-word', width: '10%' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} aria-label="Action buttons">
            <Tooltip describeChild title={isSaveDisabled ? 'Please fill required fields' : 'Save new validation'}>
              <IconButton variant="solid" onClick={handleSave} aria-label="Save new validation" disabled={isSaveDisabled}>
                {isSaving ? <CircularProgress size="sm" /> : <Save />}
              </IconButton>
            </Tooltip>
            <Tooltip describeChild title="Cancel creation">
              <IconButton variant="outlined" onClick={onCancel} aria-label="Cancel validation creation" disabled={isSaving}>
                <Cancel />
              </IconButton>
            </Tooltip>
          </Box>
        </TableCell>
      </TableRow>

      {/* Snackbar for user feedback */}
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} color={snackbar.color} variant="soft">
        {snackbar.message}
      </Snackbar>
    </>
  );
};

export default NewValidationRow;
