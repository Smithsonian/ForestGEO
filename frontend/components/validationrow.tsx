// validationrow.tsx
'use client';

import React, { useMemo, useRef, useState } from 'react';
import { Box, TableCell, TableRow } from '@mui/material';
import { Cancel, Edit, Save } from '@mui/icons-material';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { Chip, IconButton, List, ListItem, Switch, Textarea, Tooltip } from '@mui/joy';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CodeEditor from '@/components/client/codeeditor';

function useDebouncedCallback(callback: (...args: any[]) => void, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  const originalScriptContent = useRef<string>(validation.definition ?? '');

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
    const updatedValidation = { ...validation, definition: scriptContent };
    await onSaveChanges(updatedValidation);
    setIsEditing(false);
  };

  const formattedDescription = validation.description?.replace(/(DBH|HOM)([A-Z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2');

  const open = expandedValidationID === validation.validationID;

  return (
    <TableRow sx={{ borderBottom: 'unset' }}>
      {/* Enabled Switch */}
      <TableCell>
        <Tooltip describeChild title="Toggle validation enabled state">
          <Switch
            checked={validation.isEnabled}
            onChange={async e => {
              const updatedValidation = { ...validation, isEnabled: e.target.checked };
              await onSaveChanges(updatedValidation);
            }}
            onClick={e => e.stopPropagation()}
            aria-label={validation.isEnabled ? 'Disable validation' : 'Enable validation'}
          />
        </Tooltip>
      </TableCell>

      {/* Procedure Name */}
      <TableCell component="th" sx={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
        {validation.procedureName?.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).join(' ')}
      </TableCell>

      {/* Description List */}
      <TableCell>
        <List aria-label="Validation description list" marker="disc" sx={{ p: 0, m: 0, listStylePosition: 'inside' }}>
          {formattedDescription?.split(';').map((snippet, index) => (
            <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', p: 0 }}>
              <Chip>{snippet}</Chip>
            </ListItem>
          ))}
        </List>
      </TableCell>

      {/* Criteria List */}
      <TableCell>
        <List aria-label="Validation criteria list" marker="disc" sx={{ p: 0, m: 0, listStylePosition: 'inside' }}>
          {validation.criteria?.split(';').map((snippet, index) => (
            <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', p: 0 }}>
              <Chip>{snippet}</Chip>
            </ListItem>
          ))}
        </List>
      </TableCell>

      {/* Definition / Editor */}
      <TableCell sx={{ position: 'relative', whiteSpace: 'normal', wordBreak: 'break-word' }}>
        <Box
          role={'button'}
          tabIndex={0}
          component={'button'}
          onKeyDown={e => {
            e.preventDefault();
            e.stopPropagation();
          }}
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
                aria-label="Validation script editor"
              />
            </Box>
          ) : (
            <Textarea
              minRows={1}
              maxRows={3}
              value={validation.definition!.replace(/\${(.*?)}/g, (_match, p1: string) => String(replacements[p1 as keyof typeof replacements] ?? ''))}
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
        {isEditing ? (
          <>
            <Tooltip describeChild title="Save changes">
              <IconButton variant="solid" onClick={handleSaveChanges} aria-label="Save validation changes">
                <Save />
              </IconButton>
            </Tooltip>
            <Tooltip describeChild title="Cancel changes">
              <IconButton variant="solid" onClick={handleCancelChanges} aria-label="Cancel validation changes">
                <Cancel />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Tooltip describeChild title="Edit validation">
            <IconButton variant="solid" onClick={handleEditClick} aria-label="Edit validation">
              <Edit />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
};

export default ValidationRow;
