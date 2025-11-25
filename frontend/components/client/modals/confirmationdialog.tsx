'use client';
import React from 'react';
import { Button, Modal, ModalDialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/joy';

interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  content: string;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({ open, onClose, onConfirm, title, content }) => {
  return (
    <Modal open={open} onClose={onClose}>
      <ModalDialog
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
        sx={{
          '@keyframes slideIn': {
            from: {
              opacity: 0,
              transform: 'scale(0.9) translateY(-20px)'
            },
            to: {
              opacity: 1,
              transform: 'scale(1) translateY(0)'
            }
          },
          animation: 'slideIn 0.3s ease-out',
          background: theme => `linear-gradient(135deg, ${theme.palette.background.surface} 0%, ${theme.palette.neutral.softBg} 100%)`,
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.3)',
          border: theme => `1px solid ${theme.palette.neutral[200]}`
        }}
      >
        <DialogTitle
          id="alert-dialog-title"
          sx={{
            fontSize: '1.25rem',
            fontWeight: 700,
            background: theme => `linear-gradient(135deg, ${theme.palette.text.primary} 0%, ${theme.palette.primary[600]} 100%)`,
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          {title}
        </DialogTitle>
        <DialogContent
          sx={{
            p: 2,
            borderRadius: 'md',
            background: theme => `linear-gradient(135deg, ${theme.palette.neutral.softBg} 0%, rgba(0, 0, 0, 0.02) 100%)`
          }}
        >
          <Typography id="alert-dialog-description" level="body-md" sx={{ lineHeight: 1.6 }}>
            {content}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ gap: 2, pt: 2 }}>
          <Button
            onClick={onClose}
            variant="outlined"
            color="neutral"
            sx={{
              transition: 'all 0.3s ease',
              '&:hover': {
                transform: 'translateY(-2px)',
                boxShadow: 'sm'
              }
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            variant="solid"
            color="primary"
            sx={{
              background: theme => `linear-gradient(135deg, ${theme.palette.primary[500]} 0%, ${theme.palette.primary[700]} 100%)`,
              transition: 'all 0.3s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
              position: 'relative',
              overflow: 'hidden',
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: '-100%',
                width: '100%',
                height: '100%',
                background: theme => `linear-gradient(90deg, transparent, ${theme.palette.primary[300]}, transparent)`,
                transition: 'left 0.5s ease'
              },
              '&:hover': {
                transform: 'translateY(-2px) scale(1.05)',
                boxShadow: theme => `0 8px 24px ${theme.palette.primary[300]}`,
                '&::before': {
                  left: '100%'
                }
              },
              '&:active': {
                transform: 'translateY(0) scale(0.98)'
              }
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </ModalDialog>
    </Modal>
  );
};

export default ConfirmationDialog;
