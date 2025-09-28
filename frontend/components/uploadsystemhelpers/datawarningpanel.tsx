'use client';

import React, { useState } from 'react';
import { Alert, Box, Chip, Collapse, IconButton, Sheet, Stack, Table, Typography } from '@mui/joy';
import { ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon, Warning as WarningIcon, Error as ErrorIcon, Info as InfoIcon } from '@mui/icons-material';
import { DataWarning } from './csvheadermapper';

export interface DataWarningPanelProps {
  warnings: DataWarning[];
  errors: string[];
  title?: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export function DataWarningPanel({ warnings, errors, title = 'Data Processing Report', collapsible = true, defaultExpanded = false }: DataWarningPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (warnings.length === 0 && errors.length === 0) {
    return null;
  }

  const warningsByType = warnings.reduce(
    (acc, warning) => {
      if (!acc[warning.type]) {
        acc[warning.type] = [];
      }
      acc[warning.type].push(warning);
      return acc;
    },
    {} as Record<string, DataWarning[]>
  );

  const getWarningTypeInfo = (type: string) => {
    switch (type) {
      case 'date_format':
        return {
          label: 'Date Format Issues',
          color: 'warning' as const,
          icon: <WarningIcon />
        };
      case 'coordinate_precision':
        return {
          label: 'Coordinate Precision',
          color: 'primary' as const,
          icon: <InfoIcon />
        };
      case 'missing_header':
        return {
          label: 'Header Mapping',
          color: 'neutral' as const,
          icon: <InfoIcon />
        };
      case 'data_conversion':
        return {
          label: 'Data Conversion',
          color: 'warning' as const,
          icon: <WarningIcon />
        };
      default:
        return {
          label: 'Other Issues',
          color: 'neutral' as const,
          icon: <InfoIcon />
        };
    }
  };

  const totalIssues = warnings.length + errors.length;

  const panelContent = (
    <Box>
      {/* Summary */}
      <Box sx={{ mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography level="title-md">{title}</Typography>
          <Chip size="sm" color={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'}>
            {totalIssues === 0 ? 'No Issues' : `${totalIssues} Issue${totalIssues > 1 ? 's' : ''}`}
          </Chip>
        </Stack>
      </Box>

      {/* Errors */}
      {errors.length > 0 && (
        <Alert color="danger" startDecorator={<ErrorIcon />} sx={{ mb: 2 }}>
          <Box>
            <Typography level="title-sm" sx={{ mb: 1 }}>
              Critical Errors ({errors.length})
            </Typography>
            <Stack spacing={0.5}>
              {errors.map((error, index) => (
                <Typography key={index} level="body-sm">
                  • {error}
                </Typography>
              ))}
            </Stack>
          </Box>
        </Alert>
      )}

      {/* Warnings by Type */}
      {Object.entries(warningsByType).map(([type, typeWarnings]) => {
        const typeInfo = getWarningTypeInfo(type);

        return (
          <Alert key={type} color={typeInfo.color} startDecorator={typeInfo.icon} sx={{ mb: 2 }}>
            <Box sx={{ width: '100%' }}>
              <Typography level="title-sm" sx={{ mb: 1 }}>
                {typeInfo.label} ({typeWarnings.length})
              </Typography>

              {typeWarnings.length <= 5 ? (
                // Show all warnings if 5 or fewer
                <Stack spacing={0.5}>
                  {typeWarnings.map((warning, index) => (
                    <Typography key={index} level="body-sm">
                      • {warning.message}
                      {warning.row && ` (Row ${warning.row})`}
                      {warning.column && ` [${warning.column}]`}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                // Show table format for many warnings
                <Box sx={{ mt: 1 }}>
                  <Typography level="body-sm" sx={{ mb: 1 }}>
                    Showing first 10 of {typeWarnings.length} issues:
                  </Typography>
                  <Sheet sx={{ overflow: 'auto', maxHeight: 200 }}>
                    <Table size="sm" stickyHeader>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Column</th>
                          <th>Issue</th>
                          {typeWarnings.some(w => w.originalValue !== undefined) && <th>Original</th>}
                          {typeWarnings.some(w => w.convertedValue !== undefined) && <th>Converted</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {typeWarnings.slice(0, 10).map((warning, index) => (
                          <tr key={index}>
                            <td>{warning.row || '-'}</td>
                            <td>{warning.column || '-'}</td>
                            <td>
                              <Typography level="body-xs">{warning.message}</Typography>
                            </td>
                            {typeWarnings.some(w => w.originalValue !== undefined) && (
                              <td>
                                <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                                  {warning.originalValue?.toString() || '-'}
                                </Typography>
                              </td>
                            )}
                            {typeWarnings.some(w => w.convertedValue !== undefined) && (
                              <td>
                                <Typography level="body-xs" sx={{ fontFamily: 'monospace' }}>
                                  {warning.convertedValue?.toString() || '-'}
                                </Typography>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </Sheet>
                  {typeWarnings.length > 10 && (
                    <Typography level="body-xs" sx={{ mt: 1, fontStyle: 'italic' }}>
                      ... and {typeWarnings.length - 10} more similar issues
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Alert>
        );
      })}
    </Box>
  );

  if (!collapsible) {
    return (
      <Sheet variant="outlined" sx={{ p: 2, borderRadius: 'md' }}>
        {panelContent}
      </Sheet>
    );
  }

  return (
    <Sheet variant="outlined" sx={{ borderRadius: 'md', overflow: 'hidden' }}>
      {/* Collapsible Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: expanded ? '1px solid' : 'none',
          borderColor: 'divider',
          cursor: 'pointer',
          '&:hover': {
            backgroundColor: 'background.level1'
          }
        }}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} data processing report`}
      >
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography level="title-md">{title}</Typography>
          <Chip size="sm" color={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'}>
            {totalIssues === 0 ? 'No Issues' : `${totalIssues} Issue${totalIssues > 1 ? 's' : ''}`}
          </Chip>
        </Stack>
        <IconButton size="sm" variant="plain">
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      {/* Collapsible Content */}
      <Collapse in={expanded}>
        <Box sx={{ p: 2 }}>{panelContent}</Box>
      </Collapse>
    </Sheet>
  );
}
