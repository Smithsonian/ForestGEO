'use client';

import React, { useState } from 'react';
import { Box, Button, Card, Modal, Stack, Switch, Textarea, Typography } from '@mui/joy';

import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';

type ValidationCardProps = ValidationProceduresRDS & {
  onToggle: (enabled?: boolean) => void;
  onSaveChanges: (newSqlCode?: string) => void;
  onDelete: () => void;
};

const ValidationCard: React.FC<ValidationCardProps> = ({ procedureName, description, definition, isEnabled, onToggle, onSaveChanges, onDelete }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentSqlCode, setCurrentSqlCode] = useState(definition);

  const handleCardClick = () => {
    setIsFlipped(true);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setTimeout(() => setIsFlipped(false), 300); // Delay for smooth flip-back animation
  };

  const handleSaveChanges = () => {
    onSaveChanges(currentSqlCode ?? '');
    handleCloseModal();
  };

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
          padding: 2, // Adjust padding for consistency
          cursor: 'pointer',
          transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0)',
          transition: 'transform 0.6s',
          perspective: 1000,
          minHeight: 'inherit' // Allow card to stretch
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ flexGrow: 1 }}>
            <Typography
              level="h4"
              sx={{
                fontWeight: 'bold',
                fontSize: '1.1rem',
                whiteSpace: 'normal', // Allow wrapping if necessary
                overflow: 'visible',
                wordBreak: 'break-word'
              }}
            >
              {procedureName?.replace(/(DBH|HOM)([A-Z])/g, '$1 $2').replace(/([a-z])([A-Z])/g, '$1 $2')}
            </Typography>
            <Typography
              level="body-sm"
              sx={{
                color: '#ccc',
                fontSize: '0.9rem',
                marginTop: 0.5 // Space between title and description
              }}
            >
              {description}
            </Typography>
          </Box>
          <Switch
            checked={isEnabled}
            onChange={e => onToggle(e.target.checked)}
            sx={{
              marginLeft: 2 // Space between the switch and text
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
        <Card variant="outlined" sx={{ width: 400, padding: 4 }}>
          <Textarea minRows={6} value={currentSqlCode} onChange={e => setCurrentSqlCode(e.target.value)} sx={{ marginBottom: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="solid" onClick={handleSaveChanges}>
              Save Changes
            </Button>
            <Button variant="soft" color="danger" onClick={onDelete}>
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
