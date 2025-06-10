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
      <TableCell sx={{ alignSelf: 'left' }}>
        <Tooltip title="Toggle Enabled State">
          <Switch
            checked={validation.isEnabled}
            onChange={async e => {
              const updatedValidation = { ...validation, isEnabled: e.target.checked };
              await onSaveChanges(updatedValidation);
            }}
            onClick={e => e.stopPropagation()}
          />
        </Tooltip>
      </TableCell>

      <TableCell sx={{ flexGrow: 0, flexShrink: 1, flexBasis: '20%', whiteSpace: 'normal', wordBreak: 'break-word' }}>
        {validation.procedureName?.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).join(' ')}
      </TableCell>

      <TableCell sx={{ textAlign: 'left', verticalAlign: 'top' }}>
        <List marker="disc" sx={{ padding: 0, margin: 0, listStylePosition: 'inside' }}>
          {formattedDescription?.split(';').map((snippet, index) => (
            <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', padding: 0 }}>
              <Chip sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '0.5rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                {snippet}
              </Chip>
            </ListItem>
          ))}
        </List>
      </TableCell>

      <TableCell sx={{ textAlign: 'left', verticalAlign: 'top' }}>
        <List marker="disc" sx={{ padding: 0, margin: 0, listStylePosition: 'inside' }}>
          {validation.criteria?.split(';').map((snippet, index) => (
            <ListItem key={index} sx={{ display: 'flex', alignItems: 'flex-start', padding: 0 }}>
              <Chip sx={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', paddingLeft: '0.5rem', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                {snippet}
              </Chip>
            </ListItem>
          ))}
        </List>
      </TableCell>

      <TableCell
        sx={{
          flexGrow: 1,
          flexShrink: 0,
          flexBasis: '70%',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          position: 'relative'
        }}
      >
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
          {expandedValidationID === validation.validationID ? (
            <Box sx={{ width: '100%', height: '100%', flexGrow: 1 }}>
              <CodeEditor
                value={scriptContent ?? ''}
                height={'auto'}
                setValue={debouncedSetScriptContent}
                schemaDetails={memoizedSchemaDetails}
                isDarkMode={isDarkMode}
                readOnly={!isEditing}
              />
            </Box>
          ) : (
            <Textarea
              minRows={1}
              maxRows={3}
              value={validation.definition!.replace(/\${(.*?)}/g, (_match: any, p1: string) => String(replacements[p1 as keyof typeof replacements] ?? ''))}
              disabled
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

        <Box sx={{ position: 'absolute', bottom: '4px', right: '4px' }}>
          <IconButton onClick={() => handleExpandClick(validation.validationID!)} size="sm">
            {expandedValidationID === validation.validationID ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
      </TableCell>

      <TableCell sx={{ alignSelf: 'center', whiteSpace: 'normal', wordBreak: 'break-word', width: '10%' }}>
        {isEditing ? (
          <>
            <Tooltip title="Save Changes">
              <IconButton variant="solid" onClick={handleSaveChanges}>
                <Save />
              </IconButton>
            </Tooltip>
            <Tooltip title="Cancel Changes">
              <IconButton variant="solid" onClick={handleCancelChanges}>
                <Cancel />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Tooltip title="Edit Validation">
            <IconButton variant="solid" onClick={handleEditClick}>
              <Edit />
            </IconButton>
          </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
};

export default ValidationRow;
