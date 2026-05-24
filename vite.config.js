import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // Proxy API calls to Express during local development
    proxy: {
      '/api':  'http://localhost:3000',
      '/log':  'http://localhost:3000',
    },
  },
});
