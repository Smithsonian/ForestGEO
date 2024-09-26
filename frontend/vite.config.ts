import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src') // Assuming your source code is inside the `src` directory
    }
  },
  test: {
    globals: true,
    environment: 'jsdom' // Ensure this is set if you are testing React components
  }
});
