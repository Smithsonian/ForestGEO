// codeeditor.tsx
'use client';

import React, { Dispatch, SetStateAction, useEffect, useState, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { format as sqlFormat } from 'sql-formatter';
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';
import { linter, lintGutter } from '@codemirror/lint';
import CodeMirror, { EditorView, ViewUpdate } from '@uiw/react-codemirror';
import { Box, Alert, Button, CircularProgress } from '@mui/joy';
import { FormatAlignLeft, PlayArrow } from '@mui/icons-material';

type CodeEditorProps = {
  value: string;
  setValue: Dispatch<SetStateAction<string>> | undefined;
  schemaDetails?: { table_name: string; column_name: string }[];
  height?: string | number;
  isDarkMode?: boolean;
  readOnly?: boolean;
  schema?: string;
  enableValidation?: boolean;
  showFormatButton?: boolean;
  showTestButton?: boolean;
  testButtonLabel?: string;
  onTestQuery?: () => void;
};

const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  setValue,
  schemaDetails = [],
  height = 'auto',
  isDarkMode = false,
  readOnly = false,
  schema,
  enableValidation = false,
  showFormatButton = false,
  showTestButton = false,
  testButtonLabel = 'Test Query',
  onTestQuery
}) => {
  const [editorValue, setEditorValue] = useState(() => {
    try {
      return value ? sqlFormat(value, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' }) : '';
    } catch (error) {
      console.error('SQL formatting error:', error);
      return value || '';
    }
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      setEditorValue(value ? sqlFormat(value, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' }) : '');
    } catch (error) {
      console.error('SQL formatting error:', error);
      setEditorValue(value || '');
    }
  }, [value]);

  // Format the SQL query
  const handleFormatQuery = () => {
    try {
      const formatted = sqlFormat(editorValue, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' });
      setEditorValue(formatted);
      if (setValue) setValue(formatted);
    } catch (error) {
      console.error('SQL formatting error:', error);
    }
  };

  // Debounced validation function
  const validateQuery = async (query: string) => {
    if (!enableValidation || !schema || !query.trim()) {
      if (isMountedRef.current) {
        setValidationErrors([]);
        setValidationWarnings([]);
        setIsValidating(false);
      }
      return;
    }

    if (isMountedRef.current) setIsValidating(true);
    try {
      const response = await fetch(`/api/validations/validate-query?schema=${schema}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (!isMountedRef.current) return; // Prevent state updates after unmount

      if (response.ok) {
        const result = await response.json();
        setValidationErrors(result.errors || []);
        setValidationWarnings(result.warnings || []);
      } else {
        setValidationErrors(['Failed to validate query']);
      }
    } catch (error) {
      console.error('Validation error:', error);
      if (isMountedRef.current) {
        setValidationErrors(['Error connecting to validation service']);
      }
    } finally {
      if (isMountedRef.current) setIsValidating(false);
    }
  };

  // Debounced validation on value change
  useEffect(() => {
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }

    validationTimeoutRef.current = setTimeout(() => {
      validateQuery(editorValue);
    }, 1000); // Validate 1 second after user stops typing

    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, [editorValue, enableValidation, schema]);

  const autoHeightExt = EditorView.updateListener.of((update: ViewUpdate) => {
    if (update.docChanged || update.viewportChanged) {
      const lines = update.state.doc.lines;
      const lineHeight = update.view.defaultLineHeight;
      update.view.dom.style.height = `${lines * lineHeight}px`;
      update.view.requestMeasure();
    }
  });

  const cmHeight = height === 'auto' ? undefined : typeof height === 'number' ? `${height}px` : height;

  const lineWrapExt = EditorView.lineWrapping;

  // Autocomplete Suggestions
  const autocompleteExtension = autocompletion({
    override: [
      (context: CompletionContext) => {
        const word = context.matchBefore(/\w*/);
        if (!word || word.from === word.to) return null;

        const suggestions = [
          ...Array.from(new Set(schemaDetails.map(row => row.table_name))).map(table => ({
            label: table,
            type: 'keyword',
            detail: 'Table',
            apply: table
          })),
          ...schemaDetails.map(({ table_name, column_name }) => ({
            label: `${table_name}.${column_name}`,
            type: 'property',
            detail: `Column from ${table_name}`,
            apply: `${table_name}.${column_name}`
          }))
        ];

        return {
          from: word.from,
          options: suggestions
        };
      }
    ]
  });

  // Simple linter for validation errors
  const sqlLinter = linter(() => {
    const diagnostics = [];

    // Add errors as diagnostics
    if (validationErrors.length > 0) {
      diagnostics.push({
        from: 0,
        to: editorValue.length,
        severity: 'error' as const,
        message: validationErrors.join(', ')
      });
    }

    return diagnostics;
  });

  const extensions = [basicSetup, sql(), autocompleteExtension, lineWrapExt, autoHeightExt];

  if (enableValidation) {
    extensions.push(lintGutter(), sqlLinter);
  }

  return (
    <Box>
      {/* Action Buttons */}
      {!readOnly && (showFormatButton || showTestButton || enableValidation) && (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
          {showFormatButton && (
            <Button size="sm" variant="outlined" startDecorator={<FormatAlignLeft />} onClick={handleFormatQuery}>
              Format SQL
            </Button>
          )}
          {showTestButton && onTestQuery && (
            <Button
              size="sm"
              variant="solid"
              color="primary"
              startDecorator={<PlayArrow />}
              onClick={onTestQuery}
              disabled={isValidating}
            >
              {testButtonLabel}
            </Button>
          )}
          {enableValidation && isValidating && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size="sm" />
              <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>Validating...</Box>
            </Box>
          )}
        </Box>
      )}

      <CodeMirror
        value={editorValue}
        {...(cmHeight ? { height: cmHeight } : {})}
        extensions={extensions}
        theme={isDarkMode ? 'dark' : 'light'}
        onChange={val => {
          if (setValue) setValue(val);
          setEditorValue(val);
        }}
        readOnly={readOnly}
      />

      {enableValidation && (validationErrors.length > 0 || validationWarnings.length > 0) && (
        <Box sx={{ mt: 1 }}>
          {validationErrors.map((error, index) => (
            <Alert key={`error-${index}`} color="danger" sx={{ mb: 0.5 }}>
              {error}
            </Alert>
          ))}
          {validationWarnings.map((warning, index) => (
            <Alert key={`warning-${index}`} color="warning" sx={{ mb: 0.5 }}>
              {warning}
            </Alert>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default CodeEditor;
