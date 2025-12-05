'use client';
import React from 'react';
import { Alert, Box, CircularProgress, Option, Select, Table, Typography } from '@mui/joy';
import { useFilePreviewAnalysis, getDelimiterDisplay, DELIMITER_OPTIONS } from './useFilePreviewAnalysis';

interface FilePreviewProps {
  file: File;
  expectedHeaders?: string[];
  onDelimiterChange: (delimiter: string) => void;
  initialDelimiter?: string;
}

export default function FilePreview({ file, expectedHeaders, onDelimiterChange, initialDelimiter }: FilePreviewProps) {
  const { selectedDelimiter, detectionResult, validationResult, isAnalyzing, previewData, handleDelimiterChange } = useFilePreviewAnalysis({
    file,
    expectedHeaders,
    onDelimiterChange,
    initialDelimiter
  });

  if (isAnalyzing) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', p: 3 }}>
        <CircularProgress size="sm" />
        <Typography level="body-sm" sx={{ mt: 1 }}>
          Analyzing file format...
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', p: 2 }}>
      <Typography level="title-md" sx={{ mb: 2 }}>
        File Format Preview: {file.name}
      </Typography>

      {detectionResult && (
        <Alert variant="soft" color={detectionResult.confidence > 70 ? 'success' : detectionResult.confidence > 30 ? 'warning' : 'danger'} sx={{ mb: 2 }}>
          <Typography level="body-sm">
            <strong>Auto-detected delimiter:</strong> {getDelimiterDisplay(detectionResult.delimiter)}({detectionResult.confidence.toFixed(1)}% confidence,{' '}
            {detectionResult.sampleRows} sample rows, avg {detectionResult.avgColumnsPerRow.toFixed(1)} columns per row)
          </Typography>
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography level="body-md">Delimiter:</Typography>
        <Select value={selectedDelimiter} onChange={(_, value) => handleDelimiterChange(value)} sx={{ minWidth: 200 }}>
          {DELIMITER_OPTIONS.map(option => (
            <Option key={option.value} value={option.value}>
              {option.label} - {option.description}
            </Option>
          ))}
        </Select>
      </Box>

      {validationResult && (
        <>
          {validationResult.issues.length > 0 && (
            <Alert variant="soft" color="warning" sx={{ mb: 2 }}>
              <Typography level="title-sm">Validation Issues:</Typography>
              {validationResult.issues.map((issue, index) => (
                <Typography key={index} level="body-sm">
                  • {issue}
                </Typography>
              ))}
            </Alert>
          )}

          {validationResult.isValid && (
            <Alert variant="soft" color="success" sx={{ mb: 2 }}>
              <Typography level="body-sm">✓ File format validation passed</Typography>
            </Alert>
          )}
        </>
      )}

      {previewData.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography level="title-sm" sx={{ mb: 1 }}>
            Preview (first few rows):
          </Typography>
          <Table
            variant="outlined"
            sx={{
              '--TableCell-paddingX': '8px',
              '--TableCell-paddingY': '4px',
              fontSize: 'xs'
            }}
          >
            <thead>
              <tr>
                <th style={{ width: '40px' }}>#</th>
                {previewData[0]?.map((header, index) => (
                  <th key={index} style={{ minWidth: '80px', maxWidth: '150px' }}>
                    <Typography
                      level="body-xs"
                      sx={{
                        wordBreak: 'break-all',
                        fontWeight: 'bold',
                        color: expectedHeaders?.some(eh => eh.toLowerCase().trim() === header.toLowerCase().trim()) ? 'success.500' : 'text.primary'
                      }}
                    >
                      {header || `Col ${index + 1}`}
                    </Typography>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewData.slice(1, 6).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td>{rowIndex + 2}</td>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <Typography
                        level="body-xs"
                        sx={{
                          wordBreak: 'break-all',
                          maxWidth: '150px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {cell || '-'}
                      </Typography>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>

          {expectedHeaders && (
            <Box sx={{ mt: 2 }}>
              <Typography level="body-xs" color="neutral">
                <strong>Legend:</strong>
                <Typography component="span" sx={{ color: 'success.500', ml: 1 }}>
                  Green headers match expected columns
                </Typography>
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {previewData.length > 0 && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'neutral.50', borderRadius: 'sm' }}>
          <Typography level="body-sm">
            <strong>Detected columns:</strong> {previewData[0]?.length || 0}
            {expectedHeaders && (
              <>
                {' | '}
                <strong>Expected columns:</strong> {expectedHeaders.length}
                {previewData[0]?.length !== expectedHeaders.length && (
                  <Typography component="span" sx={{ color: 'warning.500', ml: 1 }}>
                    ⚠ Column count mismatch
                  </Typography>
                )}
              </>
            )}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
