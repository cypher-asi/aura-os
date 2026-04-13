import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3002,
  },
  build: {
    outDir: 'dist',
  },
  resolve: {
    alias: {
      '@cypher-asi/zui/styles': path.resolve(__dirname, '../src/styles'),
      '@cypher-asi/zui': path.resolve(__dirname, '../src'),
    },
  },
});
