'use client';

import { useMonaco } from '@monaco-editor/react';
import dynamic from 'next/dynamic';
import React, { Dispatch, memo, SetStateAction, useEffect } from 'react';

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

function CustomMonacoEditor(broadProps: CustomMonacoEditorProps) {
  const { schemaDetails, setContent = () => {}, content, height, options = {}, isDarkMode, ...props } = broadProps;
  const monaco = useMonaco();

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
    <Editor
      height={height ?? '60vh'}
      language="mysql"
      value={content}
      onChange={value => setContent(value ?? '')}
      theme={isDarkMode ? 'vs-dark' : 'light'}
      options={{
        ...options, // Spread the existing options
        readOnly: options.readOnly ?? false // Ensure readOnly is explicitly respected
      }}
      {...props}
    />
  );
}

export default memo(CustomMonacoEditor);
