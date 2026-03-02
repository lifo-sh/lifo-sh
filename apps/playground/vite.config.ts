import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { portBridgePlugin } from './src/vite-plugin-port-bridge';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/playground/' : '/',
  plugins: [tailwindcss(), portBridgePlugin()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@lifo-sh/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
}));
