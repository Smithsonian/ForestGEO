'use client';

import React, { Dispatch, SetStateAction, useRef } from 'react';
import { Box } from '@mui/joy';
import { useCodeMirror } from '@uiw/react-codemirror';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';

type CodeEditorProps = {
  value: string;
  setValue: Dispatch<SetStateAction<string>> | undefined;
  schemaDetails?: { table_name: string; column_name: string }[];
  height?: string | number;
  isDarkMode?: boolean;
  readOnly?: boolean;
};

const CodeEditor: React.FC<CodeEditorProps> = ({ value, setValue, schemaDetails = [], height = '60vh', isDarkMode = false, readOnly = false }) => {
  const editorContainerRef = useRef<HTMLDivElement | null>(null);

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

  // Initialize CodeMirror
  useCodeMirror({
    container: editorContainerRef.current,
    value,
    height: height.toString(),
    extensions: [basicSetup, sql(), autocompleteExtension],
    theme: isDarkMode ? 'dark' : 'light',
    onChange: setValue,
    readOnly
  });

  return <Box ref={editorContainerRef} sx={{ width: '100%', height: '100%' }} />;
};

export default CodeEditor;
