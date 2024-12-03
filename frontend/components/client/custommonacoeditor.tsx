'use client';

import { useMonaco } from '@monaco-editor/react';
import dynamic from 'next/dynamic';
import React, { Dispatch, memo, SetStateAction, useEffect, useState } from 'react';
import { Box, Button, Snackbar } from '@mui/joy';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type CustomMonacoEditorProps = {
  schemaDetails: {
    table_name: string;
    column_name: string;
  }[];
  setContent?: Dispatch<SetStateAction<string | undefined>>;
  content?: string;
  height?: any;
  isDarkMode?: boolean;
} & React.ComponentPropsWithoutRef<typeof Editor>;

function processExplainOutput(explainRows: any[]): { valid: boolean; message: string } {
  for (const row of explainRows) {
    if (row.Extra?.includes('Impossible WHERE')) {
      return { valid: false, message: 'The WHERE clause is impossible to satisfy.' };
    }

    if (!row.table) {
      return { valid: false, message: 'Invalid table reference.' };
    }

    if (!row.key && row.possible_keys) {
      return { valid: false, message: `No indexes are being used for table ${row.table}. Consider adding an index.` };
    }
  }

  return { valid: true, message: 'The query is valid.' };
}

function CustomMonacoEditor(broadProps: CustomMonacoEditorProps) {
  const { schemaDetails, setContent = () => {}, content, height, options = {}, isDarkMode, ...props } = broadProps;
  const monaco = useMonaco();
  const [snackbarContent, setSnackbarContent] = useState<{ valid: boolean; message: string } | undefined>();
  const [openSnackbar, setOpenSnackbar] = useState(false);

  async function validateQuery() {
    const response = await fetch(`/api/runquery`, { method: 'POST', body: JSON.stringify('EXPLAIN ' + content) });
    const data = await response.json();
    const { valid, message } = processExplainOutput(data);

    setSnackbarContent({ valid, message });
    setOpenSnackbar(true);
  }

  useEffect(() => {
    if (monaco) {
      monaco.languages.registerCompletionItemProvider('mysql', {
        provideCompletionItems: (model, position) => {
          const suggestions: any[] = [];
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

          const tables = Array.from(new Set(schemaDetails.map(row => row.table_name)));
          tables.forEach(table => {
            suggestions.push({
              label: table,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: table,
              detail: 'Table',
              range
            });
          });

          schemaDetails.forEach(({ table_name, column_name }) => {
            suggestions.push({
              label: `${table_name}.${column_name}`,
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: `${table_name}.${column_name}`,
              detail: `Column from ${table_name}`,
              range
            });
          });

          return { suggestions };
        }
      });
    }
  }, [monaco]);

  return (
    <>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Button onClick={validateQuery}>Validate Query</Button>
        <Editor
          height={height ?? '60vh'}
          language="mysql"
          value={content}
          onChange={value => setContent(value ?? '')}
          theme={isDarkMode ? 'vs-dark' : 'light'}
          options={{
            ...options,
            readOnly: options.readOnly ?? false
          }}
          {...props}
        />
      </Box>
      <Snackbar
        variant={'soft'}
        open={openSnackbar}
        color={snackbarContent?.valid ? 'success' : 'danger'}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        autoHideDuration={1000}
        endDecorator={
          <Button onClick={() => setOpenSnackbar(false)} size="sm" variant="soft">
            Dismiss
          </Button>
        }
        onClose={() => {
          setSnackbarContent(undefined);
        }}
      >
        Query validation results: {snackbarContent?.valid ? 'Valid' : 'Invalid'} <br />
        Details: {snackbarContent?.message}
      </Snackbar>
    </>
  );
}

export default memo(CustomMonacoEditor);
