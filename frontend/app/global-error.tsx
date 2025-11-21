'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import { CssVarsProvider } from '@mui/joy/styles';
import Button from '@mui/joy/Button';
import ailogger from '@/ailogger';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Log the error to error reporting service
    ailogger.error(error.message || 'Critical root layout error occurred', error);
  }, [error]);

  return (
    // global-error must include html and body tags
    <html lang={'en'}>
      <body
        style={{
          margin: 0,
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#f5f5f5'
        }}
      >
        <CssVarsProvider>
          <div
            style={{
              textAlign: 'center',
              maxWidth: '700px',
              padding: '2.5rem',
              backgroundColor: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
            }}
          >
            <div
              style={{
                fontSize: '4rem',
                marginBottom: '1rem',
                lineHeight: 1
              }}
            >
              ⚠️
            </div>
            <h1
              style={{
                color: '#d32f2f',
                marginBottom: '1.5rem',
                fontSize: '2rem',
                fontWeight: 700
              }}
            >
              Critical Error
            </h1>
            <div
              style={{
                backgroundColor: '#ffebee',
                border: '1px solid #ef5350',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: '1.5rem',
                textAlign: 'left'
              }}
            >
              <p
                style={{
                  color: '#333',
                  marginBottom: '0',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {error?.message ?? 'A critical application error has occurred'}
              </p>
            </div>
            {error?.digest && (
              <p
                style={{
                  color: '#999',
                  fontSize: '0.75rem',
                  marginBottom: '1.5rem'
                }}
              >
                Error ID: {error.digest}
              </p>
            )}
            <Button
              variant="solid"
              color="primary"
              onClick={() => reset()}
              sx={{
                minHeight: '44px',
                minWidth: '200px',
                fontSize: '1rem',
                fontWeight: 600,
                px: 2.5,
                py: 1,
                transition: 'all 0.2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: 'md'
                }
              }}
            >
              Try again
            </Button>
          </div>
        </CssVarsProvider>
      </body>
    </html>
  );
}
