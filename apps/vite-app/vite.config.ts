import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@lifo-sh/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
});
