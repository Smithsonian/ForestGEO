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

  useEffect(() => {
    const timer = setTimeout(() => {
      setIndex(prevIndex => (prevIndex + 1) % slides.length);
    }, 5000);

    return () => clearTimeout(timer); // Cleanup on unmount
  }, [index]);

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
}
