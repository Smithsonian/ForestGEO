'use client';
import React, { useEffect, useRef } from 'react';
import { Alert, Box, Chip, Divider, Option, Select, Sheet, Stack, Typography } from '@mui/joy';
import { useFilePreviewAnalysis, DELIMITER_OPTIONS } from './useFilePreviewAnalysis';

interface FilePreviewCompactProps {
  file: File;
  expectedHeaders?: string[];
  onDelimiterChange: (delimiter: string) => void;
  initialDelimiter?: string;
  showPreview?: boolean;
  onValidationStatusChange?: (isValid: boolean, issues: string[]) => void;
}

export default function FilePreviewCompact({
  file,
  expectedHeaders,
  onDelimiterChange,
  initialDelimiter,
  showPreview = false,
  onValidationStatusChange
}: FilePreviewCompactProps) {
  const { selectedDelimiter, detectionResult, validationResult, isAnalyzing, previewData, handleDelimiterChange } = useFilePreviewAnalysis({
    file,
    expectedHeaders,
    onDelimiterChange,
    initialDelimiter
  });

  // Track last reported validation to prevent infinite loops
  const lastReportedValidation = useRef<{ isValid: boolean; issuesKey: string } | null>(null);
  // Use ref to store callback to avoid dependency on callback reference changes
  const onValidationStatusChangeRef = useRef(onValidationStatusChange);
  onValidationStatusChangeRef.current = onValidationStatusChange;

  // Extract stable primitive values from validation result for dependency tracking
  const validationIsValid = validationResult?.isValid ?? null;
  const validationIssuesKey = validationResult?.issues?.join('|') ?? '';

  // Report validation status changes to parent (only when values actually change)
  useEffect(() => {
    const callback = onValidationStatusChangeRef.current;
    if (callback && !isAnalyzing && validationIsValid !== null && validationResult) {
      const current = { isValid: validationIsValid, issuesKey: validationIssuesKey };

      // Only call callback if validation result actually changed
      if (
        !lastReportedValidation.current ||
        lastReportedValidation.current.isValid !== current.isValid ||
        lastReportedValidation.current.issuesKey !== current.issuesKey
      ) {
        lastReportedValidation.current = current;
        callback(validationIsValid, validationResult.issues);
      }
    }
    // Note: validationIssuesKey is derived from validationResult.issues, so we use it instead
    // of the array reference to prevent infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationIsValid, validationIssuesKey, isAnalyzing]);

  const getStatusColor = () => {
    if (isAnalyzing) return 'neutral';
    if (!validationResult) return 'warning';
    if (validationResult.isValid) return 'success';
    if (detectionResult && detectionResult.confidence > 70) return 'warning';
    return 'danger';
  };

  const getStatusText = () => {
    if (isAnalyzing) return 'Analyzing...';
    if (!validationResult) return 'Unknown';
    if (validationResult.isValid) return 'Valid';
    return 'Issues detected';
  };

  const getConfidenceText = () => {
    if (!detectionResult) return '';
    const confidence = detectionResult.confidence;
    if (confidence > 90) return 'High confidence';
    if (confidence > 70) return 'Good confidence';
    if (confidence > 50) return 'Medium confidence';
    return 'Low confidence';
  };

  return (
    <Sheet
      variant="outlined"
      sx={{
        p: 2,
        borderRadius: 'md',
        backgroundColor: 'background.surface',
        borderColor:
          getStatusColor() === 'success'
            ? 'success.300'
            : getStatusColor() === 'warning'
              ? 'warning.300'
              : getStatusColor() === 'danger'
                ? 'danger.300'
                : 'neutral.300'
      }}
    >
      <Stack spacing={2}>
        {/* Header row */}
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography level="title-sm" sx={{ fontWeight: 'bold' }}>
              Format Detection
            </Typography>
            <Chip size="sm" color={getStatusColor()}>
              {getStatusText()}
            </Chip>
            {detectionResult && (
              <Typography level="body-xs" color="neutral">
                {getConfidenceText()}
              </Typography>
            )}
          </Stack>

          {/* Delimiter Selection */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography level="body-sm">Delimiter:</Typography>
            <Select
              size="sm"
              value={selectedDelimiter}
              onChange={(_, value) => handleDelimiterChange(value)}
              sx={{ minWidth: 100 }}
              aria-label="Select delimiter"
            >
              {DELIMITER_OPTIONS.map(option => (
                <Option key={option.value} value={option.value} aria-label={`${option.label} delimiter`}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 'sm' }}>{option.icon}</Typography>
                    <Typography level="body-sm">{option.label.split(' ')[0]}</Typography>
                  </Stack>
                </Option>
              ))}
            </Select>
          </Stack>
        </Stack>

        {/* Status details */}
        {validationResult && validationResult.issues.length > 0 && (
          <Alert size="sm" color="warning">
            <Typography level="body-xs">
              <strong>Issues:</strong> {validationResult.issues.slice(0, 2).join(', ')}
              {validationResult.issues.length > 2 && ` (+${validationResult.issues.length - 2} more)`}
            </Typography>
          </Alert>
        )}

        {/* Column info */}
        {previewData.length > 0 && (
          <Stack direction="row" spacing={3} sx={{ fontSize: 'xs' }}>
            <Typography level="body-xs">
              <strong>Detected:</strong> {previewData[0]?.length || 0} columns
            </Typography>
            {expectedHeaders && (
              <Typography level="body-xs">
                <strong>Expected:</strong> {expectedHeaders.length} columns
              </Typography>
            )}
            {previewData[0]?.length !== expectedHeaders?.length && expectedHeaders && (
              <Typography level="body-xs" color="warning">
                ⚠ Count mismatch
              </Typography>
            )}
          </Stack>
        )}

        {/* Preview table (compact) */}
        {showPreview && previewData.length > 0 && (
          <>
            <Divider />
            <Typography level="body-sm" sx={{ fontWeight: 'bold' }}>
              Preview (first 3 rows):
            </Typography>
            <Box
              sx={{
                overflow: 'auto',
                maxHeight: '200px',
                border: '1px solid',
                borderColor: 'neutral.200',
                borderRadius: 'sm',
                fontSize: 'xs'
              }}
            >
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ backgroundColor: 'var(--joy-palette-neutral-50)', position: 'sticky', top: 0 }}>
                  <tr>
                    {previewData[0]?.map((header, index) => (
                      <th
                        key={index}
                        style={{
                          padding: '6px 10px',
                          borderRight: '1px solid var(--joy-palette-neutral-200)',
                          textAlign: 'left',
                          fontSize: '12px',
                          fontWeight: 600,
                          maxWidth: '120px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: expectedHeaders?.some(eh => eh.toLowerCase().trim() === header.toLowerCase().trim())
                            ? 'var(--joy-palette-success-600)'
                            : 'var(--joy-palette-text-primary)'
                        }}
                      >
                        {header || `Col ${index + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(1, 4).map((row, rowIndex) => (
                    <tr key={rowIndex} style={{ borderBottom: '1px solid var(--joy-palette-neutral-100)' }}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={{
                            padding: '6px 10px',
                            borderRight: '1px solid var(--joy-palette-neutral-100)',
                            fontSize: '12px',
                            maxWidth: '120px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {cell || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </>
        )}
      </Stack>
    </Sheet>
  );
}
