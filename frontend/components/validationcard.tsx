'use client';

import React, { useState } from 'react';
import { Box, Button, Card, Modal, Stack, Switch, Textarea, Typography } from '@mui/joy';
import { ValidationProceduresRDS } from '@/config/sqlrdsdefinitions/validations';

type ValidationCardProps = {
  validation: ValidationProceduresRDS;
  onSaveChanges: (validation: ValidationProceduresRDS) => Promise<void>;
  onDelete: (validationID?: number) => Promise<void>;
};

const ValidationCard: React.FC<ValidationCardProps> = ({ validation, onSaveChanges, onDelete }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCardClick = async () => {
    setIsFlipped(true);
    setIsModalOpen(true);
  };

  const handleCloseModal = async () => {
    setIsModalOpen(false);
    setTimeout(() => setIsFlipped(false), 300); // Delay for smooth flip-back animation
  };

  const handleSaveChanges = async () => {
    await onSaveChanges(validation);
    await handleCloseModal();
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
        <Card variant="outlined" sx={{ width: 400, padding: 4 }}>
          <Textarea
            minRows={6}
            value={validation.definition}
            onChange={async e => {
              const updatedValidation = { ...validation, definition: e.target.value };
              await onSaveChanges(updatedValidation); // Pass the updated object to the parent
            }}
            sx={{ marginBottom: 2 }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
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
