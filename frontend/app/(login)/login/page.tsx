'use client';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import styles from '@/styles/styles.module.css';
import Box from '@mui/joy/Box';
import UnauthenticatedSidebar from '@/components/unauthenticatedsidebar';
import { redirect } from 'next/navigation';

const slides = ['background-1.jpg', 'background-2.jpg', 'background-3.jpg', 'background-4.jpg'];

export default function LoginPage() {
  const { data: _session, status } = useSession();
  const [index, setIndex] = useState(0);

  // Carousel auto-advance using interval to avoid circular dependency
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex(prevIndex => (prevIndex + 1) % slides.length);
    }, 5000);

    return () => clearInterval(interval);
  }, []); // Empty deps - interval runs independently

  if (status === 'unauthenticated') {
    return (
      <Box sx={{ display: 'flex', minHeight: '100vh', minWidth: '100vh', position: 'relative' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={slides[index]}
            className={styles.bg}
            style={{ backgroundImage: `url(${slides[index]})` }}
            data-testid={`${slides[index]}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
          />
        </AnimatePresence>
        <UnauthenticatedSidebar />
      </Box>
    );
  } else if (status === 'authenticated') {
    redirect('/dashboard');
  }

  // Handle loading state
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        width: '100%',
        bgcolor: 'primary.softBg',
        '@keyframes pulse': {
          '0%, 100%': {
            opacity: 1,
            transform: 'scale(1)'
          },
          '50%': {
            opacity: 0.8,
            transform: 'scale(1.05)'
          }
        },
        '@keyframes spin': {
          '0%': {
            transform: 'rotate(0deg)'
          },
          '100%': {
            transform: 'rotate(360deg)'
          }
        }
      }}
    >
      <Box
        sx={{
          textAlign: 'center',
          p: 4,
          borderRadius: 'lg',
          background: theme => `linear-gradient(135deg, ${theme.palette.background.surface} 0%, ${theme.palette.neutral.softBg} 100%)`,
          boxShadow: theme => `0 12px 32px ${theme.palette.primary.softBg}`,
          animation: 'pulse 2s ease-in-out infinite'
        }}
      >
        <Box
          sx={{
            width: 60,
            height: 60,
            border: theme => `4px solid ${theme.palette.primary.softBg}`,
            borderTop: theme => `4px solid ${theme.palette.primary[500]}`,
            borderRadius: '50%',
            margin: '0 auto 1rem',
            animation: 'spin 1s linear infinite'
          }}
        />
        <Box
          sx={{
            fontSize: '1.25rem',
            fontWeight: 600,
            background: theme => `linear-gradient(135deg, ${theme.palette.text.primary} 0%, ${theme.palette.primary[600]} 100%)`,
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}
        >
          Loading...
        </Box>
      </Box>
    </Box>
  );
}
