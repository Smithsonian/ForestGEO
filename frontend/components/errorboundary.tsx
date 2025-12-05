'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Typography, Button, Alert, Paper } from '@mui/material';
import ailogger from '@/ailogger';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetOnPropsChange?: unknown[];
  componentName?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component for graceful error handling in React component trees.
 * Catches JavaScript errors anywhere in the child component tree, logs them,
 * and displays a fallback UI instead of crashing the whole app.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { onError, componentName } = this.props;
    ailogger.error(`Error in ${componentName || 'component'}:`, error, { componentStack: errorInfo.componentStack });
    onError?.(error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    const { resetOnPropsChange } = this.props;
    if (resetOnPropsChange && this.state.hasError) {
      // Reset error state if specific props change
      const propsChanged = resetOnPropsChange.some((prop, index) => prop !== prevProps.resetOnPropsChange?.[index]);
      if (propsChanged) {
        this.setState({ hasError: false, error: null });
      }
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback, componentName } = this.props;

    if (hasError) {
      if (fallback) {
        return fallback;
      }

      return (
        <Paper elevation={0} sx={{ p: 3, m: 2, bgcolor: 'background.default' }}>
          <Alert severity="error" sx={{ mb: 2 }}>
            <Typography variant="h6" gutterBottom>
              Something went wrong{componentName ? ` in ${componentName}` : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {error?.message || 'An unexpected error occurred'}
            </Typography>
            <Button variant="outlined" size="small" onClick={this.handleReset} sx={{ mt: 1 }}>
              Try Again
            </Button>
          </Alert>
        </Paper>
      );
    }

    return children;
  }
}

/**
 * Higher-order component that wraps a component with an ErrorBoundary
 */
export function withErrorBoundary<P extends object>(WrappedComponent: React.ComponentType<P>, options: Omit<ErrorBoundaryProps, 'children'> = {}): React.FC<P> {
  const WithErrorBoundary: React.FC<P> = props => (
    <ErrorBoundary {...options}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  WithErrorBoundary.displayName = `WithErrorBoundary(${WrappedComponent.displayName || WrappedComponent.name || 'Component'})`;

  return WithErrorBoundary;
}

export default ErrorBoundary;
