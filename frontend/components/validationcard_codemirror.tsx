'use client';

import React, { useState } from 'react';
import { Box, Button, Card, Modal, Stack, Switch, Typography, useTheme } from '@mui/joy';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { autocompletion, CompletionContext } from '@codemirror/autocomplete';
import { useCodeMirror } from '@uiw/react-codemirror';

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
    setTimeout(() => setIsFlipped(false), 300);
  };

  const handleSaveChanges = async () => {
    const updatedValidation = { ...validation, definition: scriptContent };
    await onSaveChanges(updatedValidation);
    await handleCloseModal();
  };

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
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';

  const { setContainer } = useCodeMirror({
    value: scriptContent,
    height: '60vh',
    extensions: [basicSetup, sql(), autocompleteExtension],
    theme: isDarkMode ? 'dark' : 'light',
    onChange: value => setScriptContent(value)
  });

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
              await onSaveChanges(updatedValidation);
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
            maxHeight: '80vh',
            overflowY: 'auto'
          }}
        >
          <Box ref={setContainer} />

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
