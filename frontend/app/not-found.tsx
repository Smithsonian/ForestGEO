'use client';
import { Box, Typography, Link as MuiLink } from '@mui/joy';
import Link from 'next/link';

export default function NotFound() {
  return (
    <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" height="100vh" sx={{ textAlign: 'center', padding: 2 }}>
      <Typography level="h2" fontWeight="bold" mb={2}>
        Not Found
      </Typography>
      <Typography level="body-lg" mb={4}>
        Could not find requested resource
      </Typography>
      <Link href="/" passHref>
        <MuiLink
          level="body-lg"
          underline="none"
          sx={{
            display: 'inline-block',
            padding: 1,
            backgroundColor: 'primary.500',
            color: 'primary.contrastText',
            borderRadius: '4px',
            '&:hover': {
              backgroundColor: 'primary.700'
            }
          }}
        >
          Return Home
        </MuiLink>
      </Link>
    </Box>
  );
}
