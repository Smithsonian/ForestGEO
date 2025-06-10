// codeeditor.tsx
'use client';

import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { format as sqlFormat } from 'sql-formatter';
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';
import CodeMirror, { EditorView, ViewUpdate } from '@uiw/react-codemirror';

type CodeEditorProps = {
  value: string;
  setValue: Dispatch<SetStateAction<string>> | undefined;
  schemaDetails?: { table_name: string; column_name: string }[];
  height?: string | number;
  isDarkMode?: boolean;
  readOnly?: boolean;
};

const CodeEditor: React.FC<CodeEditorProps> = ({ value, setValue, schemaDetails = [], height = 'auto', isDarkMode = false, readOnly = false }) => {
  const [editorValue, setEditorValue] = useState(() => sqlFormat(value, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' }));

  useEffect(() => {
    setEditorValue(sqlFormat(value, { language: 'mysql', tabWidth: 2, keywordCase: 'preserve' }));
  }, [value]);

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

  return (
    <CodeMirror
      value={editorValue}
      {...(cmHeight ? { height: cmHeight } : {})}
      extensions={[basicSetup, sql(), autocompleteExtension, lineWrapExt, autoHeightExt]}
      theme={isDarkMode ? 'dark' : 'light'}
      onChange={val => {
        if (setValue) setValue(val);
        setEditorValue(val);
      }}
      readOnly={readOnly}
    />
  );
};

export default CodeEditor;
