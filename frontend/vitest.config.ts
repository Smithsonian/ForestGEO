/// <reference types="vitest" />

import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './') // Adjust the path as necessary
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/?(*.)test.ts?(x)'],
    poolOptions: {
      forks: {
        singleFork: true
      }
    },
    server: {
      deps: {
        inline: ['get-stream']
      }
    }
  }
});
