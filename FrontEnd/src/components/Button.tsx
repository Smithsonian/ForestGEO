import React from 'react';
import { Button } from '@mui/material';

export interface ButtonProps {
  label: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

export default function ButtonComponent({ label, onClick }: ButtonProps) {
  return (
    <Button onClick={onClick} variant="contained">
      {label}
    </Button>
  );
}
