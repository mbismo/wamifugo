import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Custom plugin: intercept pages.mjs before esbuild sees it
// and add a directive that prevents JSX parsing heuristic
const pagesPlugin = {
  name: 'pages-no-jsx',
  transform(code, id) {
    if (id.endsWith('pages.mjs')) {
      // Prepend a comment that tells esbuild this is NOT JSX
      // The 'use strict' directive at the very top forces JS mode
      return { code: '"use strict";\n' + code, map: null };
    }
  },
};

export default defineConfig({
  plugins: [pagesPlugin, react()],
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
});
