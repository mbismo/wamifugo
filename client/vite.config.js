import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      // Force pages.js to be treated as plain JS not JSX
      plugins: [],
    },
  },
  // Explicitly tell esbuild: .js files use JS loader, not JSX
  // This prevents esbuild from trying to parse < > as JSX tags in pages.js
  esbuild: {
    loader: 'js',
    include: /\.js$/,
  },
});
