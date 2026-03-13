import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Allow importing from shared folder at project root
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    // Enable history API fallback for client-side routing
    historyApiFallback: true,
    // Allow serving files from parent directory (shared folder)
    fs: {
      allow: ['..'],
    },
  },
  // For production builds - ensure proper routing
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});

