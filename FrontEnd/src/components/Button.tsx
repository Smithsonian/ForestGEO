/* eslint-disable prettier/prettier */
import React from 'react';
import '../stories/Button.css';

export interface ButtonProps {
  label: string;
  backgroundColor: string;
  textColor: string;
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}

// display validationTable when upload button is click
export const displayDataTable = () => {
  console.log('button pressed; displayDataTable called');
  // make dropzone disappear
  document.getElementById('dropZone')!.style.display = 'none';

  // display ValidationTable
  document.getElementById('validationTable')!.style.display = 'block';
};

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
