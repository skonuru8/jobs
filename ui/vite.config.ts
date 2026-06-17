import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
      // Served by the backend as static files (resume/cover PDFs, logs).
      // Without this, the dev server returns index.html and the SPA opens
      // in the new tab instead of the document.
      '/output': 'http://localhost:3001',
    },
  },
});
