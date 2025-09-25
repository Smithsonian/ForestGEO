'use client';

import React from 'react';
import { Box, TableCell, TableRow, TextField, Button } from '@mui/material';
import { Cancel, Save, Code } from '@mui/icons-material';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { IconButton, Switch, Tooltip } from '@mui/joy';
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
  };

  return (
    <TableRow sx={{ borderBottom: 'unset', backgroundColor: 'rgba(25, 118, 210, 0.08)' }}>
      {/* Enabled Switch */}
      <TableCell>
        <Tooltip describeChild title="Toggle validation enabled state">
          <Switch
            checked={validation.isEnabled}
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
              <Button size="small" variant="outlined" startIcon={<Code />} onClick={handleUseTemplate} sx={{ fontSize: '0.75rem' }}>
                Use Template
              </Button>
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
            aria-label="New validation script editor"
          />
        </Box>
      </TableCell>

      {/* Action Buttons */}
      <TableCell sx={{ whiteSpace: 'normal', wordBreak: 'break-word', width: '10%' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }} aria-label="Action buttons">
          <Tooltip describeChild title="Save new validation">
            <IconButton variant="solid" onClick={onSave} aria-label="Save new validation" disabled={!validation.procedureName || !validation.definition}>
              <Save />
            </IconButton>
          </Tooltip>
          <Tooltip describeChild title="Cancel creation">
            <IconButton variant="outlined" onClick={onCancel} aria-label="Cancel validation creation">
              <Cancel />
            </IconButton>
          </Tooltip>
        </Box>
      </TableCell>
    </TableRow>
  );
};

export default NewValidationRow;
