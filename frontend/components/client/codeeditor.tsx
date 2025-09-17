// codeeditor.tsx
'use client';

import React, { Dispatch, SetStateAction, useEffect, useState, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { format as sqlFormat } from 'sql-formatter';
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';
import { linter, lintGutter } from '@codemirror/lint';
import CodeMirror, { EditorView, ViewUpdate } from '@uiw/react-codemirror';
import { Box, Alert } from '@mui/material';

type CodeEditorProps = {
  value: string;
  setValue: Dispatch<SetStateAction<string>> | undefined;
  schemaDetails?: { table_name: string; column_name: string }[];
  height?: string | number;
  isDarkMode?: boolean;
  readOnly?: boolean;
  schema?: string;
  enableValidation?: boolean;
};

const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  setValue,
  schemaDetails = [],
  height = 'auto',
  isDarkMode = false,
  readOnly = false,
  schema,
  enableValidation = false
}) => {
  const [editorValue, setEditorValue] = useState(() => sqlFormat(value, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' }));
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setEditorValue(sqlFormat(value, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' }));
  }, [value]);

  // Debounced validation function
  const validateQuery = async (query: string) => {
    if (!enableValidation || !schema || !query.trim()) {
      setValidationErrors([]);
      setValidationWarnings([]);
      return;
    }

    try {
      const response = await fetch(`/api/validations/validate-query?schema=${schema}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (response.ok) {
        const result = await response.json();
        setValidationErrors(result.errors || []);
        setValidationWarnings(result.warnings || []);
      }
    } catch (error) {
      console.error('Validation error:', error);
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
            <Alert key={`error-${index}`} severity="error" sx={{ mb: 0.5 }}>
              {error}
            </Alert>
          ))}
          {validationWarnings.map((warning, index) => (
            <Alert key={`warning-${index}`} severity="warning" sx={{ mb: 0.5 }}>
              {warning}
            </Alert>
          ))}
        </Box>
      )}
    </Box>
  );
};

export default CodeEditor;
