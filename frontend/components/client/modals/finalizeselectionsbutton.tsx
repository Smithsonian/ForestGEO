'use client';
import { Button } from '@mui/joy';
import React from 'react';

interface FinalizeSelectionsButtonProps {
  onFinish: () => void; // Callback when button is clicked
  show: boolean; // Condition to show the button
}

const FinalizeSelectionsButton: React.FC<FinalizeSelectionsButtonProps> = ({ onFinish, show }) => {
  if (!show) return null;

  return (
    <Button
      variant="solid"
      color="primary"
      onClick={onFinish}
      sx={{
        width: 'fit-content',
        mb: 2,
        opacity: show ? 1 : 0,
        transform: show ? 'scale(1)' : 'scale(0)',
        transition: 'all 1s ease-in-out',
        ':hover': {
          animation: 'pulse 1s infinite'
        },
        '@keyframes pulse': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' }
        }
      }}
    >
      Finalize selections
    </Button>
  );
};

export default FinalizeSelectionsButton;
