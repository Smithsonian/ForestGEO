import React from 'react';
import '../stories/Button.css';

export interface ButtonProps {
  label: string;
  backgroundColor: string;
  textColor: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

export default function Button({
  label,
  backgroundColor,
  textColor,
  onClick,
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className="button"
      style={{ backgroundColor: `${backgroundColor}`, color: `${textColor}` }}
    >
      {label}
    </button>
  );
}
