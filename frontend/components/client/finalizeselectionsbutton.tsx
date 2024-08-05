"use client";
import { Button, Grow } from "@mui/material";
import React from "react";

interface FinalizeSelectionsButtonProps {
  onFinish: () => void; // Callback when button is clicked
  show: boolean; // Condition to show the button
}

const FinalizeSelectionsButton: React.FC<FinalizeSelectionsButtonProps> = ({ onFinish, show }) => {
  if (!show) return null;

  return (
    <Grow in={show} style={{ transformOrigin: "0 0 0" }} timeout={1000}>
      <Button
        variant="contained"
        color="primary"
        onClick={onFinish}
        sx={{
          width: "fit-content",
          mb: 2,
          bgcolor: "secondary.main",
          ":hover": {
            bgcolor: "secondary.dark",
            animation: "pulse 1s infinite"
          },
          "@keyframes pulse": {
            "0%": { transform: "scale(1)" },
            "50%": { transform: "scale(1.05)" },
            "100%": { transform: "scale(1)" }
          }
        }}
      >
        Finalize selections
      </Button>
    </Grow>
  );
};

export default FinalizeSelectionsButton;
