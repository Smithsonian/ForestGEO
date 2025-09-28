'use client';
import React from 'react';
import { Alert, Box, Button, Typography } from '@mui/joy';
import { Info as InfoIcon, Warning as WarningIcon } from '@mui/icons-material';
import { useContextValidation, ContextValidationOptions } from '@/app/hooks/useContextValidation';

interface ContextValidationGuardProps extends ContextValidationOptions {
  children: React.ReactNode;
  fallbackComponent?: React.ComponentType<{ missing: string[]; onRetry?: () => void }>;
  showRetry?: boolean;
  customMessage?: string;
  redirectToSelection?: boolean;
}

/**
 * Component that guards its children based on context validation
 * Shows fallback UI when required context values are missing
 */
export default function ContextValidationGuard({
  children,
  fallbackComponent: FallbackComponent,
  showRetry = true,
  customMessage,
  redirectToSelection = true,
  ...validationOptions
}: ContextValidationGuardProps) {
  const { isValid, missing, missingMessage, validateContext } = useContextValidation(validationOptions);

  const handleRetry = () => {
    // Force re-validation (could trigger refresh of context)
    validateContext();

    if (redirectToSelection) {
      // You might want to navigate to selection page
      // router.push('/selection') or similar
      window.location.reload(); // Simple fallback
    }
  };

  if (isValid) {
    return <>{children}</>;
  }

  if (FallbackComponent) {
    return <FallbackComponent missing={missing} onRetry={showRetry ? handleRetry : undefined} />;
  }

  return (
    <Box sx={{ p: 3, maxWidth: 600, mx: 'auto' }}>
      <Alert variant="soft" color="warning" startDecorator={<WarningIcon />} sx={{ mb: 2 }}>
        <Typography level="title-md">Missing Required Selections</Typography>
        <Typography level="body-md">{customMessage || missingMessage}</Typography>
      </Alert>

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
        {showRetry && (
          <Button variant="outlined" onClick={handleRetry} startDecorator={<InfoIcon />}>
            Refresh & Retry
          </Button>
        )}
        {redirectToSelection && (
          <Button variant="solid" color="primary" onClick={() => (window.location.href = '/')}>
            Go to Selection
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * Default fallback component for missing context
 */
export function DefaultContextFallback({ missing, onRetry }: { missing: string[]; onRetry?: () => void }) {
  return (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography level="h4" sx={{ mb: 2 }}>
        Setup Required
      </Typography>
      <Typography level="body-lg" sx={{ mb: 3 }}>
        Please select the following before proceeding:
      </Typography>
      <Box sx={{ mb: 3 }}>
        {missing.map(item => (
          <Typography
            key={item}
            level="body-md"
            sx={{
              textTransform: 'capitalize',
              color: 'warning.500',
              fontWeight: 'md'
            }}
          >
            • {item}
          </Typography>
        ))}
      </Box>
      {onRetry && (
        <Button onClick={onRetry} variant="outlined">
          Check Again
        </Button>
      )}
    </Box>
  );
}
