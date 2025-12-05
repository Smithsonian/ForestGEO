// validationrow.tsx
'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Box, TableCell, TableRow } from '@mui/material';
import { Cancel, Edit, Save, Download } from '@mui/icons-material';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { Chip, IconButton, List, ListItem, Switch, Textarea, Tooltip, CircularProgress, Snackbar } from '@mui/joy';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CodeEditor from '@/components/client/codeeditor';
import ConfirmationDialog from '@/components/client/modals/confirmationdialog';

function useDebouncedCallback(callback: (...args: any[]) => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (...args: any[]) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  };
}

interface ValidationRowProps {
  validation: ValidationProceduresRDS;
  onSaveChanges: (validation: ValidationProceduresRDS) => Promise<void>;
  isDarkMode: boolean;
  expandedValidationID: number | null;
  replacements: { schema: string | undefined; currentPlotID: number | undefined; currentCensusID: number | undefined };
  handleExpandClick: (validationID: number) => void;
  schemaDetails: { table_name: string; column_name: string }[];
}

const ValidationRow: React.FC<ValidationRowProps> = ({
  validation,
  onSaveChanges,
  isDarkMode,
  expandedValidationID,
  handleExpandClick,
  replacements,
  schemaDetails
}) => {
  const memoizedSchemaDetails = useMemo(() => schemaDetails, [schemaDetails]);
  const [scriptContent, setScriptContent] = useState(validation.definition);
  const debouncedSetScriptContent = useDebouncedCallback(value => setScriptContent(value ?? ''), 300);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showConfirmToggle, setShowConfirmToggle] = useState(false);
  const [pendingToggleValue, setPendingToggleValue] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; color: 'success' | 'danger' | 'warning' }>({
    open: false,
    message: '',
    color: 'success'
  });
  const originalScriptContent = useRef<string>(validation.definition ?? '');
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync script content when validation changes
  React.useEffect(() => {
    if (!isEditing) {
      setScriptContent(validation.definition);
      originalScriptContent.current = validation.definition ?? '';
    }
  }, [validation.definition, isEditing]);

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    originalScriptContent.current = scriptContent ?? '';
    setIsEditing(true);
    handleExpandClick(validation.validationID!); // Ensure expansion happens
  };

  const handleCancelChanges = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScriptContent(originalScriptContent.current);
    setIsEditing(false);
  };

  const handleSaveChanges = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // Validate required fields
    if (!scriptContent || scriptContent.trim() === '') {
      setSnackbar({ open: true, message: 'Validation definition cannot be empty', color: 'danger' });
      return;
    }

    setIsSaving(true);
    try {
      const updatedValidation = { ...validation, definition: scriptContent };
      await onSaveChanges(updatedValidation);
      if (!isMountedRef.current) return;
      setIsEditing(false);
      setSnackbar({ open: true, message: 'Validation saved successfully', color: 'success' });
    } catch (error: any) {
      console.error('Save error:', error);
      if (isMountedRef.current) {
        setSnackbar({ open: true, message: `Failed to save: ${error.message || 'Unknown error'}`, color: 'danger' });
      }
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleDownloadQuery = (e: React.MouseEvent) => {
    e.stopPropagation();
    const processedQuery = (scriptContent ?? '').replace(/\${(.*?)}/g, (_match, p1: string) => String(replacements[p1 as keyof typeof replacements] ?? ''));

    const blob = new Blob([processedQuery], { type: 'text/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${validation.procedureName?.replace(/\s+/g, '_') || 'validation'}_query.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleTestQuery = async () => {
    if (!replacements.schema) {
      setSnackbar({ open: true, message: 'No schema selected', color: 'warning' });
      return;
    }

    setIsTesting(true);
    try {
      // Replace template variables before testing
      const processedQuery = (scriptContent ?? '').replace(/\${(.*?)}/g, (_match, p1: string) => {
        return String(replacements[p1 as keyof typeof replacements] ?? '');
      });

      const response = await fetch(`/api/validations/validate-query?schema=${replacements.schema}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: processedQuery })
      });

      if (!isMountedRef.current) return;

      if (response.ok) {
        const result = await response.json();
        if (result.isValid && result.errors.length === 0) {
          setSnackbar({ open: true, message: 'Query is valid!', color: 'success' });
        } else if (result.errors.length > 0) {
          setSnackbar({
            open: true,
            message: `Validation errors: ${result.errors.join(', ')}`,
            color: 'danger'
          });
        } else if (result.warnings.length > 0) {
          setSnackbar({
            open: true,
            message: `Warnings: ${result.warnings.join(', ')}`,
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

  const handleToggleClick = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    setPendingToggleValue(e.target.checked);
    setShowConfirmToggle(true);
  };

  const handleConfirmToggle = async () => {
    setShowConfirmToggle(false);
    setIsSaving(true);
    try {
      const updatedValidation = { ...validation, isEnabled: pendingToggleValue };
      await onSaveChanges(updatedValidation);
      if (!isMountedRef.current) return;
      setSnackbar({
        open: true,
        message: `Validation ${pendingToggleValue ? 'enabled' : 'disabled'} successfully`,
        color: 'success'
      });
    } catch (error: any) {
      console.error('Toggle error:', error);
      if (isMountedRef.current) {
        setSnackbar({ open: true, message: `Failed to update: ${error.message || 'Unknown error'}`, color: 'danger' });
      }
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleCancelToggle = () => {
    setShowConfirmToggle(false);
  };

  const formattedDescription = validation.description?.replace(/(DBH|HOM)([A-Z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2');

  const open = expandedValidationID === validation.validationID;

  return (
    <>
      <TableRow sx={{ borderBottom: 'unset' }}>
        {/* Enabled Switch */}
        <TableCell>
          <Tooltip describeChild title="Toggle validation enabled state">
            <Switch
              checked={validation.isEnabled ?? false}
              onChange={handleToggleClick}
              onClick={e => e.stopPropagation()}
              disabled={isSaving}
              aria-label={validation.isEnabled ? 'Disable validation' : 'Enable validation'}
            />
          </Tooltip>
        </TableCell>

        {/* Procedure Name */}
        <TableCell component="th" sx={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {validation.procedureName?.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).join(' ')}
        </TableCell>

        {/* Description List */}
        <TableCell sx={{ whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top' }}>
          <List aria-label="Validation description list" marker="disc" sx={{ p: 0, m: 0, listStylePosition: 'inside' }}>
            {formattedDescription?.split(';').map((snippet, index) => (
              <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', p: 0, flexWrap: 'wrap' }}>
                <Chip size="sm" sx={{ whiteSpace: 'normal', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal' } }}>
                  {snippet.trim()}
                </Chip>
              </ListItem>
            ))}
          </List>
        </TableCell>

        {/* Criteria List */}
        <TableCell sx={{ whiteSpace: 'normal', wordBreak: 'break-word', verticalAlign: 'top' }}>
          <List aria-label="Validation criteria list" marker="disc" sx={{ p: 0, m: 0, listStylePosition: 'inside' }}>
            {validation.criteria?.split(';').map((snippet, index) => (
              <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', p: 0, flexWrap: 'wrap' }}>
                <Chip size="sm" sx={{ whiteSpace: 'normal', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal' } }}>
                  {snippet.trim()}
                </Chip>
              </ListItem>
            ))}
          </List>
        </TableCell>

        {/* Definition / Editor */}
        <TableCell sx={{ position: 'relative', whiteSpace: 'normal', wordBreak: 'break-word' }}>
          <Box
            onClick={e => e.stopPropagation()}
            sx={{
              width: '100%',
              ...(open ? {} : { maxHeight: '60px', overflow: 'hidden' }),
              transition: 'max-height 0.3s ease',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {open ? (
              <Box sx={{ width: '100%', flexGrow: 1 }}>
                <CodeEditor
                  value={scriptContent ?? ''}
                  height="auto"
                  setValue={debouncedSetScriptContent}
                  schemaDetails={memoizedSchemaDetails}
                  isDarkMode={isDarkMode}
                  readOnly={!isEditing}
                  schema={replacements.schema}
                  enableValidation={isEditing}
                  showFormatButton={isEditing}
                  showTestButton={isEditing}
                  testButtonLabel={isTesting ? 'Testing...' : 'Test Query'}
                  onTestQuery={handleTestQuery}
                  aria-label="Validation script editor"
                />
              </Box>
            ) : (
              <Textarea
                minRows={1}
                maxRows={3}
                value={(validation.definition || '').replace(/\${(.*?)}/g, (_match, p1: string) => String(replacements[p1 as keyof typeof replacements] ?? ''))}
                disabled
                aria-label="Validation definition"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  width: '100%',
                  resize: 'none'
                }}
              />
            )}
          </Box>

          {/* Expand/Collapse Button */}
          <Box sx={{ position: 'absolute', bottom: 4, right: 4 }}>
            <IconButton
              onClick={() => handleExpandClick(validation.validationID!)}
              size="sm"
              aria-label={open ? 'Collapse validation details' : 'Expand validation details'}
            >
              {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>
        </TableCell>

        {/* Action Buttons */}
        <TableCell sx={{ whiteSpace: 'normal', wordBreak: 'break-word', width: '10%' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {isEditing ? (
              <>
                <Tooltip describeChild title="Save changes">
                  <IconButton variant="solid" onClick={handleSaveChanges} disabled={isSaving} aria-label="Save validation changes">
                    {isSaving ? <CircularProgress size="sm" /> : <Save />}
                  </IconButton>
                </Tooltip>
                <Tooltip describeChild title="Cancel changes">
                  <IconButton variant="solid" onClick={handleCancelChanges} disabled={isSaving} aria-label="Cancel validation changes">
                    <Cancel />
                  </IconButton>
                </Tooltip>
              </>
            ) : (
              <>
                <Tooltip describeChild title="Edit validation">
                  <IconButton variant="solid" onClick={handleEditClick} aria-label="Edit validation">
                    <Edit />
                  </IconButton>
                </Tooltip>
                <Tooltip describeChild title="Download validation query">
                  <IconButton variant="outlined" onClick={handleDownloadQuery} aria-label="Download validation query">
                    <Download />
                  </IconButton>
                </Tooltip>
              </>
            )}
          </Box>
        </TableCell>
      </TableRow>

      {/* Confirmation Dialog for Enable/Disable */}
      <ConfirmationDialog
        open={showConfirmToggle}
        onClose={handleCancelToggle}
        onConfirm={handleConfirmToggle}
        title={pendingToggleValue ? 'Enable Validation' : 'Disable Validation'}
        content={`Are you sure you want to ${pendingToggleValue ? 'enable' : 'disable'} the validation "${validation.procedureName}"? This will ${pendingToggleValue ? 'start' : 'stop'} checking measurements against this rule.`}
      />

      {/* Snackbar for user feedback */}
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar({ ...snackbar, open: false })} color={snackbar.color} variant="soft">
        {snackbar.message}
      </Snackbar>
    </>
  );
};

export default ValidationRow;
