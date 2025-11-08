/**
 * Toast Notification System
 *
 * Modern, animated toast notifications for user feedback
 * Supports success, error, warning, and info variants
 */

'use client';

import { Snackbar, Alert, IconButton, Box } from '@mui/joy';
import { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';

export type ToastVariant = 'success' | 'danger' | 'warning' | 'info';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  showToast: (options: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
}

const variantIcons = {
  success: CheckCircleIcon,
  danger: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [toastOptions, setToastOptions] = useState<ToastOptions>({
    message: '',
    variant: 'info',
    duration: 4000
  });

  const showToast = useCallback((options: ToastOptions) => {
    setToastOptions({
      ...options,
      variant: options.variant || 'info',
      duration: options.duration || 4000
    });
    setOpen(true);
  }, []);

  const success = useCallback(
    (message: string, duration = 4000) => {
      showToast({ message, variant: 'success', duration });
    },
    [showToast]
  );

  const error = useCallback(
    (message: string, duration = 6000) => {
      showToast({ message, variant: 'danger', duration });
    },
    [showToast]
  );

  const warning = useCallback(
    (message: string, duration = 5000) => {
      showToast({ message, variant: 'warning', duration });
    },
    [showToast]
  );

  const info = useCallback(
    (message: string, duration = 4000) => {
      showToast({ message, variant: 'info', duration });
    },
    [showToast]
  );

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const Icon = variantIcons[toastOptions.variant || 'info'];

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={toastOptions.duration}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        sx={{
          '& .MuiSnackbar-root': {
            animation: 'slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            '@keyframes slideIn': {
              from: {
                transform: 'translateX(100%)',
                opacity: 0
              },
              to: {
                transform: 'translateX(0)',
                opacity: 1
              }
            }
          }
        }}
      >
        <Box
          sx={{
            minWidth: 300,
            maxWidth: 500,
            position: 'relative'
          }}
        >
          <Alert
            variant="soft"
            color={toastOptions.variant as any}
            startDecorator={<Icon />}
            sx={{
              boxShadow: 'lg',
              animation: 'fadeIn 0.2s ease',
              pr: 5,
              '@keyframes fadeIn': {
                from: { opacity: 0 },
                to: { opacity: 1 }
              }
            }}
          >
            {toastOptions.message}
          </Alert>
          <IconButton
            variant="plain"
            size="sm"
            onClick={handleClose}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </Snackbar>
    </ToastContext.Provider>
  );
}
