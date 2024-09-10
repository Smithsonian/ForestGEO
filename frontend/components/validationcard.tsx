'use client';

import React, { useEffect, useState } from 'react';
import { Box, Button, Card, Modal, Stack, Switch, Typography } from '@mui/joy';
import dynamic from 'next/dynamic';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';

// Dynamically import Monaco Editor and avoid SSR issues
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type ValidationCardProps = {
  validation: ValidationProceduresRDS;
  onSaveChanges: (validation: ValidationProceduresRDS) => Promise<void>;
  onDelete: (validationID?: number) => Promise<void>;
  schemaDetails: { table_name: string; column_name: string }[];
};

const ValidationCard: React.FC<ValidationCardProps> = ({ validation, onSaveChanges, onDelete, schemaDetails }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scriptContent, setScriptContent] = useState(validation.definition);

  const handleCardClick = () => {
    setIsFlipped(true);
    setIsModalOpen(true);
  };

  const handleCloseModal = async () => {
    setIsModalOpen(false);
    setTimeout(() => setIsFlipped(false), 300); // Delay for smooth flip-back animation
  };

  const handleSaveChanges = async () => {
    const updatedValidation = { ...validation, definition: scriptContent };
    await onSaveChanges(updatedValidation);
    await handleCloseModal();
  };

  useEffect(() => {
    if (typeof window !== 'undefined' && schemaDetails.length > 0) {
      // Dynamically import the monaco-editor instance and use its types
      import('monaco-editor').then(monaco => {
        monaco.languages.registerCompletionItemProvider('mysql', {
          provideCompletionItems: (model, position) => {
            const suggestions: any[] = [];
            const word = model.getWordUntilPosition(position);
            const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

            // Add table names to the suggestions
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

            // Add column names to the suggestions, grouped by table
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
      });
    }
  }, [schemaDetails]);

  return (
    <Box sx={{ position: 'relative', width: 300, minHeight: 200 }}>
      <Card
        variant="outlined"
        onClick={handleCardClick}
        sx={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 2,
          cursor: 'pointer',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0)',
          transition: 'transform 0.6s',
          perspective: 1000,
          minHeight: 'inherit',
          overflow: 'auto'
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ flexGrow: 1 }}>
            <Typography
              level="h4"
              sx={{
                fontWeight: 'bold',
                fontSize: '1.1rem',
                whiteSpace: 'normal',
                overflow: 'visible',
                wordBreak: 'break-word'
              }}
            >
              {validation.procedureName?.replace(/(DBH|HOM)([A-Z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2')}
            </Typography>
            <Typography
              level="body-sm"
              sx={{
                color: '#ccc',
                fontSize: '0.9rem',
                marginTop: 0.5
              }}
            >
              {validation.description}
            </Typography>
          </Box>
          <Switch
            checked={validation.isEnabled}
            onChange={async e => {
              const updatedValidation = { ...validation, isEnabled: e.target.checked };
              await onSaveChanges(updatedValidation); // Pass the updated object to the parent
            }}
            sx={{
              marginLeft: 2
            }}
            onClick={e => e.stopPropagation()}
          />
        </Stack>
      </Card>
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Card
          variant="outlined"
          sx={{
            display: 'flex',
            flex: 1,
            maxWidth: '50vw',
            padding: 4,
            maxHeight: '80vh', // Limit the modal height
            overflowY: 'auto' // Enable scrolling for the entire modal
          }}
        >
          <Editor
            height="60vh"
            language="mysql" // Use default MySQL language for syntax highlighting
            value={scriptContent} // script content from state
            onChange={value => setScriptContent(value || '')}
            theme="vs-dark" // optional theme
            options={{
              minimap: { enabled: false }, // Disable minimap
              scrollBeyondLastLine: false,
              wordWrap: 'on'
            }}
          />

          <Box sx={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <Button variant="solid" onClick={handleSaveChanges}>
              Save Changes
            </Button>
            <Button variant="soft" color="danger" onClick={() => onDelete(validation.validationID)}>
              Delete
            </Button>
            <Button variant="plain" onClick={handleCloseModal}>
              Cancel
            </Button>
          </Box>
        </Card>
      </Modal>
    </Box>
  );
};

export default ValidationCard;
