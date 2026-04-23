import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react({
    // Only treat .jsx and .tsx files as JSX — not plain .js files
    include: '**/*.{jsx,tsx}',
  })],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  esbuild: {
    // Only apply JSX transform to .jsx files
    include: /\.jsx?$/,
    // Treat .js files as plain JS
    loader: 'js',
  },
});
