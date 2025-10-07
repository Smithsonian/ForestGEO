'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
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
        <div
          style={{
            textAlign: 'center',
            maxWidth: '600px',
            padding: '2rem',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        >
          <h1
            style={{
              color: '#d32f2f',
              marginBottom: '1rem',
              fontSize: '2rem'
            }}
          >
            Critical Error
          </h1>
          <p
            style={{
              color: '#666',
              marginBottom: '1rem',
              fontSize: '1.1rem'
            }}
          >
            {error?.message ?? 'A critical application error has occurred'}
          </p>
          {error?.digest && (
            <p
              style={{
                color: '#999',
                fontSize: '0.9rem',
                marginBottom: '1.5rem'
              }}
            >
              Error ID: {error.digest}
            </p>
          )}
          <button
            onClick={() => reset()}
            style={{
              backgroundColor: '#1976d2',
              color: 'white',
              border: 'none',
              padding: '0.75rem 2rem',
              fontSize: '1rem',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
            onMouseOver={e => (e.currentTarget.style.backgroundColor = '#1565c0')}
            onFocus={e => (e.currentTarget.style.backgroundColor = '#1565c0')}
            onMouseOut={e => (e.currentTarget.style.backgroundColor = '#1976d2')}
            onBlur={e => (e.currentTarget.style.backgroundColor = '#1976d2')}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
