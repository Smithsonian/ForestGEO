'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Option, Select, Table, Typography } from '@mui/joy';
import { DelimiterDetectionResult, DelimiterValidationResult, detectDelimiter, validateDelimiter } from './delimiterdetection';

interface FilePreviewProps {
  file: File;
  expectedHeaders?: string[];
  onDelimiterChange: (delimiter: string) => void;
  initialDelimiter?: string;
}

interface DelimiterOption {
  value: string;
  label: string;
  description: string;
}

const DELIMITER_OPTIONS: DelimiterOption[] = [
  { value: ',', label: 'Comma (,)', description: 'Standard CSV format' },
  { value: '\t', label: 'Tab (\\t)', description: 'Tab-separated values' },
  { value: ';', label: 'Semicolon (;)', description: 'European CSV format' },
  { value: '|', label: 'Pipe (|)', description: 'Pipe-separated values' }
];

export default function FilePreview({ file, expectedHeaders, onDelimiterChange, initialDelimiter }: FilePreviewProps) {
  const [selectedDelimiter, setSelectedDelimiter] = useState<string>(initialDelimiter || ',');
  const [detectionResult, setDetectionResult] = useState<DelimiterDetectionResult | null>(null);
  const [validationResult, setValidationResult] = useState<DelimiterValidationResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(true);
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const previousDelimiterRef = useRef<string>('');

  // Auto-detect delimiter on component mount
  useEffect(() => {
    const analyzeFile = async () => {
      setIsAnalyzing(true);
      try {
        const detection = await detectDelimiter(file);
        setDetectionResult(detection);

        // Use detected delimiter if confidence is high enough and no initial delimiter provided
        const delimiterToUse = initialDelimiter || (detection.confidence > 50 ? detection.delimiter : ',');
        setSelectedDelimiter(delimiterToUse);

        // Validate with the chosen delimiter
        const validation = await validateDelimiter(file, delimiterToUse, expectedHeaders);
        setValidationResult(validation);
        setPreviewData(validation.preview);

        // Notify parent of delimiter choice
        onDelimiterChange(delimiterToUse);
      } catch (error) {
        console.error('Error analyzing file:', error);
      } finally {
        setIsAnalyzing(false);
      }
    };

    analyzeFile();
  }, [file.name, file.size, file.lastModified]); // Only depend on file identity, not the entire file object

  // Revalidate when delimiter changes (but not on initial mount)
  useEffect(() => {
    if (isAnalyzing) return; // Skip during initial analysis
    if (previousDelimiterRef.current === selectedDelimiter) return; // Skip if delimiter hasn't actually changed

    const validateCurrentDelimiter = async () => {
      try {
        const validation = await validateDelimiter(file, selectedDelimiter, expectedHeaders);
        setValidationResult(validation);
        setPreviewData(validation.preview);

        // Update ref and notify parent
        previousDelimiterRef.current = selectedDelimiter;
        onDelimiterChange(selectedDelimiter);
      } catch (error) {
        console.error('Error validating delimiter:', error);
      }
    };

    validateCurrentDelimiter();
  }, [selectedDelimiter]); // Only depend on selectedDelimiter

  const handleDelimiterChange = useCallback((newDelimiter: string | null) => {
    if (newDelimiter) {
      setSelectedDelimiter(newDelimiter);
    }
  }, []);

  const getDelimiterDisplay = (delimiter: string) => {
    switch (delimiter) {
      case '\t':
        return '\\t (tab)';
      case ',':
        return ', (comma)';
      case ';':
        return '; (semicolon)';
      case '|':
        return '| (pipe)';
      default:
        return delimiter;
    }
  };

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

      {/* Auto-detection results */}
      {detectionResult && (
        <Alert variant="soft" color={detectionResult.confidence > 70 ? 'success' : detectionResult.confidence > 30 ? 'warning' : 'danger'} sx={{ mb: 2 }}>
          <Typography level="body-sm">
            <strong>Auto-detected delimiter:</strong> {getDelimiterDisplay(detectionResult.delimiter)}({detectionResult.confidence.toFixed(1)}% confidence,{' '}
            {detectionResult.sampleRows} sample rows, avg {detectionResult.avgColumnsPerRow.toFixed(1)} columns per row)
          </Typography>
        </Alert>
      )}

      {/* Delimiter selection */}
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

      {/* Validation results */}
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

      {/* Preview table */}
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

      {/* Column count information */}
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
