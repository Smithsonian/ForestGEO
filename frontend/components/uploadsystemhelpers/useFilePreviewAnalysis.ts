/**
 * useFilePreviewAnalysis Hook
 *
 * Shared logic for file preview components.
 * Handles delimiter detection, validation, and preview data management.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DelimiterDetectionResult, DelimiterValidationResult, detectDelimiter, validateDelimiter } from './delimiterdetection';

export interface UseFilePreviewAnalysisProps {
  file: File;
  expectedHeaders?: string[];
  onDelimiterChange: (delimiter: string) => void;
  initialDelimiter?: string;
}

export interface UseFilePreviewAnalysisResult {
  selectedDelimiter: string;
  setSelectedDelimiter: (delimiter: string) => void;
  detectionResult: DelimiterDetectionResult | null;
  validationResult: DelimiterValidationResult | null;
  isAnalyzing: boolean;
  previewData: string[][];
  handleDelimiterChange: (newDelimiter: string | null) => void;
}

/**
 * Custom hook for file preview analysis
 *
 * Extracts shared logic from FilePreview and FilePreviewCompact components:
 * - Auto-detection of delimiter on mount
 * - Validation when delimiter changes
 * - State management for detection/validation results
 *
 * @param props - Configuration props
 * @returns State and handlers for file preview
 */
export function useFilePreviewAnalysis({
  file,
  expectedHeaders,
  onDelimiterChange,
  initialDelimiter
}: UseFilePreviewAnalysisProps): UseFilePreviewAnalysisResult {
  const [selectedDelimiter, setSelectedDelimiter] = useState<string>(initialDelimiter || ',');
  const [detectionResult, setDetectionResult] = useState<DelimiterDetectionResult | null>(null);
  const [validationResult, setValidationResult] = useState<DelimiterValidationResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(true);
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const previousDelimiterRef = useRef<string>('');

  // Auto-detect delimiter on component mount
  useEffect(() => {
    const analyzeFile = async () => {
      // ArcGIS .xlsx uploads are binary workbooks; CSV delimiter/header validation
      // does not apply. Report a valid result so the flow can reach pre-flight,
      // where readArcgisWorkbook performs the real validation.
      if (/\.xlsx$/i.test(file.name)) {
        setDetectionResult(null);
        setValidationResult({ isValid: true, delimiter: selectedDelimiter, issues: [], preview: [] });
        setPreviewData([]);
        setIsAnalyzing(false);
        return;
      }
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

        // Update ref to prevent duplicate validation in the second useEffect
        previousDelimiterRef.current = delimiterToUse;

        // Notify parent of delimiter choice
        onDelimiterChange(delimiterToUse);
      } catch (error) {
        console.error('Error analyzing file:', error);
      } finally {
        setIsAnalyzing(false);
      }
    };

    analyzeFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, initialDelimiter]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDelimiter, file, isAnalyzing]);

  const handleDelimiterChange = useCallback((newDelimiter: string | null) => {
    if (newDelimiter) {
      setSelectedDelimiter(newDelimiter);
    }
  }, []);

  return {
    selectedDelimiter,
    setSelectedDelimiter,
    detectionResult,
    validationResult,
    isAnalyzing,
    previewData,
    handleDelimiterChange
  };
}

/**
 * Delimiter display helper
 */
export function getDelimiterDisplay(delimiter: string): string {
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
}

/**
 * Delimiter options for select components
 */
export interface DelimiterOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

export const DELIMITER_OPTIONS: DelimiterOption[] = [
  { value: ',', label: 'Comma (,)', description: 'Standard CSV format', icon: ',' },
  { value: '\t', label: 'Tab (\\t)', description: 'Tab-separated values', icon: '⭾' },
  { value: ';', label: 'Semicolon (;)', description: 'European CSV format', icon: ';' },
  { value: '|', label: 'Pipe (|)', description: 'Pipe-separated values', icon: '|' }
];
